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
 *   npm run test:playback -- --list              print manifest and exit
 *
 * Requires: gitignored .env.playback-test with JELLYFIN_URL and
 * JELLYFIN_API_KEY (+ optional BUNDLE_ID); ffmpeg/ffprobe on PATH; the app
 * installed on the target simulator with its JS available (Metro running for a
 * dev build).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(ROOT, "test", "playback", "manifest.json");
const BASELINE_DIR = path.join(ROOT, "test", "playback", "baselines");
const ENV_PATH = path.join(ROOT, ".env.playback-test");
const PROBE_FILENAME = "playback-probe.jsonl";
const HASH_WINDOW_SECONDS = 30;

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

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    fail(`Missing ${ENV_PATH}\nCreate it with:\n  JELLYFIN_URL=http://<server>:8096\n  JELLYFIN_API_KEY=<api key from Dashboard -> API Keys>\n  # optional: BUNDLE_ID=dev.keiver.tomotv`);
  }
  const env = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  if (!env.JELLYFIN_URL || !env.JELLYFIN_API_KEY) fail(`${ENV_PATH} must define JELLYFIN_URL and JELLYFIN_API_KEY`);
  env.JELLYFIN_URL = env.JELLYFIN_URL.replace(/\/$/, "");
  env.BUNDLE_ID = env.BUNDLE_ID || "dev.keiver.tomotv";
  return env;
}

// ---------- Jellyfin ----------

async function jf(env, pathname, init = {}) {
  const res = await fetch(`${env.JELLYFIN_URL}${pathname}`, {
    ...init,
    headers: { "X-Emby-Token": env.JELLYFIN_API_KEY, ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Jellyfin ${pathname} -> HTTP ${res.status}`);
  return res;
}

async function resolveItems(env, items) {
  await jf(env, "/Library/Refresh", { method: "POST" }).catch((e) => console.warn(`  library refresh failed (continuing): ${e.message}`));
  const wanted = new Map(items.map((m) => [m.title, m]));
  const resolved = new Map();
  const deadline = Date.now() + 90000;
  while (resolved.size < wanted.size && Date.now() < deadline) {
    // No searchTerm: tagged audio files are named by embedded metadata title,
    // not filename, so match on Path basename (extension stripped) as well.
    const res = await jf(env, "/Items?Recursive=true&EnableTotalRecordCount=false&fields=Path");
    const { Items = [] } = await res.json();
    for (const it of Items) {
      const stem = it.Path ? path.basename(it.Path).replace(/\.[^.]+$/, "") : null;
      const key = wanted.has(it.Name) ? it.Name : wanted.has(stem) ? stem : null;
      // The source path comes along for expect.audioCopy, which compares the
      // engine's audio packets against the original file's.
      if (key && !resolved.has(key)) resolved.set(key, { id: it.Id, path: it.Path ?? null });
    }
    if (resolved.size < wanted.size) await sleep(5000);
  }
  const missing = [...wanted.keys()].filter((t) => !resolved.has(t));
  if (missing.length) fail(`Items not found in Jellyfin after rescan: ${missing.join(", ")}\nCheck the library points at ~/Movies/Development Videos and has finished scanning.`);
  return resolved;
}

/**
 * Payload digests of the first `count` audio packets, timestamps excluded.
 *
 * This is what separates a stream COPY from a lossless re-encode. Both produce
 * byte-identical audio once decoded, and both report the same codec, channel
 * count and bit depth, so nothing in the stream summary can tell them apart.
 * The packet payloads can: a copy carries the source's exact frames, while a
 * re-encode rebuilds them with its own block sizes and prediction. PTS is
 * dropped from the comparison because the engine rebases the timeline.
 */
async function audioPacketDigest(url, count = 40) {
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-t", "20", "-i", url, "-map", "0:a:0", "-c", "copy", "-f", "framemd5", "-"], {
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const payloads = stdout
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(",").pop().trim())
    .slice(0, count);
  return payloads.length ? createHash("md5").update(payloads.join("\n")).digest("hex") : null;
}

/**
 * Clear resume position + played flag so every run starts at 0. Without this,
 * resume from the previous run seeks the player forward, the engine's
 * seek-restart discards the early segments (and init.mp4 -> 404), and the
 * host-side hash of the first 30s has nothing to read.
 */
async function resetResume(env, itemId) {
  try {
    if (!env._userId) {
      const users = await (await jf(env, "/Users")).json();
      env._userId = (users.find((u) => u.Policy?.IsAdministrator) ?? users[0])?.Id;
    }
    await jf(env, `/UserItems/${itemId}/UserData?userId=${env._userId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ PlaybackPositionTicks: 0, Played: false }),
    });
  } catch (e) {
    console.log(`    (note: resume reset failed: ${e.message})`);
  }
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

async function simctl(cmdArgs, options = {}) {
  return exec("xcrun", ["simctl", ...cmdArgs], { timeout: 30000, ...options });
}

async function pickSimulator() {
  const udid = opt("--udid");
  const { stdout } = await simctl(["list", "devices", "-j"]);
  const devices = Object.values(JSON.parse(stdout).devices).flat();
  if (udid) {
    const dev = devices.find((d) => d.udid === udid);
    if (!dev) fail(`No simulator with UDID ${udid}`);
    if (dev.state !== "Booted") {
      console.log(`Booting ${dev.name}...`);
      await simctl(["boot", udid]);
      await simctl(["bootstatus", udid], { timeout: 120000 });
    }
    return dev;
  }
  const booted = devices.filter((d) => d.state === "Booted");
  if (booted.length !== 1) {
    fail(
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
  const { stdout } = await exec("ffprobe", ["-v", "error", "-of", "json", "-show_streams", "-i", url], { timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
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

async function validateRemuxOutput(item, masterUrl, updateBaselines, sourcePath) {
  const problems = [];
  const streams = await ffprobeStreams(masterUrl);
  const expect = item.expect || {};

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

  // Proves the audio was COPIED rather than re-encoded, which no amount of
  // stream metadata can show: identical codec, channels and depth result either
  // way. Only the packet payloads differ.
  if (expect.audioCopy) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      problems.push(`audioCopy check needs the source file; Jellyfin reported ${sourcePath || "no path"}`);
    } else {
      const [served, original] = await Promise.all([audioPacketDigest(masterUrl), audioPacketDigest(sourcePath)]);
      if (!served || !original) problems.push("audioCopy check could not hash one of the streams");
      else if (served !== original) problems.push(`audio packets differ from source (${served.slice(0, 12)} vs ${original.slice(0, 12)}): stream was re-encoded, not copied`);
    }
  }

  if (expect.videoRange) {
    const master = await (await fetch(masterUrl, { signal: AbortSignal.timeout(10000) })).text();
    if (!master.includes(`VIDEO-RANGE=${expect.videoRange}`)) problems.push(`master playlist missing VIDEO-RANGE=${expect.videoRange}`);
  }

  const exact = item.validate === "copy";
  const video = await framemd5(masterUrl, "0:v:0", exact);
  // Some sources carry no audio at all (T27's VC1 wmv is video-only).
  const audio = streams.audio.length > 0 ? await framemd5(masterUrl, "0:a:0", false) : null;

  const baselinePath = path.join(BASELINE_DIR, `${item.id}.json`);
  const current = { streams, video: { policy: item.validate, ...video }, audio: audio ? { frames: audio.frames, lastPtsSec: audio.lastPtsSec } : null };
  if (!exact) delete current.video.digest;

  if (updateBaselines) {
    fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2) + "\n");
    return { problems, note: "baseline written" };
  }

  if (!fs.existsSync(baselinePath)) {
    problems.push(`no baseline (run with --update-baselines on a known-good build)`);
    return { problems };
  }
  const base = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

  if (JSON.stringify(base.streams) !== JSON.stringify(streams)) problems.push(`stream layout changed: ${JSON.stringify(streams)} vs baseline ${JSON.stringify(base.streams)}`);
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

  const { stdout } = await exec("ffprobe", ["-v", "error", "-of", "json", "-show_format", "-i", new URL(segUri, videoPlaylistUrl).href], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
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

// ---------- Per-item run ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runItem(env, sim, item, resolved, updateBaselines) {
  const { id: itemId, path: sourcePath } = resolved;
  const result = { id: item.id, expected: item.mode, actual: "-", position: 0, validation: "-", problems: [] };
  await simctl(["terminate", sim.udid, env.BUNDLE_ID]).catch(() => {});
  await resetResume(env, itemId);
  await sleep(1500);

  const { stdout: containerOut } = await simctl(["get_app_container", sim.udid, env.BUNDLE_ID, "data"]);
  const probePath = path.join(containerOut.trim(), "Documents", PROBE_FILENAME);

  await simctl(["openurl", sim.udid, `tomotv://player?videoId=${itemId}&probe=1`]);

  const startedAt = Date.now();
  const deadline = startedAt + (item.playSeconds + 60) * 1000;
  let events = [];
  let maxPosition = 0;
  while (Date.now() < deadline) {
    await sleep(2000);
    events = readProbe(probePath, itemId);
    maxPosition = events.filter((e) => e.event === "progress").reduce((m, e) => Math.max(m, e.position), 0);
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
    result.problems.push(
      `no probe events arrived (app not launching, Metro not running, app not signed in to the server ${env.JELLYFIN_URL} points at, or deep link broken; see test/playback/README.md)`,
    );
    return finish(env, sim, result);
  }
  if (modeEvent.mode !== item.mode) result.problems.push(`chose ${modeEvent.mode}, expected ${item.mode}`);
  if (item.allowRetry && item.finalMode) {
    const lastMode = events.filter((e) => e.event === "mode").at(-1);
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

  // Baseline validation on the still-live remux session, only when playback itself passed.
  if (item.mode === "localRemux" && item.validate !== "none" && result.problems.length === 0) {
    const streamEvent = events.find((e) => e.event === "stream" && e.mode === "localRemux");
    if (!streamEvent) {
      result.problems.push("no localRemux stream URL in probe events");
    } else {
      try {
        const { problems, note } = await validateRemuxOutput(item, streamEvent.url, updateBaselines, sourcePath);
        result.problems.push(...problems);
        result.validation = note || (problems.length ? "FAIL" : "ok");
      } catch (e) {
        result.problems.push(`validation error: ${e.message}`);
        result.validation = "error";
      }
    }
  }
  return finish(env, sim, result);
}

async function finish(env, sim, result) {
  await simctl(["terminate", sim.udid, env.BUNDLE_ID]).catch(() => {});
  return result;
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

  const only = opt("--only")?.split(",");
  const skip = opt("--skip")?.split(",") ?? [];
  // Manifest-level skips (known platform limitations) run only when --only names them explicitly.
  const items = manifest.items.filter((i) => (!only || only.includes(i.id)) && !skip.includes(i.id) && (!i.skip || only?.includes(i.id)));
  for (const i of manifest.items.filter((x) => x.skip && !only && !skip.includes(x.id))) console.log(`SKIP ${i.id}: ${i.skip}`);
  if (!items.length) fail("No manifest items match --only/--skip");
  const updateBaselines = flag("--update-baselines");

  const env = loadEnv();
  await exec("ffprobe", ["-version"]).catch(() => fail("ffprobe not on PATH (brew install ffmpeg)"));
  const sim = await pickSimulator();
  await simctl(["get_app_container", sim.udid, env.BUNDLE_ID, "app"]).catch(() => fail(`${env.BUNDLE_ID} is not installed on ${sim.name}. Build it first (npm run ios / npm run both).`));
  console.log(`Simulator: ${sim.name} (${sim.udid})`);
  console.log(`Jellyfin:  ${env.JELLYFIN_URL}`);

  console.log("Resolving manifest items in Jellyfin...");
  const ids = await resolveItems(env, items);

  // Prewarm: a dev build's first launch pays the Metro bundle download; without
  // this the first item's probe window can expire before JS even runs.
  console.log("Prewarming app (JS bundle load)...");
  await simctl(["terminate", sim.udid, env.BUNDLE_ID]).catch(() => {});
  await simctl(["launch", sim.udid, env.BUNDLE_ID]).catch(() => {});
  await sleep(15000);
  await simctl(["terminate", sim.udid, env.BUNDLE_ID]).catch(() => {});

  const results = [];
  for (const item of items) {
    console.log(`\n▶ ${item.id} ${item.title} (expect ${item.mode}, play ${item.playSeconds}s)`);
    const r = await runItem(env, sim, item, ids.get(item.title), updateBaselines);
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
  if (failed.length) process.exit(1);
}

main().catch((e) => fail(e.stack || String(e)));
