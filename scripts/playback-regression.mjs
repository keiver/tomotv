#!/usr/bin/env node
/**
 * Playback regression suite driver.
 *
 * Plays every item in test/playback/manifest.json through the real app on a
 * booted iOS/tvOS simulator by deep-linking the player
 * (tomotv://player?videoId=<id>&probe=1), reads the probe event file the app
 * writes (services/playbackProbe.ts), and asserts:
 *   1. the playback state machine chose the expected mode (direct / localRemux
 *      / transcode) and never silently fell back to the server,
 *   2. playback actually advanced past the manifest's progressMin,
 *   3. for local-remux items, the loopback HLS the engine serves matches the
 *      committed baseline (stream layout; exact packet hashes for stream-copied
 *      video, tolerant frame/duration checks for on-device transcodes).
 *
 * The simulator shares the host network stack, so host ffmpeg/ffprobe read the
 * engine's 127.0.0.1 HLS directly. Validation runs AFTER the play window while
 * the app (and remux session) is still alive, never concurrently with playback.
 *
 * Usage:
 *   npm run test:playback                        all items, booted simulator
 *   npm run test:playback -- --only T05,T07      subset
 *   npm run test:playback -- --update-baselines  record baselines (known-good build)
 *   npm run test:playback -- --udid <UDID>       target (and boot) a specific simulator
 *   npm run test:playback -- --device "Main Bedroom"  a paired device, by devicectl name
 *   npm run test:playback -- --list              print manifest and exit
 *   npm run test:playback -- --preflight         check prerequisites only, play nothing
 *   npm run test:playback -- --verify-manifest   manifest/baseline agreement, no device needed
 *   npm run test:playback -- --json out.json     write the run record for CI
 *
 * Requires: gitignored .env.playback-test with JELLYFIN_URL and
 * JELLYFIN_API_KEY (+ optional BUNDLE_ID, JELLYFIN_USER/JELLYFIN_PASSWORD to
 * sign a dev build in through tomotv://dev-session); ffmpeg/ffprobe on PATH; the app
 * installed on the target simulator with its JS available (Metro running for a
 * dev build).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(ROOT, "test", "playback", "manifest.json");
const BASELINE_DIR = path.join(ROOT, "test", "playback", "baselines");
const ENV_PATH = path.join(ROOT, ".env.playback-test");
const PROBE_FILENAME = "playback-probe.jsonl";
const VERDICTS_FILENAME = "engine-verdicts.json";
const HASH_WINDOW_SECONDS = 30;

/** Directories that hold the fixtures, the same three make-test-media.mjs writes.
 *  Item lookup is anchored here, so a copy of a fixture elsewhere on the server
 *  cannot collide with a test title. */
const DEFAULT_FIXTURE_ROOTS = [
  path.join(os.homedir(), "Movies", "development-videos"),
  path.join(os.homedir(), "Music", "Development Audio"),
  path.join(os.homedir(), "Music", "Development Surround"),
].join(",");

/**
 * Recursively sort object keys so a value can be compared and stored as JSON.
 *
 * The engine plan arrives from a Swift [String: Any] over the bridge, and Swift
 * dictionaries have no stable iteration order (the hash seed changes per
 * process). Identical plans therefore serialise with different key orders on
 * every run, which made a plain JSON.stringify comparison fail 32 items on
 * content that had not changed at all. Canonicalising on the way in fixes both
 * the comparison and the baseline file's git diff.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  }
  return value;
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

export function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    fail(
      `Missing ${ENV_PATH}\nCreate it with:\n  JELLYFIN_URL=http://<server>:8096\n  JELLYFIN_API_KEY=<api key from Dashboard -> API Keys>\n` +
        `  # optional: BUNDLE_ID=dev.keiver.tomotv\n  # optional: JELLYFIN_FIXTURE_ROOTS=${DEFAULT_FIXTURE_ROOTS}\n` +
        `  # optional: JELLYFIN_USER=<name> and JELLYFIN_PASSWORD=<pw> (dev build signs itself in via tomotv://dev-session)`,
    );
  }
  const env = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  // The shell wins: a device run needs the LAN address the app is signed in to,
  // where the file names localhost for the simulator.
  for (const key of ["JELLYFIN_URL", "JELLYFIN_API_KEY", "JELLYFIN_USER", "JELLYFIN_PASSWORD", "BUNDLE_ID", "JELLYFIN_FIXTURE_ROOTS"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  if (!env.JELLYFIN_URL || !env.JELLYFIN_API_KEY) fail(`${ENV_PATH} must define JELLYFIN_URL and JELLYFIN_API_KEY`);
  env.JELLYFIN_URL = env.JELLYFIN_URL.replace(/\/$/, "");
  env.BUNDLE_ID = env.BUNDLE_ID || "dev.keiver.tomotv";
  env.JELLYFIN_FIXTURE_ROOTS = env.JELLYFIN_FIXTURE_ROOTS || DEFAULT_FIXTURE_ROOTS;
  return env;
}

// ---------- Jellyfin ----------

export async function jf(env, pathname, init = {}) {
  const res = await fetch(`${env.JELLYFIN_URL}${pathname}`, {
    ...init,
    // Jellyfin 12 dropped X-Emby-Token: the same key answers 200 through this
    // header and 401 through that one, which read as a dead key for a whole run.
    headers: { Authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Jellyfin ${pathname} -> HTTP ${res.status}`);
  return res;
}

/**
 * Map each manifest title to a Jellyfin item, anchored to the fixture directories.
 * Library names cannot carry the scope: a library nested inside another library's
 * folder indexes empty, and libraries sharing a path answer the same item ids.
 */
export async function resolveItems(env, items) {
  const roots = env.JELLYFIN_FIXTURE_ROOTS.split(",")
    .map((p) => p.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  await jf(env, "/Library/Refresh", { method: "POST" }).catch((e) => console.warn(`  library refresh failed (continuing): ${e.message}`));

  // Live channels are not files under the roots: they resolve by name from the tuner's list.
  const liveResolved = new Map();
  const liveWanted = items.filter((m) => m.live);
  if (liveWanted.length) {
    const { Items = [] } = await (await jf(env, "/LiveTv/Channels?EnableTotalRecordCount=false")).json();
    for (const m of liveWanted) {
      const hit = Items.find((c) => c.Name === m.title);
      if (!hit) fail(`Live channel "${m.title}" is not on the server (the Live TV rig in test/playback/README.md provides it)`);
      liveResolved.set(m.title, { id: hit.Id, path: null });
    }
  }

  const wanted = new Map(items.filter((m) => !m.live).map((m) => [m.title, m]));
  const resolved = new Map();
  const deadline = Date.now() + 90000;
  while (resolved.size < wanted.size && Date.now() < deadline) {
    const res = await jf(env, "/Items?Recursive=true&EnableTotalRecordCount=false&mediaTypes=Video,Audio&fields=Path");
    const { Items = [] } = await res.json();
    const hits = new Map();
    for (const it of Items) {
      if (!it.Path || !roots.includes(path.dirname(it.Path))) continue;
      // Tagged audio is named by embedded metadata title, not filename, so
      // the path stem is checked too.
      const stem = path.basename(it.Path).replace(/\.[^.]+$/, "");
      const title = wanted.has(it.Name) ? it.Name : wanted.has(stem) ? stem : null;
      if (!title) continue;
      if (!hits.has(title)) hits.set(title, new Map());
      hits.get(title).set(it.Id, it.Path);
    }
    // Two ids under one title means two files inside the roots share a name.
    const ambiguous = [...hits].filter(([, v]) => v.size > 1);
    if (ambiguous.length) {
      fail(
        `More than one item matches the same test title:\n  - ${ambiguous
          .map(([t, v]) => `${t}\n      ${[...v.values()].join("\n      ")}`)
          .join("\n  - ")}\n\nKeep one copy inside the fixture roots.`,
      );
    }
    // The source path comes along for expect.audioCopy, which compares the
    // engine's audio packets against the original file's.
    for (const [title, ids] of hits) {
      if (resolved.has(title)) continue;
      const [id, filePath] = [...ids][0];
      resolved.set(title, { id, path: filePath });
    }
    if (resolved.size < wanted.size) await sleep(5000);
  }

  const missing = [...wanted.keys()].filter((t) => !resolved.has(t));
  if (missing.length) {
    fail(
      `Not found under the fixture roots after rescan: ${missing.join(", ")}\n\n` +
        `Roots searched:\n  ${roots.join("\n  ")}\n\n` +
        `A file on disk that answers nothing here is not indexed: its folder has to sit inside a library Jellyfin scans, and a library nested inside another one indexes empty.`,
    );
  }
  return new Map([...resolved, ...liveResolved]);
}

/**
 * Per-packet payload hashes for one audio stream, timestamps excluded.
 *
 * This is what separates a stream COPY from a lossless re-encode. Both produce
 * byte-identical audio once decoded, and both report the same codec, channel
 * count and bit depth, so nothing in the stream summary can tell them apart.
 * The packet payloads can: a copy carries the source's exact frames, while a
 * re-encode rebuilds them with its own block sizes and prediction. PTS is
 * dropped because the engine rebases the timeline.
 */
async function audioPacketHashes(url, seconds = 20) {
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-t", String(seconds), "-i", url, "-map", "0:a:0", "-c", "copy", "-f", "framemd5", "-"], {
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(",").pop().trim());
}

/**
 * Fraction of the served stream's packets that appear verbatim in the source.
 *
 * Deliberately a membership test rather than a positional one. An encoder can
 * mark the first packet with SKIP_SAMPLES priming, which the muxer consumes, so
 * the served stream can start one packet later than the file does while still
 * being a faithful copy. Comparing "first N of each" called that a re-encode
 * (T61 failed, T88 passed, on the same code path), which was the check being
 * wrong rather than the engine.
 *
 * A genuine re-encode shares essentially no payloads with the source, so the
 * ratio separates the two cleanly even though membership is the weaker relation.
 */
function copyRatio(served, source) {
  if (!served.length || !source.length) return 0;
  const pool = new Set(source);
  return served.filter((h) => pool.has(h)).length / served.length;
}

/**
 * Clear resume position + played flag so every run starts at 0. Without this,
 * resume from the previous run seeks the player forward, the engine's
 * seek-restart discards the early segments (and init.mp4 -> 404), and the
 * host-side hash of the first 30s has nothing to read.
 */
async function resetResume(env, itemId, resumeFrom = 0) {
  try {
    // EVERY user, not just the administrator. Resume state is per user, and the
    // app is signed in as whichever account you last used — on this server that
    // is the non-admin "demo". Resetting only the admin left the app's own
    // resume point intact, so each run of an item started where the previous one
    // stopped: T82 (a 30s file) resumed at 22.3s, played to the end, and the
    // session tore down before validation could probe it. The driver has no way
    // to know which account the app holds, and clearing all of them on a test
    // server costs nothing.
    if (!env._userIds) {
      const users = await (await jf(env, "/Users")).json();
      env._userIds = users.map((u) => u.Id).filter(Boolean);
    }
    await Promise.all(
      env._userIds.map((userId) =>
        jf(env, `/UserItems/${itemId}/UserData?userId=${userId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ PlaybackPositionTicks: Math.round(resumeFrom * 10_000_000), Played: false }),
        }),
      ),
    );
  } catch (e) {
    console.log(`    (note: resume reset failed: ${e.message})`);
  }
}

/**
 * Prove the app under test is signed in to the SAME server this run resolves
 * item ids from, by looking for its session on that server after the prewarm
 * launch.
 *
 * Without this the whole matrix fails identically and silently: every item
 * reports "Video not found or unavailable", because ids resolved here do not
 * exist on whatever server the app is actually pointed at. That cost a full
 * 55-item run and a long diagnosis, and the answer was one line of evidence.
 *
 * Polled, not sampled once: the app registers its session on its first
 * authenticated request, which lands a moment after launch.
 */
async function assertAppOnSameServer(env) {
  const deadline = Date.now() + 20000;
  let seen = [];
  while (Date.now() < deadline) {
    try {
      const res = await jf(env, "/Sessions");
      const sessions = await res.json();
      seen = [...new Set(sessions.map((s) => s.Client).filter(Boolean))];
      if (sessions.some((s) => (s.Client ?? "").toLowerCase().includes("tomo"))) return;
    } catch {
      // Server hiccup: keep polling until the deadline rather than failing on one bad read.
    }
    await sleep(2000);
  }
  fail(
    `The app never registered a session on ${env.JELLYFIN_URL}.\n\n` +
      `It is almost certainly signed in to a DIFFERENT server, in which case every item\n` +
      `resolved here is a 404 there and all ${"items"} fail as "Video not found or unavailable".\n\n` +
      `Clients seen on this server: ${seen.length ? seen.join(", ") : "none"}\n\n` +
      `Fix: set JELLYFIN_USER and JELLYFIN_PASSWORD in .env.playback-test so the run signs the app in itself\n` +
      `(dev builds only), or open the app, Settings -> sign out, reconnect to ${env.JELLYFIN_URL}, and re-run.\n` +
      `To confirm what it is talking to: lsof -nP -a -p $(pgrep -f 'TomoTV.app/TomoTV') -i`,
  );
}

/**
 * Signs the app into JELLYFIN_URL through the dev-session deep link when the env names a
 * user; otherwise the app keeps its own account and assertAppOnSameServer checks it.
 */
export async function signInApp(env, target) {
  if (!env.JELLYFIN_USER || !env.JELLYFIN_PASSWORD) return false;
  const deviceId = "tomotv-playback-harness";
  const authHeader = `MediaBrowser Client="Tomo TV", Device="Playback harness", DeviceId="${deviceId}", Version="0"`;
  const authRes = await fetch(`${env.JELLYFIN_URL}/Users/AuthenticateByName`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({ Username: env.JELLYFIN_USER, Pw: env.JELLYFIN_PASSWORD }),
  });
  if (!authRes.ok) fail(`Sign-in as ${env.JELLYFIN_USER} on ${env.JELLYFIN_URL} failed: HTTP ${authRes.status}`);
  const auth = await authRes.json();
  const info = await (await fetch(`${env.JELLYFIN_URL}/System/Info/Public`)).json();
  const query = new URLSearchParams({
    server: env.JELLYFIN_URL,
    token: auth.AccessToken,
    userId: auth.User.Id,
    userName: auth.User.Name,
    serverName: info.ServerName ?? env.JELLYFIN_URL,
    serverId: info.Id ?? "",
    deviceId,
  });
  await openDeepLink(env, target, `tomotv://dev-session?${query}`);
  await sleep(8000);
  console.log(`Signed in as ${auth.User.Name} via dev-session (a fresh install shows tvOS's "Open in Tomo TV?" once; click Open)`);
  return true;
}

async function sessionPosition(env, itemId) {
  try {
    const res = await jf(env, "/Sessions");
    const sessions = await res.json();
    const s = sessions.find((x) => x.NowPlayingItem?.Id === itemId);
    return s ? (s.PlayState?.PositionTicks ?? 0) / 10000000 : null;
  } catch {
    return null;
  }
}

// ---------- Simulator ----------

export async function simctl(cmdArgs, options = {}) {
  return exec("xcrun", ["simctl", ...cmdArgs], { timeout: 30000, ...options });
}

// xcode-select points at CommandLineTools on the dev Mac, so `xcrun devicectl`
// finds nothing. Same path transcode-bench.mjs uses.
const DEVICECTL = "/Applications/Xcode.app/Contents/Developer/usr/bin/devicectl";

export async function devicectl(cmdArgs, options = {}) {
  return exec(DEVICECTL, cmdArgs, { timeout: 180000, ...options });
}

/**
 * What the run drives: a simulator, or a paired device named as devicectl names it.
 *
 * A device is not a nicety. Everything below the app differs there — a real
 * VideoToolbox, a real disk, a real network — and the simulator has no HEVC
 * decoder at all, so a whole class of item can only be judged on hardware.
 */
export async function pickTarget() {
  const name = opt("--device");
  if (!name) return { kind: "sim", ...(await pickSimulator()) };
  const { stdout } = await devicectl(["list", "devices"]).catch((e) => {
    throw new Error(`devicectl failed: ${e.stderr || e.message}`);
  });
  const row = stdout.split("\n").find((l) => l.includes(name));
  if (!row) throw new Error(`No paired device named "${name}":\n${stdout}`);
  // "available (paired)" is a sleeping device, not an absent one: devicectl opens a
  // tunnel on demand. Only "unavailable" is out of reach.
  if (row.includes("unavailable")) throw new Error(`Device "${name}" is unavailable: ${row.trim()}`);
  return { kind: "device", name, udid: null };
}

export function describeTarget(target) {
  return target.kind === "sim" ? `${target.name} (${target.udid})` : `${target.name} (paired device)`;
}

/** Opens a deep link. A device has no `openurl`, so the app is relaunched onto it. */
export async function openDeepLink(env, target, url) {
  if (target.kind === "sim") {
    await simctl(["openurl", target.udid, url]);
    return;
  }
  await devicectl(["device", "process", "launch", "--device", target.name, "--terminate-existing", "--payload-url", url, env.BUNDLE_ID]);
}

/** No devicectl equivalent: every device launch above carries --terminate-existing. */
async function terminateApp(env, target) {
  if (target.kind === "sim") await simctl(["terminate", target.udid, env.BUNDLE_ID]).catch(() => {});
}

async function assertInstalled(env, target) {
  if (target.kind === "sim") {
    await simctl(["get_app_container", target.udid, env.BUNDLE_ID, "app"]);
    return;
  }
  const { stdout } = await devicectl(["device", "info", "apps", "--device", target.name, "--bundle-id", env.BUNDLE_ID]);
  if (!stdout.includes(env.BUNDLE_ID)) throw new Error(`${env.BUNDLE_ID} is not installed on ${target.name}`);
}

/**
 * The probe file the app writes, as a pair of "wipe it" and "read it" calls.
 *
 * On a device both go through `devicectl device copy`, one file at a time: there
 * is no delete, so a stale probe is overwritten with an empty file instead. The
 * app truncates it itself when playback arms the probe, so an empty file and a
 * missing one mean the same thing to it.
 */
function probeAccess(env, target, itemId, work) {
  // The probe rides in Caches, the only directory tvOS guarantees an app can
  // write; the app keeps its verdicts in Documents on iOS and in Caches on tvOS.
  const PROBE_PATH = `Library/Caches/${PROBE_FILENAME}`;
  const VERDICTS_PATHS = [`Documents/${VERDICTS_FILENAME}`, `Library/Caches/${VERDICTS_FILENAME}`];

  if (target.kind === "sim") {
    let root = null;
    return {
      async clear() {
        const { stdout } = await simctl(["get_app_container", target.udid, env.BUNDLE_ID, "data"]);
        root = stdout.trim();
        fs.rmSync(path.join(root, PROBE_PATH), { force: true });
        for (const verdicts of VERDICTS_PATHS) fs.rmSync(path.join(root, verdicts), { force: true });
      },
      read() {
        return readProbe(path.join(root, PROBE_PATH), itemId);
      },
    };
  }

  const blank = path.join(work, "blank");
  const pulled = path.join(work, PROBE_FILENAME);
  const copy = (direction, source, destination) =>
    devicectl(["device", "copy", direction, "--device", target.name, "--domain-type", "appDataContainer", "--domain-identifier", env.BUNDLE_ID, "--source", source, "--destination", destination]);
  return {
    async clear() {
      fs.mkdirSync(blank, { recursive: true });
      fs.writeFileSync(path.join(blank, PROBE_FILENAME), "");
      // An empty verdicts file would throw where the app parses it; "{}" reads as none.
      fs.writeFileSync(path.join(blank, VERDICTS_FILENAME), "{}");
      // devicectl has no delete: an empty file is what "cleared" means here, and
      // the app truncates the probe itself the moment playback arms it.
      await copy("to", path.join(blank, PROBE_FILENAME), PROBE_PATH).catch(() => {});
      for (const verdicts of VERDICTS_PATHS) await copy("to", path.join(blank, VERDICTS_FILENAME), verdicts).catch(() => {});
    },
    async read() {
      fs.rmSync(pulled, { force: true });
      // --destination names the FILE, not a directory to drop it in.
      const ok = await copy("from", PROBE_PATH, pulled)
        .then(() => true)
        .catch(() => false);
      return ok ? readProbe(pulled, itemId) : [];
    },
  };
}

/** Throws rather than exiting, so --preflight can report it beside the other checks. */
export async function pickSimulator() {
  const udid = opt("--udid");
  const { stdout } = await simctl(["list", "devices", "-j"]);
  const devices = Object.values(JSON.parse(stdout).devices).flat();
  if (udid) {
    const dev = devices.find((d) => d.udid === udid);
    if (!dev) throw new Error(`No simulator with UDID ${udid}`);
    if (dev.state !== "Booted") {
      console.log(`Booting ${dev.name}...`);
      await simctl(["boot", udid]);
      await simctl(["bootstatus", udid], { timeout: 120000 });
    }
    return dev;
  }
  const booted = devices.filter((d) => d.state === "Booted");
  if (booted.length !== 1) {
    throw new Error(
      `Need exactly one booted simulator (found ${booted.length}). Boot one or pass --udid <UDID>.\n` +
        devices
          .filter((d) => d.isAvailable)
          .map((d) => `  ${d.udid}  ${d.name}`)
          .join("\n"),
    );
  }
  return booted[0];
}

// ---------- Probe ----------

function readProbe(probePath, itemId) {
  let raw;
  try {
    raw = fs.readFileSync(probePath, "utf8");
  } catch {
    return [];
  }
  const events = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.itemId === itemId) events.push(e);
    } catch {
      // partial trailing line mid-write; ignore
    }
  }
  return events;
}

// ---------- ffmpeg validation ----------

async function ffprobeStreams(url) {
  // Deep probe on purpose. E-AC-3's JOC (Atmos) marker only surfaces once the
  // decoder has parsed enough frames, so at default depth the profile comes back
  // empty and Atmos looks lost when it is merely unread.
  const { stdout } = await exec("ffprobe", ["-v", "error", "-analyzeduration", "20M", "-probesize", "20M", "-of", "json", "-show_streams", "-i", url], {
    timeout: 90000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const streams = JSON.parse(stdout).streams || [];
  const byType = { video: [], audio: [], subtitle: [] };
  // Channel layout and bit depth alongside the codec name. A codec check alone
  // cannot see a downmix or a 24-to-16-bit truncation, and those are exactly
  // the two ways the audio path degrades silently.
  const audioDetail = [];
  for (const s of streams) {
    if (byType[s.codec_type]) byType[s.codec_type].push(s.codec_name);
    if (s.codec_type === "audio") {
      audioDetail.push({
        codec: s.codec_name,
        // "Dolby Digital Plus + Dolby Atmos" for E-AC-3 carrying JOC. This is
        // how Atmos survival is proven without a receiver: the object metadata
        // rides inside the elementary stream, so if the profile still names it,
        // the pipeline did not strip it.
        profile: s.profile ?? null,
        channels: s.channels ?? null,
        layout: s.channel_layout ?? null,
        bitDepth: Number(s.bits_per_raw_sample) || null,
      });
    }
  }
  byType.audioDetail = audioDetail;
  return byType;
}

/**
 * framemd5 over the first HASH_WINDOW_SECONDS of one stream.
 * copy=true hashes the untouched packets (bit-exact for stream-copied video,
 * and the lines embed PTS so timeline shifts change the digest). copy=false
 * decodes (frame count + last PTS are the stable signal for transcoded media).
 */
async function framemd5(url, mapSpec, copy) {
  const codecArgs = copy ? ["-c", "copy"] : [];
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-t", String(HASH_WINDOW_SECONDS), "-i", url, "-map", mapSpec, ...codecArgs, "-f", "framemd5", "-"], {
    timeout: 180000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = stdout.split("\n").filter((l) => l && !l.startsWith("#"));
  const tb = stdout.match(/#tb 0: (\d+)\/(\d+)/);
  const tbNum = tb ? Number(tb[1]) / Number(tb[2]) : 0;
  const lastPts = lines.length ? Number(lines[lines.length - 1].split(",")[2]) * tbNum : 0;
  return { digest: createHash("md5").update(stdout).digest("hex"), frames: lines.length, lastPtsSec: Number(lastPts.toFixed(2)) };
}

/** Container duration in seconds, or null when ffprobe cannot read it. */
async function mediaDuration(file) {
  try {
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { timeout: 20000 });
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

async function validateRemuxOutput(item, masterUrl, updateBaselines, sourcePath, events = []) {
  const problems = [];
  const streams = await ffprobeStreams(masterUrl);
  const expect = item.expect || {};
  // The engine's own account of what it decided, emitted from the pipeline
  // thread the moment the renditions exist (services/localRemux.ts). Everything
  // else here infers the decision from the output; this is the one source that
  // reports it.
  const plan = events.find((e) => e.event === "enginePlan") || null;

  if (expect.video && !streams.video.includes(expect.video)) problems.push(`video codec ${JSON.stringify(streams.video)}, expected ${expect.video}`);
  if (expect.audio && !streams.audio.includes(expect.audio)) problems.push(`audio codec ${JSON.stringify(streams.audio)}, expected ${expect.audio}`);
  if (expect.subtitles !== undefined && streams.subtitle.length !== expect.subtitles) problems.push(`${streams.subtitle.length} subtitle renditions, expected ${expect.subtitles}`);
  if (expect.audioRenditions !== undefined && streams.audio.length !== expect.audioRenditions) problems.push(`${streams.audio.length} audio renditions, expected ${expect.audioRenditions}`);

  // Guards the two silent degradations: losing channels to a downmix, and
  // losing depth because the encoder's first sample format was 16-bit.
  if (expect.audioChannels !== undefined && !streams.audioDetail.some((a) => a.channels === expect.audioChannels)) {
    problems.push(`audio channels ${JSON.stringify(streams.audioDetail.map((a) => a.channels))}, expected ${expect.audioChannels}`);
  }
  if (expect.audioBitDepth !== undefined && !streams.audioDetail.some((a) => a.bitDepth === expect.audioBitDepth)) {
    problems.push(`audio bit depth ${JSON.stringify(streams.audioDetail.map((a) => a.bitDepth))}, expected ${expect.audioBitDepth}`);
  }

  // Atmos survival, provable without a receiver: the JOC object metadata lives
  // inside the E-AC-3 elementary stream, so if the decoder still names the
  // profile on what the engine serves, the pipeline preserved it.
  if (expect.audioProfile !== undefined && !streams.audioDetail.some((a) => a.profile === expect.audioProfile)) {
    problems.push(`audio profile ${JSON.stringify(streams.audioDetail.map((a) => a.profile))}, expected ${JSON.stringify(expect.audioProfile)}`);
  }

  // Proves the audio was COPIED rather than re-encoded, which no amount of
  // stream metadata can show: identical codec, channels and depth result either
  // way. Only the packet payloads differ.
  if (expect.audioCopy) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      problems.push(`audioCopy check needs the source file; Jellyfin reported ${sourcePath || "no path"}`);
    } else {
      // The source window is wider than the served one so a packet-level offset
      // (encoder priming) cannot push served packets outside it.
      const [served, original] = await Promise.all([audioPacketHashes(masterUrl, 20), audioPacketHashes(sourcePath, 40)]);
      if (!served.length || !original.length) problems.push("audioCopy check could not hash one of the streams");
      else {
        const ratio = copyRatio(served, original);
        if (ratio < 0.95) problems.push(`only ${(ratio * 100).toFixed(1)}% of audio packets match the source: stream was re-encoded, not copied`);
      }
    }
  }

  // Cross-check the engine's claim against the packet evidence. These two
  // disagreeing is the interesting failure: it means the engine believes it is
  // copying while the bytes say otherwise (or the reverse), which no
  // single-sided check can catch.
  if (plan) {
    const copied = plan.audio.filter((track) => track.action === "copy");
    if (expect.audioCopy && copied.length === 0) {
      problems.push(`engine reports every audio track encoded (${plan.audio.map((t) => t.encoder || "?").join(", ")}) but the manifest expects a copy`);
    }
    if (expect.audioCopy === false && copied.length > 0) {
      problems.push(`engine reports audio stream ${copied.map((t) => t.streamIndex).join(", ")} copied, but the manifest expects a re-encode`);
    }
  } else if (item.expect) {
    problems.push("no enginePlan event: the remux engine did not report its decisions (native emitter or its JS listener is broken)");
  }

  if (expect.videoRange || expect.subtitles !== undefined || expect.tierVariant !== undefined || expect.imageSubtitleSets !== undefined) {
    const master = await (await fetch(masterUrl, { signal: AbortSignal.timeout(10000) })).text();
    if (expect.videoRange && !master.includes(`VIDEO-RANGE=${expect.videoRange}`)) problems.push(`master playlist missing VIDEO-RANGE=${expect.videoRange}`);

    // Slipstream gateway shape. tierVariant pins whether the master offers server rungs at all
    // (eligibility is SDR + audio + a server source, so an HDR fixture asserts absence). The rungs
    // ride their own low audio group by design; what must hold is that a switch between them never
    // moves the viewer's subtitles, and that each BANDWIDTH counts the group it plays with
    // (RFC 8216 4.3.4.2). The harness link is fast, so the copy is listed beside them.
    const variants = [];
    {
      const lines = master.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
        const uri = lines.slice(i + 1).find((line) => line.trim() && !line.startsWith("#")) ?? "";
        variants.push({
          uri: uri.trim(),
          line: lines[i],
          audio: /AUDIO="([^"]*)"/.exec(lines[i])?.[1] ?? null,
          subs: /SUBTITLES="([^"]*)"/.exec(lines[i])?.[1] ?? null,
          bandwidth: Number(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] ?? 0),
          codecs: /CODECS="([^"]*)"/.exec(lines[i])?.[1] ?? "",
        });
      }
    }
    if (expect.tierVariant !== undefined) {
      const rungs = variants.filter((v) => /^t\d+\.m3u8$/.test(v.uri));
      if (expect.tierVariant && rungs.length === 0) problems.push("master playlist offers no Slipstream rung");
      if (!expect.tierVariant && rungs.length > 0) problems.push(`master playlist offers ${rungs.length} Slipstream rungs for an ineligible item`);
      if (expect.tierVariant && rungs.length > 0) {
        const copy = variants.find((v) => v.uri === "media.m3u8");
        if (!copy) problems.push("master playlist withholds the on-device copy on a link that carries it");
        if (copy && new Set([copy, ...rungs].map((v) => v.subs)).size > 1) problems.push("variants name different SUBTITLES groups: a switch would drop subtitles");
        if (rungs.some((rung) => rung.audio !== "audio-lo")) problems.push("a rung does not name the audio-lo group, so its audio comes from the engine it exists to relieve");
        if (rungs.some((rung) => rung.codecs && !rung.codecs.includes(","))) problems.push("a rung's CODECS omits the audio codec of its group");
        const ascending = rungs.every((rung, i) => i === 0 || rung.bandwidth > rungs[i - 1].bandwidth);
        if (!ascending) problems.push(`rung BANDWIDTHs are not ascending: ${rungs.map((r) => r.bandwidth).join(", ")}`);
      }
    }

    // Without this, the player cannot rule out captions embedded in the video
    // and offers a legible option with an empty title that AVKit lists as "CC"
    // and that draws nothing. Seen on T88, which has no subtitle streams at all.
    // A source whose copied packets carry A/53 captions names a group instead.
    if (variants.some((v) => !v.line.includes("CLOSED-CAPTIONS="))) problems.push("an EXT-X-STREAM-INF does not declare CLOSED-CAPTIONS, so the player will offer a phantom CC track");

    // Apple's authoring specification requires these on every variant that has
    // video: RESOLUTION (9.2), FRAME-RATE (9.15) and AVERAGE-BANDWIDTH (9.14).
    // All three describe the source we copy and come from Jellyfin's metadata.
    for (const [attribute, requirement] of [
      ["RESOLUTION=", "9.2"],
      ["FRAME-RATE=", "9.15"],
      ["AVERAGE-BANDWIDTH=", "9.14"],
    ]) {
      if (!master.includes(attribute)) problems.push(`EXT-X-STREAM-INF is missing ${attribute.slice(0, -1)}, required by authoring spec ${requirement}`);
    }

    // The whole CODECS string, not just its presence. Every combination was
    // diffed against the string Jellyfin publishes for the same bitstream, so
    // this pins the formula end to end rather than trusting it.
    if (expect.codecs) {
      const actual = /CODECS="([^"]*)"/.exec(master)?.[1];
      if (actual !== expect.codecs) problems.push(`CODECS is ${JSON.stringify(actual ?? null)}, expected ${JSON.stringify(expect.codecs)}`);
    }

    // The count above is what ffprobe found in the served stream. This is what
    // the master playlist ADVERTISES, which is a different claim and the one
    // the app resolves a viewer's pick against.
    //
    // A disc's PGS tracks carry no language and no title, so Jellyfin labels
    // every one of them identically. That collapsed the app's lookup onto the
    // last track and made AVKit list a column of identical rows, and nothing
    // here could see it: T85 and T86 validate "none", so the suite only proved
    // they played. Prove the group is well formed instead — distinct names, and
    // the single DEFAULT=YES RFC 8216 allows.
    if (expect.subtitles !== undefined) {
      const renditions = master.split("\n").filter((line) => line.startsWith("#EXT-X-MEDIA:") && line.includes("TYPE=SUBTITLES"));
      const names = renditions.map((line) => /NAME="([^"]*)"/.exec(line)?.[1] ?? "");
      const defaults = renditions.filter((line) => line.includes("DEFAULT=YES"));

      if (renditions.length !== expect.subtitles) problems.push(`master playlist advertises ${renditions.length} subtitle renditions, expected ${expect.subtitles}`);
      if (new Set(names).size !== names.length) {
        const repeated = [...new Set(names.filter((name, at) => names.indexOf(name) !== at))];
        problems.push(`subtitle renditions share names (${repeated.map((name) => JSON.stringify(name)).join(", ")}): a pick cannot resolve to one track`);
      }
      if (defaults.length > 1) problems.push(`${defaults.length} subtitle renditions marked DEFAULT=YES; RFC 8216 allows one per group and AVFoundation rejects the playlist`);
      if (names.some((name) => !name)) problems.push("a subtitle rendition carries no NAME attribute");

      // AVKit withholds a FORCED=YES rendition from the subtitle picker, as
      // something it applies for the viewer rather than something the viewer
      // picks — and then does not apply it. A group where every member is
      // forced is therefore a group the viewer cannot reach at all: T05 shipped
      // one and lost its only subtitle track, on screen and in the picker.
      if (renditions.length > 0 && renditions.every((line) => line.includes("FORCED=YES"))) {
        problems.push(`all ${renditions.length} subtitle renditions are FORCED=YES, so AVKit offers the viewer no way to reach any of them`);
      }
    }

    // Everything above proves a rendition is ADVERTISED. None of it proves a
    // bitmap decoded, and those are different claims: a zlib-compressed PGS
    // track on a build without zlib advertises normally and draws nothing.
    // The engine's own display-set manifest is the only evidence of pixels.
    if (expect.imageSubtitleSets !== undefined) {
      const uris = master
        .split("\n")
        .filter((line) => line.startsWith("#EXT-X-MEDIA:") && line.includes("TYPE=SUBTITLES"))
        .map((line) => /URI="([^"]+)"/.exec(line)?.[1])
        .filter(Boolean);

      const counts = [];
      for (const uri of uris) {
        const stream = /sub(\d+)\.m3u8/.exec(uri)?.[1];
        if (!stream) continue;
        // Only an image track serves a pgsN.json; a text track 404s here.
        const url = new URL(`pgs${stream}.json`, new URL(uri, masterUrl)).href;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) }).catch(() => null);
        if (!res?.ok) continue;
        const manifest = await res.json().catch(() => null);
        if (manifest) counts.push({ stream: Number(stream), sets: manifest.events?.length ?? 0 });
      }

      const total = counts.reduce((sum, entry) => sum + entry.sets, 0);
      if (total < expect.imageSubtitleSets) {
        const detail = counts.length ? counts.map((c) => `stream ${c.stream}: ${c.sets}`).join(", ") : "no pgsN.json served by the session";
        problems.push(`image subtitle tracks decoded ${total} display sets, expected at least ${expect.imageSubtitleSets} (${detail})`);
      }
    }
  }

  // Everything above needs no baseline, so it now runs for `validate: "none"`
  // items too. Their expect blocks used to be dead: the whole function was
  // gated on the hash policy, which is why T85's 13 identically-named PGS
  // renditions got past the very check written for them.
  if (item.validate === "none") return { problems, note: problems.length ? "FAIL" : "expect only" };

  const exact = item.validate === "copy";
  const video = await framemd5(masterUrl, "0:v:0", exact);
  // Some sources carry no audio at all (T27's VC1 wmv is video-only).
  const audio = streams.audio.length > 0 ? await framemd5(masterUrl, "0:a:0", false) : null;

  const baselinePath = path.join(BASELINE_DIR, `${item.id}.json`);
  const current = {
    streams,
    // Pinned like the streams are: a change in which soundtracks the engine
    // copies, which encoder it picks, or the layout and depth it targets is
    // exactly the kind of silent regression the output-side probes missed.
    // The session token is deliberately absent from the emitted payload, and
    // canonical() sorts the keys the Swift bridge hands over in arbitrary
    // order, so this is stable run to run.
    enginePlan: plan ? canonical({ video: plan.video, audio: plan.audio }) : null,
    video: { policy: item.validate, ...video },
    audio: audio ? { frames: audio.frames, lastPtsSec: audio.lastPtsSec } : null,
  };
  if (!exact) delete current.video.digest;

  if (updateBaselines) {
    // Refuse to pin a truncated capture. T27's baseline was recorded from one:
    // 449 frames ending at 17.92s inside a 30s window, because the item had
    // resumed mid-file and the engine's seek-restart discarded the early
    // segments. It recorded silently and only surfaced as a failure a run
    // later, where it read like a regression instead of a bad baseline.
    const sourceSeconds = sourcePath ? await mediaDuration(sourcePath) : null;
    const expectedWindow = sourceSeconds ? Math.min(HASH_WINDOW_SECONDS, sourceSeconds) : HASH_WINDOW_SECONDS;
    if (video.lastPtsSec < expectedWindow - 3) {
      problems.push(
        `refusing to write a truncated baseline: video reaches only ${video.lastPtsSec}s of an expected ${expectedWindow.toFixed(1)}s window ` +
          `(${video.frames} frames). The session was probably restarted by a seek, or playback ran past the end of the file.`,
      );
      return { problems, note: "capture rejected" };
    }
    fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2) + "\n");
    return { problems, note: "baseline written" };
  }

  if (!fs.existsSync(baselinePath)) {
    problems.push(`no baseline (run with --update-baselines on a known-good build)`);
    return { problems };
  }
  const base = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

  if (JSON.stringify(base.streams) !== JSON.stringify(streams)) problems.push(`stream layout changed: ${JSON.stringify(streams)} vs baseline ${JSON.stringify(base.streams)}`);
  // canonical() on the baseline too, so baselines written before the plan was
  // canonicalised still compare on content rather than key order.
  if (JSON.stringify(canonical(base.enginePlan)) !== JSON.stringify(current.enginePlan)) {
    problems.push(`engine plan changed: ${JSON.stringify(current.enginePlan)} vs baseline ${JSON.stringify(base.enginePlan)}`);
  }
  if (exact && base.video.digest !== video.digest) problems.push(`stream-copied video packet hashes diverged from baseline (bitstream or timestamps changed)`);
  const frameTolerance = Math.max(5, base.video.frames * 0.05);
  if (Math.abs(base.video.frames - video.frames) > frameTolerance) problems.push(`video frames in first ${HASH_WINDOW_SECONDS}s: ${video.frames} vs baseline ${base.video.frames}`);
  if (Math.abs(base.video.lastPtsSec - video.lastPtsSec) > 2) problems.push(`video last PTS ${video.lastPtsSec}s vs baseline ${base.video.lastPtsSec}s`);
  if (base.audio && audio) {
    const audioFrameTolerance = Math.max(10, base.audio.frames * 0.05);
    if (Math.abs(base.audio.frames - audio.frames) > audioFrameTolerance) problems.push(`audio frames in first ${HASH_WINDOW_SECONDS}s: ${audio.frames} vs baseline ${base.audio.frames}`);
    if (Math.abs(base.audio.lastPtsSec - audio.lastPtsSec) > 2) problems.push(`audio last PTS ${audio.lastPtsSec}s vs baseline ${base.audio.lastPtsSec}s`);
  } else if (!!base.audio !== !!audio) {
    problems.push(`audio presence changed: ${audio ? "now has audio" : "audio disappeared"} vs baseline`);
  }
  return { problems };
}

/**
 * Server-HLS subtitle-sync invariant (validate: "subsync", mode: transcode).
 *
 * Jellyfin stamps every HLS WebVTT segment with X-TIMESTAMP-MAP=MPEGTS:900000
 * (10s), which players apply against the media segments' internal PTS base.
 * MPEG-TS segments start at ~10s so the delta is zero; fMP4 segments start at
 * 0, which displaced every cue by 10 seconds (the 2026-08-10 Star Trek bug).
 * The app therefore requests SegmentContainer=ts whenever text renditions ride
 * (services/jellyfin/streamUrls.ts). This check fails if that regresses:
 * no subtitle rendition in the master, segments not mpegts, or
 * |timestamp map - first segment PTS| above half a second.
 */
async function validateSubtitleSync(masterUrl) {
  const problems = [];
  const get = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`GET ${res.status} ${new URL(url).pathname}`);
    return res.text();
  };
  const firstUri = (playlist) =>
    playlist
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#"));

  const master = await get(masterUrl);
  const subMedia = master.split("\n").find((l) => l.startsWith("#EXT-X-MEDIA:") && l.includes("TYPE=SUBTITLES"));
  const subUri = subMedia?.match(/URI="([^"]+)"/)?.[1];
  if (!subUri) return ["master playlist has no subtitle rendition (SubtitleMethod=Hls missing or renditions dropped)"];

  const videoPlaylistUri = firstUri(master);
  if (!videoPlaylistUri) return ["master playlist has no variant stream"];
  const videoPlaylistUrl = new URL(videoPlaylistUri, masterUrl).href;
  const segUri = firstUri(await get(videoPlaylistUrl));
  if (!segUri) return ["video media playlist has no segments yet"];

  // The app session is still alive here, and its AVPlayer read-ahead can trip
  // Jellyfin's gap-seek (kills the from-zero ffmpeg mid-probe -> transient 5XX
  // on segment 0, server-logged as "A task was canceled"). A delayed retry
  // lands after the seek settles and spawns a fresh from-zero job.
  const probeSegment = () => exec("ffprobe", ["-v", "error", "-of", "json", "-show_format", "-i", new URL(segUri, videoPlaylistUrl).href], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  const { stdout } = await probeSegment().catch(async () => {
    await new Promise((r) => setTimeout(r, 4000));
    return probeSegment();
  });
  const fmt = JSON.parse(stdout).format || {};
  const segStart = Number(fmt.start_time ?? NaN);
  if (!(fmt.format_name || "").includes("mpegts")) {
    problems.push(`media segments are "${fmt.format_name}", expected mpegts (SegmentContainer=ts regressed to fMP4, which offsets cues by ~10s)`);
  }

  const subPlaylistUrl = new URL(subUri, masterUrl).href;
  const vttUri = firstUri(await get(subPlaylistUrl));
  if (!vttUri) return [...problems, "subtitle media playlist has no segments"];
  const vtt = await get(new URL(vttUri, subPlaylistUrl).href);
  const map = vtt.match(/X-TIMESTAMP-MAP=MPEGTS:(\d+)/);
  if (!map) return [...problems, "WebVTT segment has no X-TIMESTAMP-MAP (Jellyfin behavior changed; re-derive the sync model before trusting this lane)"];

  const mapSec = Number(map[1]) / 90000;
  if (Number.isNaN(segStart)) {
    problems.push("could not read first media segment start_time");
  } else if (Math.abs(mapSec - segStart) > 0.5) {
    problems.push(`subtitle timestamp map ${mapSec.toFixed(2)}s vs segment PTS base ${segStart.toFixed(2)}s: cues offset by ${(mapSec - segStart).toFixed(2)}s`);
  }
  return problems;
}

/**
 * Live window invariants (validate: "live", mode: localRemux). The engine's live playlist never
 * ends, slides (its newest segment advances between two reads), carries the spec's live tags,
 * and the master offers every audio track the source carries.
 */
async function validateLiveOutput(masterUrl, item) {
  const problems = [];
  const get = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`GET ${res.status} ${new URL(url).pathname}`);
    return res.text();
  };
  const lines = (playlist) => playlist.split("\n").map((l) => l.trim());
  const tag = (playlist, name) => lines(playlist).find((l) => l.startsWith(name));
  const newest = (playlist) =>
    Math.max(
      -1,
      ...lines(playlist)
        .filter((l) => /^seg\d+\.m4s$/.test(l))
        .map((l) => Number(l.slice(3, -4))),
    );

  const master = await get(masterUrl);
  const audioRenditions = lines(master).filter((l) => l.startsWith("#EXT-X-MEDIA:") && l.includes("TYPE=AUDIO")).length;
  const variantUri = lines(master).find((l) => l && !l.startsWith("#"));
  if (!variantUri) return ["master playlist has no variant stream"];
  const mediaUrl = new URL(variantUri, masterUrl).href;

  const first = await get(mediaUrl);
  if (tag(first, "#EXT-X-ENDLIST")) problems.push("live playlist carries EXT-X-ENDLIST");
  if (tag(first, "#EXT-X-PLAYLIST-TYPE")) problems.push("live playlist carries EXT-X-PLAYLIST-TYPE");
  for (const required of ["#EXT-X-MEDIA-SEQUENCE:", "#EXT-X-TARGETDURATION:", "#EXT-X-PROGRAM-DATE-TIME:", "#EXT-X-MAP:"]) {
    if (!tag(first, required)) problems.push(`live playlist lacks ${required}`);
  }
  await sleep(14000);
  const second = await get(mediaUrl);
  if (newest(second) <= newest(first)) problems.push(`window did not advance in 14s (newest segment ${newest(first)} -> ${newest(second)})`);

  const expectedAudio = item.expect?.audioTracks;
  if (expectedAudio != null) {
    // A lone track rides muxed in the variant (no EXT-X-MEDIA); several ride as renditions.
    const served = audioRenditions > 0 ? audioRenditions : 1;
    if (served !== expectedAudio) problems.push(`master offers ${served} audio track(s), expected ${expectedAudio}`);
  }
  if (item.expect?.discontinuity && !tag(second, "#EXT-X-DISCONTINUITY")) problems.push("no EXT-X-DISCONTINUITY in the window after the splice");
  return problems;
}

// ---------- Per-item run ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runItem(env, target, item, resolved, updateBaselines, work) {
  const { id: itemId, path: sourcePath } = resolved;
  const result = { id: item.id, expected: item.mode, actual: "-", position: 0, validation: "-", problems: [] };
  await terminateApp(env, target);
  // resumeFrom items deliberately start mid-file: the app then auto-seeks on
  // open, which drives the engine's seek-restart. That is the path a real
  // Continue Watching launch takes on every play, and the one the suite used to
  // skip entirely by always clearing the position — which is how an
  // overlapping-session freeze reached a device untested.
  await resetResume(env, itemId, item.resumeFrom ?? 0);
  await sleep(1500);

  // The app only truncates the probe when playback ARMS it. An item that never
  // reaches the player leaves the previous file in place, and an earlier run of the
  // same id then reads back as a pass — which is how a dead deep link looked green.
  // A verdict the engine recorded on an earlier run (services/engineVerdicts.ts) goes
  // too: it would send the item to the server before the lane pick the manifest asserts.
  const probe = probeAccess(env, target, itemId, work);
  await probe.clear();

  await openDeepLink(env, target, `tomotv://player?videoId=${itemId}&probe=1`);

  const startedAt = Date.now();
  const deadline = startedAt + (item.playSeconds + 60) * 1000;
  let events = [];
  let maxPosition = 0;
  // `validate: "none"` items are checked against the served playlist alone, and their
  // fixtures run 4-10s: the player reaches EOF and takes the engine session down with it
  // long before the poll loop ends, so probing afterwards hits a dead port. Start their
  // probe as soon as the engine has published its plan and let it run beside playback.
  // The hash lanes stay post-loop: they compare a filled 30s window against a baseline.
  const probeWhileLive = target.kind === "sim" && item.mode === "localRemux" && item.validate === "none" && Boolean(item.expect);
  let liveValidation = null;
  // A device relaunches the app for every deep link, and the first of a run pays
  // the JS bundle load with the link already delivered: it can be consumed before
  // anything is listening. One re-arm costs a few seconds and turns that into a
  // pass; the simulator opens links into a running app and never needs it.
  let rearmedAt = target.kind === "sim" ? Infinity : startedAt + 25000;
  while (Date.now() < deadline) {
    await sleep(2000);
    events = await probe.read();
    if (!events.length && Date.now() > rearmedAt) {
      rearmedAt = Infinity;
      console.log("    (no events yet; re-opening the deep link)");
      await openDeepLink(env, target, `tomotv://player?videoId=${itemId}&probe=1`);
    }
    maxPosition = events.filter((e) => e.event === "progress").reduce((m, e) => Math.max(m, e.position), 0);
    if (probeWhileLive && !liveValidation && !events.some((e) => e.event === "ended")) {
      const live = events.find((e) => e.event === "stream" && e.mode === "localRemux");
      // enginePlan too: it carries the copy/encode decisions the expect block reads,
      // and starting on the stream event alone would judge the item before it exists.
      if (live && events.some((e) => e.event === "enginePlan")) {
        liveValidation = validateRemuxOutput(item, live.url, updateBaselines, sourcePath, events);
        liveValidation.catch(() => {}); // awaited below; this only stops an unhandled rejection meanwhile
      }
    }
    // allowRetry items (e.g. Ogg audio: AVPlayer has no demuxer, the app's
    // real-world behavior IS direct -> transcode retry) keep polling through
    // auto-retried errors and judge the retried playback instead.
    const fatal = events.find((e) => (e.event === "error" && !(item.allowRetry && e.willRetry)) || (e.event === "fallback" && !item.allowRetry));
    const ended = events.some((e) => e.event === "ended");
    const playedLongEnough = maxPosition >= item.progressMin && Date.now() - startedAt >= item.playSeconds * 1000;
    if (fatal || ended || playedLongEnough) break;
  }
  result.position = Math.round(maxPosition);

  const modeEvent = events.find((e) => e.event === "mode");
  result.actual = modeEvent?.mode ?? "(no mode event)";
  if (!modeEvent) {
    // Errors without a mode event are the common case and they name the cause:
    // a 404 here means the app is signed in to a DIFFERENT server than
    // JELLYFIN_URL, so the item id resolved from this one does not exist there.
    // Reporting only "no probe events" sent a whole debugging session looking
    // at the engine when the answer was sitting in the probe file.
    const errors = events.filter((e) => e.event === "error");
    if (errors.length) {
      result.problems.push(`playback never chose a mode; app reported: ${errors.map((e) => `${e.mode}: ${e.message}`).join(" | ")}`);
    } else {
      result.problems.push(
        `no probe events arrived (app not launching, Metro not running, app not signed in to the server ${env.JELLYFIN_URL} points at, or deep link broken; see test/playback/README.md)`,
      );
    }
    return finish(env, target, result);
  }
  if (modeEvent.mode !== item.mode) result.problems.push(`chose ${modeEvent.mode}, expected ${item.mode}`);
  if (item.allowRetry && item.finalMode) {
    // The lane that actually played: a retry through the ladder emits a second mode event, a
    // start-time fallback (engine below realtime, session failed to open) emits none and the
    // stream event carries the lane instead. Both end in a stream.
    const lastMode = events.filter((e) => e.event === "stream").at(-1) ?? events.filter((e) => e.event === "mode").at(-1);
    if (lastMode?.mode !== item.finalMode) result.problems.push(`final mode ${lastMode?.mode}, expected ${item.finalMode} after retry`);
    result.actual = `${modeEvent.mode}->${lastMode?.mode}`;
  }
  const fallback = events.find((e) => e.event === "fallback");
  if (fallback && !item.allowRetry) result.problems.push(`silently fell back ${fallback.from} -> ${fallback.to}: ${fallback.reason}`);
  for (const e of events.filter((x) => x.event === "error" && !(item.allowRetry && x.willRetry)))
    result.problems.push(`playback error (${e.mode}${e.willRetry ? ", auto-retried" : ""}): ${e.message}`);
  if (maxPosition < item.progressMin && !events.some((e) => e.event === "ended")) {
    result.problems.push(`position reached ${maxPosition.toFixed(1)}s, needed ${item.progressMin}s`);
  }

  // Cross-check the server saw this playback advancing (reporting path).
  const serverPos = await sessionPosition(env, itemId);
  if (serverPos === null && result.problems.length === 0) console.log(`    (note: no matching /Sessions entry for ${item.id}; reporter check skipped)`);

  // The engine binds 127.0.0.1 (LocalHTTPServer.requiredLocalEndpoint) so its media
  // never reaches the LAN. On a device that loopback is the device's, so the checks
  // below, which read the served playlist from this Mac, have nothing to open. The
  // lane, the plan, the progress and every error above are still judged; this says
  // plainly what was not, rather than reporting a pass nobody made.
  const hostCanReachEngine = target.kind === "sim";
  if (!hostCanReachEngine && result.problems.length === 0) {
    result.validation = "skipped (device: engine is loopback-only)";
    return finish(env, target, result);
  }

  // Subtitle-sync invariant on the server HLS lane, only when playback itself passed.
  if (item.mode === "transcode" && item.validate === "subsync" && result.problems.length === 0) {
    const streamEvent = events.find((e) => e.event === "stream" && e.mode === "transcode");
    if (!streamEvent) {
      result.problems.push("no transcode stream URL in probe events");
    } else {
      try {
        const problems = await validateSubtitleSync(streamEvent.url);
        result.problems.push(...problems);
        result.validation = problems.length ? "FAIL" : "ok";
      } catch (e) {
        result.problems.push(`subsync validation error: ${e.message}`);
        result.validation = "error";
      }
    }
  }

  // Live window invariants on the still-running channel session, only when playback itself passed.
  if (item.mode === "localRemux" && item.validate === "live" && result.problems.length === 0) {
    const streamEvent = events.find((e) => e.event === "stream" && e.mode === "localRemux");
    if (!streamEvent) {
      result.problems.push("no localRemux stream URL in probe events");
    } else {
      try {
        const problems = await validateLiveOutput(streamEvent.url, item);
        result.problems.push(...problems);
        result.validation = problems.length ? "FAIL" : "ok";
      } catch (e) {
        result.problems.push(`live validation error: ${e.message}`);
        result.validation = "error";
      }
    }
  }

  // Validation on the still-live remux session, only when playback itself passed.
  // `validate: "none"` still enters when the item declares an expect block: that
  // half needs no baseline (see the early return in validateRemuxOutput).
  if (item.mode === "localRemux" && item.validate !== "live" && (item.validate !== "none" || item.expect) && result.problems.length === 0) {
    const streamEvent = events.find((e) => e.event === "stream" && e.mode === "localRemux");
    if (!streamEvent) {
      result.problems.push("no localRemux stream URL in probe events");
    } else {
      try {
        // Already in flight for the short items; the rest start here.
        const { problems, note } = await (liveValidation ?? validateRemuxOutput(item, streamEvent.url, updateBaselines, sourcePath, events));
        result.problems.push(...problems);
        result.validation = note || (problems.length ? "FAIL" : "ok");
      } catch (e) {
        result.problems.push(`validation error: ${e.message}`);
        result.validation = "error";
      }
    }
  }
  return finish(env, target, result);
}

async function finish(env, target, result) {
  await terminateApp(env, target);
  return result;
}

// ---------- Manifest verification ----------

/**
 * Structural check on the manifest and its baselines, with no simulator, server or
 * media involved. This is the only part of the suite CI can run, so it has to be the
 * part that catches drift: an item added without recording a baseline, or a baseline
 * left behind by an item that is gone.
 */
function verifyManifest(manifest) {
  const problems = [];
  const MODES = ["direct", "localRemux", "transcode"];
  const VALIDATIONS = ["none", "copy", "devtc", "subsync", "live"];
  const NEEDS_BASELINE = ["copy", "devtc"];

  const seen = new Set();
  for (const item of manifest.items) {
    if (!item.id) problems.push(`item without an id: ${JSON.stringify(item).slice(0, 80)}`);
    if (seen.has(item.id)) problems.push(`${item.id}: duplicate id`);
    seen.add(item.id);
    if (!item.title) problems.push(`${item.id}: no title to resolve in Jellyfin`);
    if (!MODES.includes(item.mode)) problems.push(`${item.id}: mode "${item.mode}" is not one of ${MODES.join(", ")}`);
    if (!VALIDATIONS.includes(item.validate)) problems.push(`${item.id}: validate "${item.validate}" is not one of ${VALIDATIONS.join(", ")}`);
  }

  const files = fs.existsSync(BASELINE_DIR) ? fs.readdirSync(BASELINE_DIR).filter((f) => f.endsWith(".json")) : [];
  const have = new Set(files.map((f) => f.replace(/\.json$/, "")));

  // A skipped item never runs, so it has no baseline to record. Reported, not failed.
  const skipped = manifest.items.filter((i) => NEEDS_BASELINE.includes(i.validate) && i.skip);
  for (const item of manifest.items) {
    if (!NEEDS_BASELINE.includes(item.validate) || item.skip) continue;
    if (!have.has(item.id)) problems.push(`${item.id}: validate=${item.validate} but no baseline recorded (--update-baselines on a build you trust)`);
  }

  for (const id of have) {
    if (!seen.has(id)) problems.push(`${id}.json: baseline with no manifest item`);
  }

  for (const file of files) {
    try {
      JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, file), "utf8"));
    } catch (e) {
      problems.push(`${file}: not parseable (${e.message})`);
    }
  }

  console.log(`${manifest.items.length} items, ${files.length} baselines`);
  for (const item of skipped) console.log(`  skipped, no baseline expected: ${item.id}`);
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  console.log(problems.length ? `\n${problems.length} problem${problems.length === 1 ? "" : "s"}` : "\nManifest and baselines agree");
  return problems.length === 0;
}

// ---------- Preflight ----------

/**
 * Checks every prerequisite the suite needs and reports each one, without playing
 * anything or writing to Jellyfin. This is what a CI job runs before it commits to
 * a full pass, and what turns "the run died on item 1" into a named missing piece.
 */
async function preflight() {
  const checks = [];
  const check = async (name, fn) => {
    try {
      checks.push({ name, ok: true, detail: (await fn()) ?? "" });
    } catch (e) {
      checks.push({ name, ok: false, detail: e.message });
    }
  };

  let env = null;
  await check(".env.playback-test", async () => {
    if (!fs.existsSync(ENV_PATH)) throw new Error(`missing ${ENV_PATH}`);
    const parsed = {};
    for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) parsed[m[1]] = m[2];
    }
    if (!parsed.JELLYFIN_URL || !parsed.JELLYFIN_API_KEY) throw new Error("JELLYFIN_URL and JELLYFIN_API_KEY are both required");
    env = { ...parsed, JELLYFIN_URL: parsed.JELLYFIN_URL.replace(/\/$/, ""), BUNDLE_ID: parsed.BUNDLE_ID || "dev.keiver.tomotv" };
    return env.JELLYFIN_URL;
  });

  await check("ffprobe", async () => {
    const { stdout } = await exec("ffprobe", ["-version"]);
    return stdout.split("\n")[0];
  });

  await check("ffmpeg", async () => {
    const { stdout } = await exec("ffmpeg", ["-version"]);
    return stdout.split("\n")[0];
  });

  // Authenticated: /System/Info/Public answers 200 to a dead key.
  await check("jellyfin reachable", async () => {
    if (!env) throw new Error("skipped, no env");
    const info = await (await jf(env, "/System/Info")).json();
    return `${info.ServerName} ${info.Version}`;
  });

  await check("fixtures indexed", async () => {
    if (!env) throw new Error("skipped, no env");
    const roots = (env.JELLYFIN_FIXTURE_ROOTS || DEFAULT_FIXTURE_ROOTS).split(",").map((p) => p.trim().replace(/\/+$/, ""));
    const { Items = [] } = await (await jf(env, "/Items?Recursive=true&EnableTotalRecordCount=false&mediaTypes=Video,Audio&fields=Path")).json();
    const found = Items.filter((it) => it.Path && roots.includes(path.dirname(it.Path)));
    if (!found.length) throw new Error(`nothing indexed under ${roots.join(", ")}`);
    return `${found.length} items under ${roots.length} roots`;
  });

  let target = null;
  await check("target", async () => {
    target = await pickTarget();
    return describeTarget(target);
  });

  await check("app installed", async () => {
    if (!env || !target) throw new Error("skipped, no env or target");
    await assertInstalled(env, target);
    return env.BUNDLE_ID;
  });

  await check("baselines", async () => {
    if (!fs.existsSync(BASELINE_DIR)) throw new Error(`missing ${BASELINE_DIR}`);
    return `${fs.readdirSync(BASELINE_DIR).filter((f) => f.endsWith(".json")).length} committed`;
  });

  for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name.padEnd(22)}${c.detail}`);
  const broken = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - broken.length}/${checks.length} prerequisites met`);
  return broken.length === 0;
}

// ---------- Main ----------

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  for (const item of manifest.items) {
    item.playSeconds = item.playSeconds ?? manifest.defaults.playSeconds;
    item.progressMin = item.progressMin ?? manifest.defaults.progressMin;
  }

  if (flag("--list")) {
    for (const i of manifest.items) console.log(`${i.id}  ${i.mode.padEnd(10)} validate=${i.validate.padEnd(5)} ${i.title}`);
    return;
  }

  if (flag("--verify-manifest")) {
    if (!verifyManifest(manifest)) process.exit(1);
    return;
  }

  if (flag("--preflight")) {
    if (!(await preflight())) process.exit(1);
    return;
  }

  const only = opt("--only")?.split(",");
  const skip = opt("--skip")?.split(",") ?? [];
  // Manifest-level skips (known platform limitations) run only when --only names them explicitly.
  const items = manifest.items.filter((i) => (!only || only.includes(i.id)) && !skip.includes(i.id) && (!i.skip || only?.includes(i.id)));
  for (const i of manifest.items.filter((x) => x.skip && !only && !skip.includes(x.id))) console.log(`SKIP ${i.id}: ${i.skip}`);
  if (!items.length) fail("No manifest items match --only/--skip");
  const updateBaselines = flag("--update-baselines");

  const env = loadEnv();
  await exec("ffprobe", ["-version"]).catch(() => fail("ffprobe not on PATH (brew install ffmpeg)"));
  const target = await pickTarget().catch((e) => fail(e.message));
  await assertInstalled(env, target).catch(() => fail(`${env.BUNDLE_ID} is not installed on ${target.name}. Build it first (npm run ios / npm run both).`));
  console.log(`Target:    ${describeTarget(target)}`);
  console.log(`Jellyfin:  ${env.JELLYFIN_URL}`);

  console.log("Resolving manifest items in Jellyfin...");
  const ids = await resolveItems(env, items);

  // Prewarm: a dev build's first launch pays the Metro bundle download; without
  // this the first item's probe window can expire before JS even runs.
  console.log("Prewarming app (JS bundle load)...");
  await terminateApp(env, target);
  if (target.kind === "sim") await simctl(["launch", target.udid, env.BUNDLE_ID]).catch(() => {});
  else await devicectl(["device", "process", "launch", "--device", target.name, "--terminate-existing", env.BUNDLE_ID]).catch(() => {});
  await sleep(15000);
  // A device keeps its own account: dev-session would sign it out of the one it
  // is already on, and assertAppOnSameServer below is what checks it.
  if (target.kind === "sim") await signInApp(env, target);
  // While it is still running: a terminated app has no session to find.
  await assertAppOnSameServer(env);
  await terminateApp(env, target);

  // Every device copy lands here, one directory for the whole run.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-playback-"));

  const results = [];
  for (const item of items) {
    console.log(`\n▶ ${item.id} ${item.title} (expect ${item.mode}, play ${item.playSeconds}s)`);
    const r = await runItem(env, target, item, ids.get(item.title), updateBaselines, work);
    results.push(r);
    console.log(r.problems.length ? `  ✗ ${r.problems.join("\n    ")}` : `  ✓ mode=${r.actual} pos=${r.position}s validation=${r.validation}`);
  }

  const failed = results.filter((r) => r.problems.length);
  console.log(`\n${"=".repeat(72)}`);
  console.log(`${"ID".padEnd(5)}${"EXPECTED".padEnd(11)}${"ACTUAL".padEnd(16)}${"POS".padEnd(6)}${"VALIDATION".padEnd(18)}RESULT`);
  for (const r of results) {
    console.log(`${r.id.padEnd(5)}${r.expected.padEnd(11)}${String(r.actual).padEnd(16)}${String(r.position).padEnd(6)}${String(r.validation).padEnd(18)}${r.problems.length ? "FAIL" : "PASS"}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed${updateBaselines ? " (baselines updated)" : ""}`);

  // Machine-readable run record, for a CI job to publish or a bisect to diff.
  const jsonPath = opt("--json");
  if (jsonPath) {
    fs.writeFileSync(jsonPath, JSON.stringify({ total: results.length, passed: results.length - failed.length, target: describeTarget(target), server: env.JELLYFIN_URL, results }, null, 2));
    console.log(`Wrote ${jsonPath}`);
  }

  if (failed.length) process.exit(1);
}

// Imported by scripts/transcode-bench.mjs for its helpers; only the CLI runs the suite.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => fail(e.stack || String(e)));
