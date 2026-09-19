#!/usr/bin/env node
/**
 * netsim-proxy.mjs: a simulated network link in front of Jellyfin, for the Slipstream drills.
 *
 * Every byte through the proxy, both directions and all connections together, draws from ONE
 * token bucket, so the app sees a single link of the configured rate. No sudo, no system
 * configuration: point the app (or the host drill) at this port instead of the server's.
 *
 * Usage:
 *   node scripts/netsim-proxy.mjs [--port 18096] [--upstream http://127.0.0.1:8096]
 *                                 [--kbps 0] [--rtt 0] [--profile steps.json] [--log out.jsonl]
 *   kbps 0 = unlimited. A profile is [{ "atSec": 0, "kbps": 30000 }, { "atSec": 60, "kbps": 1500 }].
 *
 * Control (served by the proxy itself, never forwarded):
 *   GET  /__netsim            current state
 *   POST /__netsim            {"kbps": 1500} or {"profile": [...]} (a profile's clock starts on receipt);
 *                             {"refuse": "regex"} answers matching paths 503, {"refuse": null} clears it
 *
 * Log (JSONL, stdout unless --log): one "tick" line per second with the rate applied and the
 * bytes carried each way, and one "req" line per proxied request with status, bytes and timing.
 */
import http from "node:http";
import net from "node:net";
import fs from "node:fs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const PORT = Number(opt("--port", "18096"));
const UPSTREAM = new URL(opt("--upstream", "http://127.0.0.1:8096"));
let rttMs = Number(opt("--rtt", "0"));
const LOG_PATH = opt("--log", null);
const CHUNK = 16 * 1024;

const logStream = LOG_PATH ? fs.createWriteStream(LOG_PATH, { flags: "a" }) : null;
function emit(record) {
  const line = `${JSON.stringify({ t: Date.now(), ...record })}\n`;
  if (logStream) logStream.write(line);
  else process.stdout.write(line);
}

// ---------- the link ----------

let kbps = Number(opt("--kbps", "0"));
/** Paths answered 503 without reaching the server (a refused route), set via control. */
let refuse = null;
let profile = null;
let profileStart = 0;
let tokens = 0;
const waiters = [];
const carried = { down: 0, up: 0 };
/** Requests proxied since start: how a caller confirms the app is really reading through here. */
let served = 0;

const ratePerSec = () => (kbps > 0 ? (kbps * 1000) / 8 : Infinity);

function applyProfile() {
  if (!profile) return;
  const elapsed = (Date.now() - profileStart) / 1000;
  let current = null;
  for (const step of profile) if (step.atSec <= elapsed) current = step;
  if (current && current.kbps !== kbps) {
    kbps = current.kbps;
    emit({ kind: "rate", kbps, reason: "profile", atSec: current.atSec });
  }
}

/** Resolves once `n` bytes of link capacity are available; FIFO across every connection. */
function take(n) {
  if (ratePerSec() === Infinity) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push({ n, resolve });
    drain();
  });
}

function drain() {
  while (waiters.length) {
    const head = waiters[0];
    if (ratePerSec() !== Infinity && tokens < head.n) return;
    tokens = Math.max(0, tokens - head.n);
    waiters.shift();
    head.resolve();
  }
}

let lastRefill = Date.now();
setInterval(() => {
  applyProfile();
  const now = Date.now();
  const rate = ratePerSec();
  // A burst allowance of 100ms keeps the shaping smooth at small chunk sizes.
  const cap = rate === Infinity ? Infinity : Math.max(CHUNK, rate * 0.1);
  tokens = Math.min(cap, tokens + (rate === Infinity ? Infinity : (rate * (now - lastRefill)) / 1000));
  lastRefill = now;
  drain();
}, 10);

setInterval(() => {
  emit({ kind: "tick", kbps, downKbps: Math.round((carried.down * 8) / 1000), upKbps: Math.round((carried.up * 8) / 1000), queued: waiters.length });
  carried.down = 0;
  carried.up = 0;
}, 1000);

/** Writes `data` to `dest` in chunks paced by the shared bucket; resolves when all is written. */
async function paced(data, dest, direction) {
  for (let offset = 0; offset < data.length; offset += CHUNK) {
    const piece = data.subarray(offset, offset + CHUNK);
    await take(piece.length);
    carried[direction] += piece.length;
    if (dest.destroyed) return;
    if (!dest.write(piece)) await new Promise((resolve) => dest.once("drain", resolve));
  }
}

/** Pipes a readable into a writable through the link, preserving order. */
function pipeThroughLink(src, dest, direction, onEnd) {
  let chain = Promise.resolve();
  src.on("data", (chunk) => {
    src.pause();
    chain = chain.then(() => paced(chunk, dest, direction)).then(() => src.resume());
  });
  src.on("end", () => {
    chain.then(() => {
      onEnd?.();
    });
  });
  src.on("error", () => dest.destroy());
}

const delay = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

// ---------- control ----------

function control(req, res) {
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ kbps, profile, profileElapsed: profile ? (Date.now() - profileStart) / 1000 : null, queued: waiters.length, served }));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      const cmd = JSON.parse(body || "{}");
      if ("refuse" in cmd) {
        refuse = cmd.refuse ? new RegExp(cmd.refuse) : null;
        emit({ kind: "refuse", pattern: cmd.refuse || null });
      }
      if (typeof cmd.rttMs === "number") {
        rttMs = cmd.rttMs;
        emit({ kind: "rtt", rttMs });
      }
      if (Array.isArray(cmd.profile)) {
        profile = [...cmd.profile].sort((a, b) => a.atSec - b.atSec);
        profileStart = Date.now();
        applyProfile();
        emit({ kind: "profile", steps: profile });
      } else if (typeof cmd.kbps === "number") {
        profile = null;
        kbps = cmd.kbps;
        emit({ kind: "rate", kbps, reason: "control" });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ kbps, profile }));
    } catch (error) {
      res.writeHead(400);
      res.end(String(error));
    }
  });
}

// ---------- proxy ----------

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/__netsim")) return control(req, res);
  served++;
  if (refuse && refuse.test(req.url)) {
    emit({ kind: "req", method: req.method, path: req.url.split("?")[0], status: 503, refused: true });
    res.writeHead(503);
    res.end();
    return;
  }
  const started = Date.now();
  let firstByteMs = null;
  let bytes = 0;
  await delay(rttMs / 2);
  const upstream = http.request({ hostname: UPSTREAM.hostname, port: UPSTREAM.port, path: req.url, method: req.method, headers: { ...req.headers, host: UPSTREAM.host } }, async (up) => {
    await delay(rttMs / 2);
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.on("data", (chunk) => {
      if (firstByteMs === null) firstByteMs = Date.now() - started;
      bytes += chunk.length;
    });
    pipeThroughLink(up, res, "down", () => {
      res.end();
      emit({ kind: "req", method: req.method, path: req.url.split("?")[0], status: up.statusCode, bytes, firstByteMs, totalMs: Date.now() - started });
    });
  });
  upstream.on("error", (error) => {
    emit({ kind: "req", method: req.method, path: req.url.split("?")[0], error: error.message, totalMs: Date.now() - started });
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  res.on("close", () => upstream.destroy());
  pipeThroughLink(req, upstream, "up", () => upstream.end());
});

// Websocket (and any other) upgrades: raw TCP through the same link.
server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(Number(UPSTREAM.port), UPSTREAM.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      lines.push(`${name}: ${name.toLowerCase() === "host" ? UPSTREAM.host : req.rawHeaders[i + 1]}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    pipeThroughLink(upstream, socket, "down", () => socket.end());
    pipeThroughLink(socket, upstream, "up", () => upstream.end());
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(PORT, "0.0.0.0", () => {
  emit({ kind: "start", port: PORT, upstream: UPSTREAM.href, kbps, rttMs });
  const profilePath = opt("--profile", null);
  if (profilePath) {
    profile = JSON.parse(fs.readFileSync(profilePath, "utf8")).sort((a, b) => a.atSec - b.atSec);
    profileStart = Date.now();
    applyProfile();
  }
});
