#!/usr/bin/env node
/**
 * abr-drill.mjs: the Slipstream acceptance matrix, run against a shaped link.
 *
 *   node scripts/abr-drill.mjs (--host | --device "Main Bedroom") [--items T101,T102] [--scenarios S1,S2] [--link bps] [--buffer seconds] [--no-window] [--no-cap] [--start 0]
 *
 * --host plays the app's real engine config (captured from startLocalRemux) through the engine's own
 * loopback routes into macOS AVPlayer, with scripts/netsim-proxy.mjs between the engine and Jellyfin.
 * Results append to the drill results file (--results, default $TMPDIR/tomotv-drill) and each
 * run's timeline is kept next to it.
 */
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { devicectl, jf, loadEnv, openDeepLink, pickTarget, simctl } from "./playback-regression.mjs";
import { SCENARIOS, copyBitrates, profileRates, score } from "./lib/abr-score.mjs";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(name);

const PROXY_PORT = Number(opt("--proxy-port", "18096"));
const RESULTS = path.resolve(opt("--results", path.join(os.tmpdir(), "tomotv-drill", "drill-results.md")));
const RUN_DIR = path.join(path.dirname(RESULTS), "runs");
const ITEMS = opt("--items", "T101,T102").split(",");
const IDS = opt("--scenarios", "S1,S2,S3,S4,S5,S6,S7,S8,S9,S10,S11,S12").split(",");
const LINK = opt("--link", null);
// The app sets preferredForwardBufferDuration on rung sessions (useVideoPlayback); the drill mirrors it.
const BUFFER = opt("--buffer", "12");
// The app always renders to a screen, and AVPlayer caps its variant choice without one (measured: S4 never climbed).
const WINDOW = !args.includes("--no-window");
// The app caps AVPlayer to the engine's measured link; the drill does the same so the two match.
const CAP = !args.includes("--no-cap");
const START = Number(opt("--start", "0"));
const FIXTURE_ROOT = path.join(os.homedir(), "Movies", "development-videos");
/** The address the TV reaches this Mac on; the proxy binds every interface. */
const LAN_HOST = opt("--lan-host", null);
const DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";
const DEVICECTL = `${DEVELOPER_DIR}/usr/bin/devicectl`;
/** Longest the app takes from launch to its first probe event. */
const DEVICE_LAUNCH_SEC = 8;

/** Manifest title -> item id, by path under the fixture root (read-only). */
async function resolveIds(env, ids) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "playback", "manifest.json"), "utf8"));
  const wanted = manifest.items.filter((m) => ids.includes(m.id));
  const { Items = [] } = await (await jf(env, "/Items?Recursive=true&EnableTotalRecordCount=false&mediaTypes=Video&fields=Path")).json();
  return wanted.map((m) => {
    const hit = Items.find((it) => it.Path && path.dirname(it.Path) === FIXTURE_ROOT && path.basename(it.Path).replace(/\.[^.]+$/, "") === m.title);
    if (!hit) throw new Error(`${m.id} (${m.title}) is not indexed under ${FIXTURE_ROOT}`);
    return { ...m, itemId: hit.Id };
  });
}

/** Proxies this run started, killed on any exit: a survivor owns the port and shapes the next run. */
const proxies = new Set();

function startProxy(logPath) {
  const child = spawn(process.execPath, [path.join(ROOT, "scripts", "netsim-proxy.mjs"), "--port", String(PROXY_PORT), "--upstream", "http://127.0.0.1:8096", "--log", logPath], { stdio: "ignore" });
  proxies.add(child);
  child.on("close", () => proxies.delete(child));
  return child;
}

for (const signal of ["exit", "SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of proxies) child.kill();
    if (signal !== "exit") process.exit(1);
  });
}

/**
 * One request to the proxy's control route on a socket of its own. The proxy dies and restarts
 * between host scenarios, and a pooled socket to the dead one crashes Node's fetch outright
 * (undici: setTypeOfService EINVAL, uncatchable).
 */
function netsim(method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PROXY_PORT, path: "/__netsim", method, agent: false }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => (res.statusCode === 200 ? resolve(JSON.parse(text || "{}")) : reject(new Error(`netsim control -> HTTP ${res.statusCode}`))));
    });
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

/** A proxy left behind by an earlier run answers on the port and silently shapes this one. */
async function requireFreePort() {
  const state = await netsim().catch(() => null);
  if (state) throw new Error(`a netsim proxy is already on :${PROXY_PORT} (kbps ${state.kbps}, served ${state.served}); kill it before running`);
}

const control = (body) => netsim("POST", body);

async function waitForProxy() {
  for (let i = 0; i < 50; i++) {
    if (await netsim().catch(() => null)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("netsim proxy did not start");
}

async function captureConfig(env, item, outPath) {
  await exec("npx", ["jest", "test/playback/drill", "--silent"], {
    cwd: ROOT,
    // DRILL_SERVER is what the captured config points at (the shaped proxy); the item itself is read
    // from the server directly, so the capture is not paced by the scenario's link.
    env: {
      ...process.env,
      DRILL_ITEM_ID: item.itemId,
      DRILL_OUT: outPath,
      DRILL_SERVER: `http://127.0.0.1:${PROXY_PORT}`,
      DRILL_UPSTREAM: env.JELLYFIN_URL,
      DRILL_API_KEY: env.JELLYFIN_API_KEY,
      DRILL_START: String(START),
    },
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function hostRun(configPath, scenario, timelinePath, logPath) {
  const child = spawn("swift", ["test", "--package-path", "native/ios", "--filter", "SlipstreamDrillTests"], {
    cwd: ROOT,
    env: {
      ...process.env,
      DEVELOPER_DIR,
      TOMO_DRILL_CONFIG: configPath,
      TOMO_DRILL_OUT: timelinePath,
      TOMO_DRILL_PROXY: `http://127.0.0.1:${PROXY_PORT}`,
      TOMO_DRILL_PROFILE: JSON.stringify(scenario.profile),
      TOMO_DRILL_SECONDS: String(scenario.seconds),
      ...(LINK ? { TOMO_DRILL_LINK: LINK } : {}),
      ...(BUFFER ? { TOMO_DRILL_BUFFER: BUFFER } : {}),
      ...(WINDOW ? { TOMO_DRILL_WINDOW: "1" } : {}),
      ...(CAP ? { TOMO_DRILL_CAP: "1" } : {}),
      ...(scenario.breakPath ? { TOMO_DRILL_BREAK: scenario.breakPath } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let tail = "";
  const log = logPath ? fs.createWriteStream(logPath) : null;
  const keep = (d) => {
    log?.write(d);
    tail = (tail + d).slice(-4000);
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const code = await new Promise((resolve) => child.on("close", resolve));
  if (code !== 0) throw new Error(`host drill exited ${code}\n${tail}`);
}

const readTimeline = (p) =>
  fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

/** The TV's own Jellyfin credentials, read out of the desktop server's database (read-only). */
function deviceCredentials(deviceName) {
  const db = path.join(os.homedir(), "Library", "Application Support", "jellyfin", "data", "jellyfin.db");
  const sql = `SELECT AccessToken, UserId, DeviceId FROM Devices WHERE DeviceName LIKE '%${deviceName.replace(/'/g, "")}%' ORDER BY DateLastActivity DESC LIMIT 1;`;
  const stdout = execFileSync("sqlite3", ["-readonly", "-separator", "\t", db, sql], { encoding: "utf8" });
  const [token, userId, deviceId] = stdout.trim().split("\t");
  if (!token || !userId) throw new Error(`no Jellyfin device row matching "${deviceName}"; play something on the TV once`);
  return { token, userId, deviceId };
}

/** Clears the fixture's resume point, so every run opens the item at the start. */
async function resetResume(env, itemId, userId) {
  await jf(env, `/UserPlayedItems/${itemId}?userId=${userId}`, { method: "DELETE" });
}

const served = async () => (await netsim()).served;

/**
 * Points the app at a server URL through dev-session, keeping its own identity. A deep link that
 * lands before the JS router is ready is dropped silently, so a sign-in onto the proxy is confirmed
 * by traffic arriving there (measured: one run played the server direct and read 70 Mb/s).
 */
async function signInto(env, target, serverUrl, credentials) {
  const info = await (await fetch(`${serverUrl}/System/Info/Public`)).json();
  const query = new URLSearchParams({
    server: serverUrl,
    token: credentials.token,
    userId: credentials.userId,
    userName: "drill",
    serverName: info.ServerName ?? serverUrl,
    serverId: info.Id ?? "",
    ...(credentials.deviceId ? { deviceId: credentials.deviceId } : {}),
  });
  const throughProxy = serverUrl.includes(`:${PROXY_PORT}`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const before = throughProxy ? await served() : 0;
    await openDeepLink(env, target, `tomotv://dev-session?${query}`);
    await new Promise((r) => setTimeout(r, 12000));
    if (!throughProxy) return;
    for (let i = 0; i < 20; i++) {
      if ((await served()) > before) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log(`  sign-in ${attempt}/3 did not reach the proxy, relaunching`);
  }
  throw new Error(`${target.name} never read through the proxy after signing in`);
}

async function simulatorRun(env, target, item, scenario, base) {
  const consoleLog = `${base}-console.log`;
  const probeFile = `${base}-probe.jsonl`;
  const logStart = new Date().toISOString().slice(0, 19).replace("T", " ") + "+0000";
  await simctl(["terminate", target.udid, env.BUNDLE_ID]).catch(() => {});
  const { stdout } = await simctl(["get_app_container", target.udid, env.BUNDLE_ID, "data"]);
  const sourceProbe = path.join(stdout.trim(), "Library/Caches/playback-probe.jsonl");
  if (fs.existsSync(sourceProbe)) fs.renameSync(sourceProbe, `${sourceProbe}.before-${path.basename(base)}`);
  try {
    await simctl(["launch", target.udid, env.BUNDLE_ID], {
      env: { ...process.env, SIMCTL_CHILD_TOMO_REQUEST_LOG: "1" },
    });
    await new Promise((resolve) => setTimeout(resolve, DEVICE_LAUNCH_SEC * 1000));
    await control({ profile: scenario.profile, refuse: scenario.refuse ?? null, rttMs: scenario.rttMs ?? 0 });
    await openDeepLink(env, target, `tomotv://player?videoId=${item.itemId}&probe=1${START ? `&startTicks=${Math.round(START * 10_000_000)}` : ""}`);
    await new Promise((resolve) => setTimeout(resolve, (scenario.seconds + DEVICE_LAUNCH_SEC) * 1000));
    const endedAt = Date.now();
    if (!fs.existsSync(sourceProbe)) throw new Error("simulator did not write a playback probe");
    fs.copyFileSync(sourceProbe, probeFile);
    const logs = await simctl(
      [
        "spawn",
        target.udid,
        "log",
        "show",
        "--start",
        logStart,
        "--style",
        "syslog",
        "--predicate",
        'process == "TomoTV" AND (eventMessage CONTAINS "[LocalHTTPServer]" OR eventMessage CONTAINS "[LocalRemuxer]")',
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    fs.writeFileSync(consoleLog, logs.stdout);
    return { consoleLog, probeFile, endedAt };
  } finally {
    await simctl(["terminate", target.udid, env.BUNDLE_ID]).catch(() => {});
  }
}

/** One device run: launch the item, apply the profile, collect the probe file and the engine log. */
async function deviceRun(env, device, item, scenario, base) {
  const consoleLog = `${base}-console.log`;
  const probeFile = `${base}-probe.jsonl`;
  const blank = `${base}-blank`;
  fs.mkdirSync(blank, { recursive: true });
  fs.writeFileSync(path.join(blank, "playback-probe.jsonl"), "");
  const copy = (direction, source, destination) =>
    devicectl(["device", "copy", direction, "--device", device, "--domain-type", "appDataContainer", "--domain-identifier", env.BUNDLE_ID, "--source", source, "--destination", destination]);
  await copy("to", path.join(blank, "playback-probe.jsonl"), "Library/Caches/playback-probe.jsonl").catch(() => {});

  const out = fs.openSync(consoleLog, "w");
  const child = spawn(
    DEVICECTL,
    [
      "device",
      "process",
      "launch",
      "--device",
      device,
      "--terminate-existing",
      "--console",
      "--payload-url",
      `tomotv://player?videoId=${item.itemId}&probe=1${START ? `&startTicks=${Math.round(START * 10_000_000)}` : ""}`,
      env.BUNDLE_ID,
    ],
    // devicectl forwards DEVICECTL_CHILD_-prefixed variables to the app; the same flag passed as an
    // argument is parsed by devicectl itself ("-t YES").
    { stdio: ["ignore", out, out], env: { ...process.env, DEVICECTL_CHILD_TOMO_REQUEST_LOG: "1" } },
  );
  await control({ profile: scenario.profile, refuse: scenario.refuse ?? null, rttMs: scenario.rttMs ?? 0 });
  // The recording's clock starts at the app's first probe event, seconds after this launch: the
  // wait runs that much longer, or every device recording ends short of its scenario.
  await new Promise((r) => setTimeout(r, (scenario.seconds + DEVICE_LAUNCH_SEC) * 1000));
  const endedAt = Date.now();
  child.kill();
  fs.closeSync(out);
  await copy("from", "Library/Caches/playback-probe.jsonl", probeFile).catch(() => {});
  return { consoleLog, probeFile, endedAt };
}

/** The app's probe events and the engine's request log, in the shape the scorer reads. */
export function deviceTimeline({ consoleLog, probeFile, endedAt }) {
  const timeline = [];
  const probe = fs.existsSync(probeFile) ? readTimeline(probeFile) : [];
  const t0 = probe[0]?.t ?? endedAt ?? Date.now();
  const at = (t) => t - t0;
  timeline.push({ kind: "start", ms: 0, epochMs: probe[0]?.t });
  let lastPosition = -1;
  let buffering = false;
  let streams = 0;
  /** A climb rebuilds the session, so the stream event that follows it is that rebuild, not a reload. */
  let climbing = false;
  for (const e of probe) {
    if (endedAt != null && e.t > endedAt) continue;
    const ms = at(e.t);
    if (e.event === "progress") {
      const position = e.position ?? 0;
      // A progress event inside a buffering spell is still that spell, or its length reads as zero.
      timeline.push({ kind: "tick", ms, position, ahead: 0, status: buffering ? 1 : 2, advanced: !buffering && position > lastPosition + 0.05 });
      lastPosition = position;
    }
    if (e.event === "displayReady") timeline.push({ kind: "firstFrame", ms, position: e.position });
    if (e.event === "playing") timeline.push({ kind: "playing", ms, position: lastPosition });
    if (e.event === "buffering") buffering = Boolean(e.on);
    // The spell runs to the moment it ends: a last stalled tick there, then the one that closes it.
    if (e.event === "buffering" && !e.on) timeline.push({ kind: "tick", ms, position: e.position ?? lastPosition, ahead: 0, status: 1, advanced: false });
    if (e.event === "buffering") timeline.push({ kind: "tick", ms, position: e.position ?? lastPosition, ahead: 0, status: e.on ? 1 : 2, advanced: !e.on });
    if (e.event === "tracks") timeline.push({ kind: "tracks", ms, audio: e.audio, selected: e.selected, identities: e.identities });
    if (e.event === "textTracks") timeline.push({ kind: "textTracks", ms, subtitles: e.subtitles, selected: e.selected, identities: e.identities });
    if (e.event === "cap") timeline.push({ kind: "cap", ms, mbps: e.bps === null ? 0 : e.bps / 1_000_000 });
    if (e.event === "access") timeline.push({ kind: "access", ms, indicated: e.indicated, position: e.position });
    // The first stream event is the session opening; a later one is a genuine rebuild.
    if (e.event === "stream") {
      timeline.push({ kind: streams++ === 0 || climbing ? "open" : "reload", ms, detail: e.event });
      climbing = false;
    }
    // A hand-over opens the next lane's stream: that event is this one, not a second reload.
    if (e.event === "fallback") {
      const climb = Boolean(e.reason?.includes("recovered"));
      climbing = true;
      timeline.push({ kind: climb ? "climb" : "reload", ms, detail: e.reason, to: e.to });
    }
    if (e.event === "error") timeline.push({ kind: "failed", ms, error: e.message });
  }
  // The engine's own request log: which variant AVPlayer actually fetched, with timings.
  const lines = fs.existsSync(consoleLog) ? fs.readFileSync(consoleLog, "utf8").split("\n") : [];
  for (const line of lines) {
    const m = line.match(/\[LocalHTTPServer\] REQ (\S+) status=(\d+) bytes=(\d+) firstBodyMs=(-?\d+) doneMs=(\d+)/);
    if (!m) continue;
    const stamp = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)/);
    const ms = stamp ? at(Date.parse(stamp[1].replace(" ", "T"))) : 0;
    if (endedAt != null && ms > at(endedAt)) continue;
    timeline.push({ kind: "req", ms, path: m[1], status: Number(m[2]), bytes: Number(m[3]), firstBodyMs: Number(m[4]), doneMs: Number(m[5]) });
  }
  timeline.sort((a, b) => a.ms - b.ms);
  const tracks = timeline.filter((r) => r.kind === "tracks").at(-1);
  const textTracks = timeline.filter((record) => record.kind === "textTracks").at(-1);
  timeline.push({ kind: "end", ms: at(endedAt ?? probe.at(-1)?.t ?? t0), audible: tracks?.audio, legible: textTracks?.subtitles });
  return timeline;
}

async function main() {
  const env = loadEnv();
  if (flag("--host") && (flag("--device") || flag("--udid"))) throw new Error("choose one target: --host, --udid <simulator>, or --device <name>");
  if (flag("--device") && flag("--udid")) throw new Error("choose either --device or --udid");
  const target = flag("--host") ? null : await pickTarget();
  const device = target !== null;
  if (target?.kind === "device" && !LAN_HOST) throw new Error("--lan-host is required for a physical device");
  for (const id of IDS) if (!SCENARIOS[id]) throw new Error(`unknown scenario: ${id}`);
  const proxyHost = target?.kind === "device" ? LAN_HOST : "127.0.0.1";
  await requireFreePort();
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const items = await resolveIds(env, ITEMS);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const head = (await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT })).stdout.trim();
  const dirty = (await exec("git", ["status", "--porcelain"], { cwd: ROOT })).stdout.trim() ? "+dirty" : "";
  const lines = [
    `\n## ${new Date().toISOString()} ${target ? `${target.kind} ${target.name}` : "host"}, link=${LINK ?? "measured"}, buffer=${BUFFER ?? "default"}, window=${WINDOW}, cap=${CAP}, start=${START}s, tree ${head}${dirty}\n`,
  ];
  const credentials = device ? deviceCredentials("Apple TV") : null;
  // One proxy for the whole device run: the app is signed into its address, so it cannot come and
  // go between scenarios the way the host drill's does.
  let deviceProxy = null;
  if (device) {
    deviceProxy = startProxy(path.join(RUN_DIR, `${stamp}-device-proxy.jsonl`));
    await waitForProxy();
  }
  try {
    if (device) {
      console.log(`Signing ${target.name} into the netsim proxy at http://${proxyHost}:${PROXY_PORT}`);
      await signInto(env, target, `http://${proxyHost}:${PROXY_PORT}`, credentials);
    }
    for (const item of items) {
      for (const id of IDS) {
        const scenario = SCENARIOS[id];
        if (id === "S7" && item.id !== "T102") continue;
        // A broken route is set on the host drill's own router; the app has no such seam.
        if (device && scenario.breakPath) continue;
        // The hand-over is the app's move to the server lane; the host drill has no app to make it.
        if (!device && scenario.handsOver) continue;
        const base = path.join(RUN_DIR, `${stamp}-${item.id}-${id}`);
        const proxyPath = device ? path.join(RUN_DIR, `${stamp}-device-proxy.jsonl`) : `${base}-proxy.jsonl`;
        const proxy = device ? null : startProxy(proxyPath);
        try {
          await waitForProxy();
          await control({ kbps: scenario.profile[0].kbps, refuse: scenario.refuse ?? null, rttMs: scenario.rttMs ?? 0 });
          let timeline;
          // The app's own engine config for the item: the drill plays it on the host, and both
          // targets are scored against the ladder and source rate it declares.
          await captureConfig(env, item, `${base}-config.json`);
          const offered = JSON.parse(fs.readFileSync(`${base}-config.json`, "utf8"));
          if (device) {
            await resetResume(env, item.itemId, credentials.userId);
            const collected = target.kind === "sim" ? await simulatorRun(env, target, item, scenario, base) : await deviceRun(env, target.name, item, scenario, base);
            timeline = deviceTimeline(collected);
          } else {
            await hostRun(`${base}-config.json`, scenario, `${base}-timeline.jsonl`, `${base}-engine.log`);
            timeline = readTimeline(`${base}-timeline.jsonl`);
          }
          timeline.push(...profileRates(readTimeline(proxyPath), timeline.find((record) => record.kind === "start")?.epochMs));
          timeline.sort((left, right) => left.ms - right.ms);
          fs.writeFileSync(`${base}-timeline.jsonl`, timeline.map((record) => JSON.stringify(record)).join("\n"));
          const result = score(id, timeline, {
            expectAudio: item.expect?.audioRenditions ?? 1,
            expectSubs: item.expect?.subtitles,
            ladder: (offered.tiers ?? []).map((tier) => tier.bandwidth),
            heights: (offered.tiers ?? []).map((tier) => tier.height),
            sourceBps: offered.sourceBandwidth || offered.bandwidth || 0,
            copyBps: copyBitrates(offered),
          });
          fs.writeFileSync(`${base}-score.json`, JSON.stringify(result, null, 2));
          const startup = `startup ${result.startup.milliseconds === null ? "never" : `${Math.round(result.startup.milliseconds)}ms`}, target ${result.startup.targetMs}ms (${result.startup.meetsTarget ? "met" : "missed"}, informational)`;
          const line = `- ${result.status} ${item.id} ${id} (${result.label}): ${startup}; ${result.checks.map((check) => `${check.ok === null ? "?" : check.ok ? "ok" : "X"} ${check.name} [${check.detail}]`).join("; ")}; delivery diagnostics: ${base}-score.json`;
          console.log(line);
          lines.push(line);
        } catch (error) {
          const line = `- ERROR ${item.id} ${id}: ${error.message.split("\n")[0]}`;
          console.log(line);
          lines.push(line);
        } finally {
          proxy?.kill();
        }
      }
    }
  } finally {
    if (device) {
      // The TV cannot reach this Mac by "localhost"; it is signed back into the LAN address.
      const home = target.kind === "device" ? env.JELLYFIN_URL.replace(/\/\/(localhost|127\.0\.0\.1)/, `//${LAN_HOST}`) : env.JELLYFIN_URL;
      console.log(`Signing ${target.name} back into ${home}`);
      try {
        await control({ kbps: 0, refuse: null, rttMs: 0 });
        await signInto(env, target, home, credentials);
      } finally {
        deviceProxy?.kill();
      }
    }
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.appendFileSync(RESULTS, lines.join("\n") + "\n");
  }
  console.log(`\nresults: ${RESULTS}`);
  if (lines.some((line) => line.startsWith("- FAIL") || line.startsWith("- ERROR") || line.startsWith("- INCOMPLETE"))) process.exitCode = 1;
}

// Only when run as the command; importing this file re-scores saved runs without starting one.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
