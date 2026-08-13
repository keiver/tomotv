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

/** Jellyfin libraries that hold the fixtures. Item lookup is scoped to these,
 *  so unrelated folders under ~/Movies cannot collide with a test title. */
const DEFAULT_LIBRARIES = ["Development Videos", "Development Videos Audio", "Development Surround"].join(",");

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

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    fail(
      `Missing ${ENV_PATH}\nCreate it with:\n  JELLYFIN_URL=http://<server>:8096\n  JELLYFIN_API_KEY=<api key from Dashboard -> API Keys>\n` +
        `  # optional: BUNDLE_ID=dev.keiver.tomotv\n  # optional: JELLYFIN_LIBRARIES=${DEFAULT_LIBRARIES}`,
    );
  }
  const env = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  if (!env.JELLYFIN_URL || !env.JELLYFIN_API_KEY) fail(`${ENV_PATH} must define JELLYFIN_URL and JELLYFIN_API_KEY`);
  env.JELLYFIN_URL = env.JELLYFIN_URL.replace(/\/$/, "");
  env.BUNDLE_ID = env.BUNDLE_ID || "dev.keiver.tomotv";
  env.JELLYFIN_LIBRARIES = env.JELLYFIN_LIBRARIES || DEFAULT_LIBRARIES;
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

/**
 * Map each manifest title to a Jellyfin item, scoped to the fixture libraries.
 *
 * Titles used to be matched across EVERY library, taking the first hit from an
 * unordered /Items response. That was silently non-deterministic while the
 * fixtures lived in two directories: 17 of 55 titles matched more than one
 * item, four of those differed in duration, and a run could record a baseline
 * against one file and compare it against the other. It produced an impossible
 * pos=712 on a 180s item.
 *
 * Scoping the query to the libraries that hold the fixtures removes the problem
 * by construction rather than by policing it. Jellyfin already knows which
 * items belong to which library, so other directories under ~/Movies can hold
 * whatever they like without the suite caring.
 */
async function fixtureLibraryIds(env) {
  const wanted = env.JELLYFIN_LIBRARIES.split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  const folders = await (await jf(env, "/Library/VirtualFolders")).json();
  const byName = new Map(folders.map((f) => [f.Name, f]));
  const missing = wanted.filter((n) => !byName.has(n));
  if (missing.length) {
    fail(`JELLYFIN_LIBRARIES names libraries that do not exist: ${missing.join(", ")}\n` + `Present: ${folders.map((f) => f.Name).join(", ")}`);
  }
  return wanted.map((n) => ({ name: n, id: byName.get(n).ItemId, locations: byName.get(n).Locations }));
}

async function resolveItems(env, items) {
  const libraries = await fixtureLibraryIds(env);
  await jf(env, "/Library/Refresh", { method: "POST" }).catch((e) => console.warn(`  library refresh failed (continuing): ${e.message}`));

  const wanted = new Map(items.map((m) => [m.title, m]));
  const resolved = new Map();
  const deadline = Date.now() + 90000;
  while (resolved.size < wanted.size && Date.now() < deadline) {
    const hits = new Map();
    for (const lib of libraries) {
      const res = await jf(env, `/Items?parentId=${lib.id}&Recursive=true&EnableTotalRecordCount=false&fields=Path`);
      const { Items = [] } = await res.json();
      for (const it of Items) {
        // Tagged audio is named by embedded metadata title, not filename, so
        // the path stem is checked too.
        const stem = it.Path ? path.basename(it.Path).replace(/\.[^.]+$/, "") : null;
        const title = wanted.has(it.Name) ? it.Name : wanted.has(stem) ? stem : null;
        if (!title) continue;
        if (!hits.has(title)) hits.set(title, []);
        hits.get(title).push({ id: it.Id, path: it.Path ?? null, library: lib.name });
      }
    }
    // Inside the fixture libraries a title must be unique. More than one means
    // a duplicate file came back, which is the bug this whole scoping exists to
    // stop being silent.
    const ambiguous = [...hits].filter(([, v]) => v.length > 1);
    if (ambiguous.length) {
      fail(
        `More than one item matches the same test title:\n  - ${ambiguous
          .map(([t, v]) => `${t}\n      ${v.map((x) => `[${x.library}] ${x.path}`).join("\n      ")}`)
          .join("\n  - ")}\n\nKeep one copy on disk, or narrow JELLYFIN_LIBRARIES.`,
      );
    }
    // The source path comes along for expect.audioCopy, which compares the
    // engine's audio packets against the original file's.
    for (const [title, [only]] of hits) if (!resolved.has(title)) resolved.set(title, { id: only.id, path: only.path });
    if (resolved.size < wanted.size) await sleep(5000);
  }

  const missing = [...wanted.keys()].filter((t) => !resolved.has(t));
  if (missing.length) {
    fail(
      `Not found in the fixture libraries after rescan: ${missing.join(", ")}\n\n` +
        `Libraries searched:\n  ${libraries.map((l) => `${l.name} -> ${l.locations.join(", ")}`).join("\n  ")}\n\n` +
        `A newly repointed library needs POST /Items/{libraryItemId}/Refresh; a plain /Library/Refresh leaves it empty.`,
    );
  }
  return resolved;
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

  if (expect.videoRange || expect.subtitles !== undefined) {
    const master = await (await fetch(masterUrl, { signal: AbortSignal.timeout(10000) })).text();
    if (expect.videoRange && !master.includes(`VIDEO-RANGE=${expect.videoRange}`)) problems.push(`master playlist missing VIDEO-RANGE=${expect.videoRange}`);

    // Without this, the player cannot rule out captions embedded in the video
    // and offers a legible option with an empty title that AVKit lists as "CC"
    // and that draws nothing. Seen on T88, which has no subtitle streams at all.
    if (!master.includes("CLOSED-CAPTIONS=NONE")) problems.push("EXT-X-STREAM-INF does not declare CLOSED-CAPTIONS=NONE, so the player will offer a phantom CC track");

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
  // resumeFrom items deliberately start mid-file: the app then auto-seeks on
  // open, which drives the engine's seek-restart. That is the path a real
  // Continue Watching launch takes on every play, and the one the suite used to
  // skip entirely by always clearing the position — which is how an
  // overlapping-session freeze reached a device untested.
  await resetResume(env, itemId, item.resumeFrom ?? 0);
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

  // Validation on the still-live remux session, only when playback itself passed.
  // `validate: "none"` still enters when the item declares an expect block: that
  // half needs no baseline (see the early return in validateRemuxOutput).
  if (item.mode === "localRemux" && (item.validate !== "none" || item.expect) && result.problems.length === 0) {
    const streamEvent = events.find((e) => e.event === "stream" && e.mode === "localRemux");
    if (!streamEvent) {
      result.problems.push("no localRemux stream URL in probe events");
    } else {
      try {
        const { problems, note } = await validateRemuxOutput(item, streamEvent.url, updateBaselines, sourcePath, events);
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
