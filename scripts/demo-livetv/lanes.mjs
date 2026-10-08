#!/usr/bin/env node
/**
 * Live frame lanes, measured: the engine's own grab (LiveFrameOriginTests) run against each input a channel
 * preview can read, with the demo box's opens and buffers counted before, during and after every lane. Then the
 * server's own close rules, as the app relies on them: a shared stream survives one viewer leaving, and a Stopped
 * report without LiveStreamId leaves the stream to whoever still holds it.
 *   node scripts/demo-livetv/lanes.mjs [channel name, default Sintel] [runs, default 2]
 * .env.demo: DEMO_SSH, DEMO_SSH_KEY; DEMO_URL defaults to https://tomotv.cubita.studio. Exits 1 on a failed expectation.
 * With rig.mjs's RIG_URL, RIG_CONTAINER, RIG_USER_TOKEN in the environment it measures that rig instead, as its non-admin user.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
// The rig lane reads no .env.demo; only the demo server's ssh needs it.
const ENV_FILE = join(ROOT, ".env.demo");
const env = Object.fromEntries(
  (existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "")
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);
const RIG = process.env.RIG_URL ? { url: process.env.RIG_URL, container: process.env.RIG_CONTAINER, token: process.env.RIG_USER_TOKEN } : null;
const BASE = RIG?.url ?? process.env.DEMO_URL ?? env.DEMO_URL ?? "https://tomotv.cubita.studio";
const CHANNEL = process.argv[2] ?? (RIG ? "Rig One" : "Sintel");
const RUNS = process.argv[3] ?? "2";
const FIXTURE = join(homedir(), "Movies/development-videos/T01 DIRECT H264 AAC.mp4");
const LOCAL_PORT = 19102;
const DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";

const ssh = (command) => {
  if (!env.DEMO_SSH_KEY || !env.DEMO_SSH) throw new Error(".env.demo needs DEMO_SSH and DEMO_SSH_KEY");
  const result = spawnSync("ssh", ["-i", env.DEMO_SSH_KEY.replace(/^~/, homedir()), "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=20", env.DEMO_SSH, command], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ssh failed: ${result.stderr}`);
  return result.stdout.trim();
};

// The admin's newest session token, read in place (read-only) as leakwatch.py does.
const token =
  RIG?.token ??
  ssh(
    `sudo python3 -c "import sqlite3; c = sqlite3.connect('file:/opt/tomotv/jellyfin/config/data/jellyfin.db?mode=ro', uri=True); a = c.execute(\\"select Id from Users where Username='admin'\\").fetchone()[0]; print(c.execute('select AccessToken from Devices where UserId=? order by DateLastActivity desc limit 1', (a,)).fetchone()[0])"`,
  );
const authFor = (device) => ({ Authorization: `MediaBrowser Client="lanes-probe", Device="${device}", DeviceId="${device}", Version="1", Token="${token}"`, "Content-Type": "application/json" });
const api = async (path, { device = "lanes-probe-1", ...init } = {}) => {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: authFor(device) });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

const docker = (command) => spawnSync("docker", ["exec", RIG.container, "sh", "-c", command], { encoding: "utf8" }).stdout.trim();
const snapshot = () => {
  const [buffers, opens] = (RIG ? docker : ssh)(
    RIG
      ? "ls /cache/transcodes | grep -c '\\.ts$'; grep -c 'Live stream opened:' /config/log/log_$(date -u +%Y%m%d).log"
      : `ls /opt/tomotv/jellyfin/cache/transcodes | grep -c '\\.ts$'; sudo grep -c 'Live stream opened:' /opt/tomotv/jellyfin/config/log/log_$(date -u +%Y%m%d).log`,
  ).split("\n");
  return { buffers: Number(buffers), opens: Number(opens) };
};

/** One engine run per lane; the demo's buffer count sampled every 2 s while it reads. */
async function engine(url, headers, profile, expect) {
  let peak = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      peak = Math.max(peak, snapshot().buffers);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  })();
  const child = spawn("swift", ["test", "--package-path", join(ROOT, "packages/tomo-engine"), "--filter", "LiveFrameOriginTests"], {
    env: {
      ...process.env,
      DEVELOPER_DIR,
      TOMO_LIVE_GRAB_URL: url,
      TOMO_LIVE_GRAB_HEADERS: JSON.stringify(headers),
      TOMO_LIVE_GRAB_PROFILE: profile,
      TOMO_LIVE_GRAB_EXPECT: expect,
      TOMO_LIVE_GRAB_RUNS: RUNS,
    },
  });
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (out += chunk));
  const code = await new Promise((resolve) => child.on("close", resolve));
  sampling = false;
  await sampler;
  const runs = out
    .split("\n")
    .filter((line) => line.includes("[LiveFrameLane] "))
    .map((line) => JSON.parse(line.slice(line.indexOf("[LiveFrameLane] ") + 16)));
  if (runs.length === 0) console.log(out.split("\n").slice(-30).join("\n"));
  return { passed: code === 0, runs, peakBuffers: peak };
}

const results = [];
const scenarios = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function record(lane, profile, run, before, after, checks) {
  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  results.push({ lane, profile, ...run, opensDelta: after.opens - before.opens, buffersBefore: before.buffers, buffersAfter: after.buffers, failed });
}

async function lane(name, profile, input, expect, serverChecks) {
  const before = snapshot();
  const opened = input.open ? await input.open() : null;
  let run;
  try {
    run = await engine(opened?.url ?? input.url, input.headers ?? {}, profile, expect);
  } finally {
    if (opened) await opened.close();
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const after = snapshot();
  record(name, profile, run, before, after, { engine: run.passed, ...serverChecks(before, after, run) });
}

const me = await api("/Users/Me");
const channels = (await api(`/LiveTv/Channels?UserId=${me.Id}`)).Items;
const channel = channels.find((c) => c.Name === CHANNEL);
if (!channel) throw new Error(`no channel named ${CHANNEL}`);
const info = await api(`/Items/${channel.Id}/PlaybackInfo?UserId=${me.Id}`);
const source = info.MediaSources[0];
console.log(`channel ${channel.Name}: Path ${source.Path}, Protocol ${source.Protocol}, SupportsDirectPlay ${source.SupportsDirectPlay}, headers ${JSON.stringify(source.RequiredHttpHeaders ?? {})}`);

const noServerState = (before, after, run) => ({ noOpen: after.opens === before.opens, noBuffer: run.peakBuffers <= before.buffers && after.buffers === before.buffers });
const openLane = {
  // Today's server lane: PlaybackInfo opens the channel, the engine reads its buffer, the grab closes it.
  open: async () => {
    const opened = await api(`/Items/${channel.Id}/PlaybackInfo?UserId=${me.Id}`, {
      method: "POST",
      body: JSON.stringify({ UserId: me.Id, AutoOpenLiveStream: true, EnableDirectPlay: true, EnableDirectStream: true }),
    });
    const media = opened.MediaSources[0];
    const path = media.Path.replace(/^https?:\/\/[^/]+/, "");
    return { url: `${BASE}${path}${path.includes("?") ? "&" : "?"}ApiKey=${token}`, close: () => api(`/LiveStreams/Close?liveStreamId=${encodeURIComponent(media.LiveStreamId)}`, { method: "POST" }) };
  },
};
const proxyLane = { url: `${BASE}/Videos/${channel.Id}/stream?static=true&ApiKey=${token}` };
const demoOrigin = { url: source.Path, headers: source.RequiredHttpHeaders ?? {} };
const localOrigin = { url: `http://127.0.0.1:${LOCAL_PORT}/live.ts`, headers: source.RequiredHttpHeaders ?? {} };

/** A counted open as a viewer device makes it, with that device's reports and close. */
async function counted(device) {
  const opened = await api(`/Items/${channel.Id}/PlaybackInfo?UserId=${me.Id}`, {
    method: "POST",
    device,
    body: JSON.stringify({ UserId: me.Id, AutoOpenLiveStream: true, EnableDirectPlay: true, EnableDirectStream: true }),
  });
  const media = opened.MediaSources[0];
  // The app's reports carry no LiveStreamId: the server must never close the stream on a report.
  const body = JSON.stringify({ ItemId: channel.Id, MediaSourceId: media.Id, PlaySessionId: opened.PlaySessionId, PlayMethod: "DirectStream", PositionTicks: 0 });
  return {
    id: media.LiveStreamId,
    report: (suffix) => api(`/Sessions/Playing${suffix}`, { method: "POST", device, body }),
    close: () => api(`/LiveStreams/Close?liveStreamId=${encodeURIComponent(media.LiveStreamId)}`, { method: "POST", device }),
  };
}

async function scenario(name, run) {
  const before = snapshot().buffers;
  let failed = [];
  try {
    failed = await run(before);
  } catch (error) {
    failed = [String(error.message ?? error)];
  }
  await wait(2000);
  scenarios.push({ name, failed, buffersBefore: before, buffersAfter: snapshot().buffers });
}

await scenario("two viewers: one leaving keeps the other's stream", async (before) => {
  const a = await counted("lanes-viewer-a");
  const b = await counted("lanes-viewer-b");
  const failed = [];
  if (a.id !== b.id) failed.push("viewers were not given one shared stream");
  await b.report("");
  await b.report("/Stopped");
  await b.close();
  await wait(2000);
  if (snapshot().buffers <= before) failed.push("the other viewer lost the stream");
  await a.close();
  await wait(2000);
  if (snapshot().buffers !== before) failed.push("the last close left a buffer");
  return failed;
});

await scenario("retain: a Stopped report alone leaves the stream to its holder", async (before) => {
  const a = await counted("lanes-viewer-a");
  const failed = [];
  await a.report("");
  await a.report("/Stopped");
  await wait(4000);
  if (snapshot().buffers <= before) failed.push("the Stopped report released the stream");
  await a.close();
  await wait(2000);
  if (snapshot().buffers !== before) failed.push("the close left a buffer");
  return failed;
});

for (const profile of ["cold", "warm"]) {
  await lane("open (today)", profile, openLane, "frames", (before, after) => ({ closed: after.buffers === before.buffers }));
  await lane("proxy static", profile, proxyLane, "frames", noServerState);
  await lane(RIG ? "origin" : "origin demo", profile, demoOrigin, RIG ? "frames" : "fail", noServerState);
}

// A raw TS origin this Mac reaches: the demo's relay, fed the way broadcast.sh feeds it (stream copy, -re paced).
// The rig's origin is already that relay.
if (RIG) report();
const relayDir = mkdtempSync(join(tmpdir(), "lanes-relay-"));
writeFileSync(join(relayDir, "lineup.json"), JSON.stringify({ channels: [{ id: "local", port: LOCAL_PORT }] }));
const relay = spawn("python3", [join(HERE, "relay.py"), relayDir], { stdio: "ignore" });
await new Promise((resolve) => setTimeout(resolve, 1000));
const feed = spawn("ffmpeg", ["-v", "error", "-re", "-stream_loop", "-1", "-i", FIXTURE, "-c", "copy", "-f", "mpegts", `tcp://127.0.0.1:${LOCAL_PORT + 100}`], { stdio: "ignore" });
try {
  await new Promise((resolve) => setTimeout(resolve, 8000));
  for (const profile of ["cold", "warm"]) await lane("origin local", profile, localOrigin, "frames", noServerState);
} finally {
  feed.kill();
  relay.kill();
}

report();

function report() {
  console.log("\nscenario                                                          buffers  failed");
  for (const s of scenarios) console.log(`${s.name.padEnd(65)} ${`${s.buffersBefore}→${s.buffersAfter}`.padEnd(8)} ${s.failed.join(", ") || "-"}`);
  console.log("\nlane           profile  run  outcome  frames  firstFrame  elapsed  clipBytes  opensΔ  buffers  failed");
  for (const r of results) {
    for (const run of r.runs) {
      console.log(
        [
          r.lane.padEnd(14),
          r.profile.padEnd(7),
          String(run.run).padEnd(4),
          run.outcome.padEnd(8),
          String(run.frames ?? 0).padEnd(7),
          (run.firstFrame?.toFixed(2) ?? "-").padEnd(11),
          run.elapsed.toFixed(2).padEnd(8),
          String(run.clipBytes ?? 0).padEnd(10),
          String(r.opensDelta).padEnd(7),
          `${r.buffersBefore}→${r.peakBuffers}→${r.buffersAfter}`.padEnd(8),
          r.failed.join(",") || "-",
        ].join(" "),
      );
      if (run.failure) console.log(`  ${run.failure}`);
    }
  }
  process.exit(results.some((r) => r.failed.length > 0) || scenarios.some((s) => s.failed.length > 0) ? 1 : 0);
}
