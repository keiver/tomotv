#!/usr/bin/env node
/**
 * Test media generator for the playback regression suite.
 *
 * Rebuilds the surround/lossless test set from nothing, so a lost media folder
 * is recoverable instead of fatal. Three kinds of media, for three reasons:
 *
 *   1. SYNTHETIC (generated here). Every channel carries a distinct tone and the
 *      video burns in a legend naming the format and layout, so a channel swap,
 *      a downmix or a dropped LFE is measurable on a scope and audible in a
 *      room. Deterministic, which is what makes hash baselines possible. This is
 *      the audio analogue of T44's burned-in clock.
 *   2. REAL ENCODER OUTPUT (downloaded from samples.ffmpeg.org, the FFmpeg/FATE
 *      corpus). Synthetic files cannot reproduce a disc-authentic layered TrueHD
 *      stream or a DTS core + MA extension, because ffmpeg's truehd/dca encoders
 *      are experimental and core-only respectively.
 *   3. REAL ATMOS (downloaded from Apple's own HLS example stream). E-AC-3 JOC
 *      has no free encoder. Apple's advanced example carries a genuine JOC
 *      rendition, which doubles as a correctness oracle: it is exactly the
 *      format the engine is trying to produce, authored by Apple.
 *
 * Video items go to ~/Movies/Development Videos because audio-only items never
 * reach the remux engine (useVideoPlayback gates local remux on !audioOnly), so
 * every surround soundtrack is muxed with a video track. Audio-only lossless
 * items go to ~/Music/Development Surround to exercise the audio player path.
 *
 * Generation uses Jellyfin's bundled ffmpeg, not Homebrew's: it carries the
 * ac3/eac3/truehd/dca/flac/alac encoders this needs. Same reason the T44 Theora
 * file is generated with it.
 *
 * Usage:
 *   node scripts/make-test-media.mjs              build what is missing
 *   node scripts/make-test-media.mjs --force      rebuild everything
 *   node scripts/make-test-media.mjs --no-download   synthetic only, no network
 *   node scripts/make-test-media.mjs --only T60,T63  subset
 *   node scripts/make-test-media.mjs --skip-library  do not touch Jellyfin
 *
 * Requires: Jellyfin.app installed (for its ffmpeg), and the same
 * .env.playback-test the regression driver uses for the library step.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env.playback-test");
const SOURCES_PATH = path.join(ROOT, "test", "playback", "media-sources.json");

const VIDEO_DIR = path.join(os.homedir(), "Movies", "Development Videos");
const SURROUND_DIR = path.join(os.homedir(), "Music", "Development Surround");
const CACHE_DIR = path.join(os.homedir(), "Movies", ".tomotv-media-cache");

const FFMPEG = "/Applications/Jellyfin.app/Contents/MacOS/ffmpeg";
const FFPROBE = "/Applications/Jellyfin.app/Contents/MacOS/ffprobe";
const FONT = "/System/Library/Fonts/Helvetica.ttc";
const POSTER_SOURCE = path.join(ROOT, "assets", "brand", "tomo-tv.png");

const DURATION = 60;
const SIZE = "1280x720";
/** Discs and streaming both ship 48kHz; 44.1 would not be representative. */
const RATE = 48000;
/** testsrc2 is high-detail noise, so it needs a cap or every item lands past 20MB. */
const X264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p"];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const FORCE = flag("--force");
const ONLY =
  opt("--only")
    ?.split(",")
    .map((s) => s.trim().toUpperCase()) ?? null;
const wanted = (id) => !ONLY || ONLY.includes(id);

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

// ---------- channel tones ----------

/**
 * One frequency per channel. Spread far enough apart that a spectrum view
 * identifies each channel unambiguously, with the LFE down at 60Hz.
 *
 * Labels are FFmpeg channel names and are load-bearing: every input here is
 * MONO, and a mono input's channel is FC, so `join` left to its own devices
 * name-matches the first input to FC and fills the rest in order — which put
 * 200Hz in the centre and shifted everything else. The explicit `map` below is
 * what keeps each tone in its intended channel. Verified by FFT, not assumed.
 *
 * In a filter graph "5.1" is the BACK variant, so the surround channels are named
 * BL/BR here. AC-3 draws no distinction between back and side, so the same file
 * decodes back as 5.1(side) — same channel order, different label. The check
 * below is index-based for exactly that reason.
 */
const TONES = {
  5.1: [
    { hz: 200, label: "FL" },
    { hz: 300, label: "FR" },
    { hz: 400, label: "FC" },
    { hz: 60, label: "LFE" },
    { hz: 700, label: "BL" },
    { hz: 900, label: "BR" },
  ],
  7.1: [
    { hz: 200, label: "FL" },
    { hz: 300, label: "FR" },
    { hz: 400, label: "FC" },
    { hz: 60, label: "LFE" },
    { hz: 700, label: "BL" },
    { hz: 900, label: "BR" },
    { hz: 1200, label: "SL" },
    { hz: 1500, label: "SR" },
  ],
  stereo: [
    { hz: 300, label: "FL" },
    { hz: 500, label: "FR" },
  ],
};

/** Explicit input-to-channel mapping for `join`; see the note on TONES. */
const joinFilter = (layout) => {
  const tones = TONES[layout];
  const map = tones.map((t, i) => `${i}.0-${t.label}`).join("|");
  return `join=inputs=${tones.length}:channel_layout=${layout}:map=${map}`;
};

/** drawtext is fed only spaces and alphanumerics, so nothing needs escaping. */
function legend(line1, line2) {
  const draw = (text, y) => `drawtext=fontfile=${FONT}:text='${text}':fontsize=44:fontcolor=white:box=1:boxcolor=black@0.75:boxborderw=14:x=(w-text_w)/2:y=${y}`;
  return `${draw(line1, 48)},${draw(line2, 130)}`;
}

/**
 * Build the ffmpeg argv for one synthetic item: N sine inputs joined into the
 * target layout, plus a testsrc2 video carrying the legend.
 */
function synthArgs({ layout, codecArgs, out, title }) {
  const tones = TONES[layout];
  const inputs = [];
  for (const t of tones) inputs.push("-f", "lavfi", "-i", `sine=frequency=${t.hz}:duration=${DURATION}:sample_rate=${RATE}`);
  inputs.push("-f", "lavfi", "-i", `testsrc2=size=${SIZE}:rate=24:duration=${DURATION}`);

  const videoIndex = tones.length;
  const audioLabels = tones.map((_, i) => `[${i}:a]`).join("");
  const toneLine = tones.map((t) => `${t.label}${t.hz}`).join("  ");
  const filter = `${audioLabels}${joinFilter(layout)}[a];[${videoIndex}:v]${legend(title, toneLine)}[v]`;

  return ["-y", ...inputs, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", ...X264, ...codecArgs, out];
}

// ---------- the matrix ----------

/**
 * Video items. `mode` is the lane the app is expected to choose, recorded here
 * so the manifest entries can be written from this table rather than by hand.
 */
const SYNTHETIC = [
  { id: "T60", title: "T60 REMUX AC3 5.1", layout: "5.1", codecArgs: ["-c:a", "ac3", "-b:a", "640k"] },
  { id: "T61", title: "T61 REMUX EAC3 5.1", layout: "5.1", codecArgs: ["-c:a", "eac3", "-b:a", "768k"] },
  // FFmpeg's eac3 encoder tops out at 5.1, so E-AC-3 7.1 cannot be synthesised;
  // T80 (real 7_pt_1.eac3) covers that. FLAC reaches 8 channels, so it carries
  // the 8-channel path here — which is also the lossless path A2 cares about.
  { id: "T62", title: "T62 REMUX FLAC 7.1 24bit", layout: "7.1", codecArgs: ["-c:a", "flac", "-sample_fmt", "s32"] },
  { id: "T63", title: "T63 REMUX TrueHD 5.1", layout: "5.1", codecArgs: ["-c:a", "truehd", "-strict", "-2"] },
  { id: "T64", title: "T64 REMUX DTS 5.1", layout: "5.1", codecArgs: ["-c:a", "dca", "-strict", "-2", "-ar", "48000"] },
  { id: "T65", title: "T65 REMUX FLAC 5.1 24bit", layout: "5.1", codecArgs: ["-c:a", "flac", "-sample_fmt", "s32"] },
  { id: "T66", title: "T66 REMUX ALAC 5.1 24bit", layout: "5.1", codecArgs: ["-c:a", "alac", "-sample_fmt", "s32p"] },
  { id: "T67", title: "T67 REMUX PCM 5.1 24bit", layout: "5.1", codecArgs: ["-c:a", "pcm_s24le"] },
  { id: "T68", title: "T68 REMUX Opus 5.1", layout: "5.1", codecArgs: ["-c:a", "libopus", "-mapping_family", "1", "-b:a", "384k"] },
  { id: "T69", title: "T69 REMUX Vorbis 5.1", layout: "5.1", codecArgs: ["-c:a", "libvorbis", "-q:a", "6"] },
];

/** Audio-only twins: these exercise the direct/audio-player path, not the engine. */
const SYNTHETIC_AUDIO = [
  { id: "T70", title: "T70 DIRECT audio FLAC 5.1 24bit", ext: "flac", layout: "5.1", codecArgs: ["-c:a", "flac", "-sample_fmt", "s32"] },
  { id: "T71", title: "T71 DIRECT audio ALAC 5.1 24bit", ext: "m4a", layout: "5.1", codecArgs: ["-c:a", "alac", "-sample_fmt", "s32p"] },
  { id: "T72", title: "T72 DIRECT audio PCM 5.1 24bit", ext: "wav", layout: "5.1", codecArgs: ["-c:a", "pcm_s24le"] },
  { id: "T73", title: "T73 DIRECT audio FLAC stereo 24bit", ext: "flac", layout: "stereo", codecArgs: ["-c:a", "flac", "-sample_fmt", "s32"] },
];

/**
 * Real encoder output. Bare elementary streams are muxed with a generated video
 * track, since audio-only never reaches the engine. `container` items already
 * carry video and are copied as-is.
 */
const SAMPLES_BASE = "https://samples.ffmpeg.org/A-codecs";
const DOWNLOADS = [
  { id: "T80", title: "T80 REMUX EAC3 7.1 real", url: `${SAMPLES_BASE}/AC3/eac3/7_pt_1.eac3`, mux: true },
  { id: "T81", title: "T81 REMUX EAC3 5.1 real", url: `${SAMPLES_BASE}/AC3/eac3/matrix2_english_5.1_640.eac3`, mux: true },
  { id: "T82", title: "T82 REMUX AC3 5.1 real", url: `${SAMPLES_BASE}/AC3/monsters_inc_5.1_448.ac3`, mux: true },
  { id: "T83", title: "T83 REMUX EAC3 channelcheck", url: `${SAMPLES_BASE}/AC3/eac3/channelcheck-ddplus_480.mp4`, container: "mkv" },
  { id: "T84", title: "T84 REMUX EAC3 matroska", url: `${SAMPLES_BASE}/AC3/eac3/sample-eac3.mkv`, container: "mkv" },
  { id: "T85", title: "T85 REMUX TrueHD real", url: `${SAMPLES_BASE}/TrueHD/vc1-with-truehd.m2ts`, container: "mkv" },
  { id: "T86", title: "T86 REMUX DTS-HD MA real", url: `${SAMPLES_BASE}/DTS/bond_sample_dtshdma.m2ts`, container: "mkv" },
  { id: "T87", title: "T87 REMUX DTS 5.1 real", url: `${SAMPLES_BASE}/DTS/lotr_5.1_768.dts`, mux: true },
];

const APPLE_MASTER = "https://devstreaming-cdn.apple.com/videos/streaming/examples/adv_dv_atmos/main.m3u8";
const ATMOS_ID = "T88";
const ATMOS_TITLE = "T88 REMUX EAC3 JOC Atmos real";

// ---------- helpers ----------

function log(msg) {
  console.log(msg);
}

function exists(p) {
  return fs.existsSync(p);
}

async function ff(argv, label) {
  try {
    await exec(FFMPEG, argv, { maxBuffer: 64 * 1024 * 1024 });
    return true;
  } catch (e) {
    const tail = String(e.stderr || e.message)
      .trim()
      .split("\n")
      .slice(-4)
      .join("\n    ");
    console.warn(`  ✗ ${label}\n    ${tail}`);
    return false;
  }
}

/**
 * Energy of one frequency in one sample buffer (Goertzel). Cheaper than an FFT
 * and needs no dependency, which matters because this runs on every build.
 */
function goertzel(samples, stride, offset, freq, rate) {
  const n = Math.floor((samples.length - offset) / stride);
  const k = Math.round((n * freq) / rate);
  const coeff = 2 * Math.cos((2 * Math.PI * k) / n);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[offset + i * stride] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s2 * s2 + s1 * s1 - coeff * s1 * s2;
}

/**
 * Decode a slice and confirm every channel carries the tone it is supposed to.
 * The generator asserting its own output is the point: an early version of this
 * script silently shifted every tone one channel over, because `join` name-matched
 * the first mono input to FC. Nothing downstream would have noticed.
 */
async function verifyChannels(file, layout) {
  const tones = TONES[layout];

  // Channel count first. An encoder that cannot reach the requested layout
  // downmixes silently (FFmpeg's eac3 tops out at 5.1), and reading the result
  // at the wrong stride turns that into unreadable noise rather than a clear
  // "produced 6 channels, wanted 8".
  try {
    const { stdout } = await exec(FFPROBE, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", file]);
    const actual = parseInt(stdout.trim(), 10);
    if (actual !== tones.length) return { ok: false, detail: `encoder produced ${actual} channels, wanted ${tones.length} (${layout})` };
  } catch (e) {
    return { ok: false, detail: `probe failed: ${e.message}` };
  }

  let raw;
  try {
    const { stdout } = await exec(FFMPEG, ["-v", "error", "-ss", "5", "-t", "3", "-i", file, "-map", "0:a", "-ar", String(RATE), "-f", "s16le", "-"], {
      maxBuffer: 64 * 1024 * 1024,
      encoding: "buffer",
    });
    raw = stdout;
  } catch (e) {
    return {
      ok: false,
      detail: `decode failed: ${String(e.stderr || e.message)
        .trim()
        .split("\n")
        .pop()}`,
    };
  }

  const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
  const ch = tones.length;
  const wrong = [];
  for (let c = 0; c < ch; c++) {
    let best = null;
    for (const t of tones) {
      const power = goertzel(pcm, ch, c, t.hz, RATE);
      if (!best || power > best.power) best = { hz: t.hz, power };
    }
    if (best.hz !== tones[c].hz) wrong.push(`${tones[c].label} carries ${best.hz}Hz, expected ${tones[c].hz}Hz`);
  }
  return wrong.length === 0 ? { ok: true } : { ok: false, detail: wrong.join("; ") };
}

/**
 * curl rather than fetch: samples.ffmpeg.org is a slow 2008-era Apache and
 * Node's undici gives up on the larger files with a bare "fetch failed".
 * Downloads land in a .part file and are renamed only on success, so an
 * interrupted run can never leave a truncated file that the next run mistakes
 * for a complete one.
 */
async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  if (exists(part)) fs.rmSync(part);
  await exec("curl", ["-fSL", "--retry", "5", "--retry-delay", "3", "--retry-all-errors", "--connect-timeout", "20", "--max-time", "1800", "-o", part, url], { maxBuffer: 4 * 1024 * 1024 });
  fs.renameSync(part, dest);
  return fs.statSync(dest).size;
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function loadEnv() {
  if (!exists(ENV_PATH)) return null;
  const env = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  if (!env.JELLYFIN_URL || !env.JELLYFIN_API_KEY) return null;
  env.JELLYFIN_URL = env.JELLYFIN_URL.replace(/\/$/, "");
  return env;
}

async function jf(env, pathname, init = {}) {
  const res = await fetch(`${env.JELLYFIN_URL}${pathname}`, {
    ...init,
    headers: { "X-Emby-Token": env.JELLYFIN_API_KEY, ...(init.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Jellyfin ${pathname} -> HTTP ${res.status}`);
  return res;
}

// ---------- build steps ----------

/** Collected non-fatal problems, reported together at the end. */
const failures = [];

async function buildSynthetic() {
  const built = [];
  for (const item of SYNTHETIC) {
    if (!wanted(item.id)) continue;
    const out = path.join(VIDEO_DIR, `${item.title}.mkv`);
    if (exists(out) && !FORCE) {
      log(`  = ${item.title}`);
      built.push({ ...item, out });
      continue;
    }
    log(`  + ${item.title}`);
    if (!(await ff(synthArgs({ ...item, out }), item.title))) continue;
    const check = await verifyChannels(out, item.layout);
    if (!check.ok) {
      console.warn(`  ✗ ${item.id} channel check: ${check.detail}`);
      failures.push(`${item.id} ${check.detail}`);
      continue;
    }
    built.push({ ...item, out });
  }
  return built;
}

async function buildSyntheticAudio() {
  const built = [];
  for (const item of SYNTHETIC_AUDIO) {
    if (!wanted(item.id)) continue;
    const out = path.join(SURROUND_DIR, `${item.title}.${item.ext}`);
    if (exists(out) && !FORCE) {
      log(`  = ${item.title}`);
      built.push({ ...item, out });
      continue;
    }
    log(`  + ${item.title}`);
    const tones = TONES[item.layout];
    const inputs = [];
    for (const t of tones) inputs.push("-f", "lavfi", "-i", `sine=frequency=${t.hz}:duration=${DURATION}:sample_rate=${RATE}`);
    const argv = ["-y", ...inputs, "-filter_complex", `${tones.map((_, i) => `[${i}:a]`).join("")}${joinFilter(item.layout)}[a]`, "-map", "[a]", ...item.codecArgs, out];
    if (!(await ff(argv, item.title))) continue;
    const check = await verifyChannels(out, item.layout);
    if (!check.ok) {
      console.warn(`  ✗ ${item.id} channel check: ${check.detail}`);
      failures.push(`${item.id} ${check.detail}`);
      continue;
    }
    built.push({ ...item, out });
  }
  return built;
}

/** A silent video bed to carry an elementary audio stream into the video library. */
async function videoBed(title, seconds) {
  const bed = path.join(CACHE_DIR, `bed-${seconds}.mkv`);
  if (exists(bed)) return bed;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const ok = await ff(["-y", "-f", "lavfi", "-i", `testsrc2=size=${SIZE}:rate=24:duration=${seconds}`, ...X264, bed], `video bed ${seconds}s`);
  return ok ? bed : null;
}

async function probeDuration(file) {
  try {
    const { stdout } = await exec(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? Math.min(Math.ceil(d), 120) : DURATION;
  } catch {
    return DURATION;
  }
}

async function buildDownloads(sources) {
  const built = [];
  for (const item of DOWNLOADS) {
    if (!wanted(item.id)) continue;
    const ext = item.mux ? path.extname(new URL(item.url).pathname) : path.extname(new URL(item.url).pathname);
    const cached = path.join(CACHE_DIR, `${item.id}${ext}`);
    const out = path.join(VIDEO_DIR, `${item.title}.mkv`);

    if (exists(out) && !FORCE) {
      log(`  = ${item.title}`);
      built.push({ ...item, out });
      continue;
    }

    if (!exists(cached) || FORCE) {
      log(`  ↓ ${item.title}  ${item.url}`);
      try {
        const size = await download(item.url, cached);
        log(`    ${(size / 1048576).toFixed(1)} MB`);
      } catch (e) {
        console.warn(`  ✗ ${item.id} download failed: ${e.message}`);
        continue;
      }
    }
    sources[item.id] = { url: item.url, sha256: sha256(cached), bytes: fs.statSync(cached).size };

    let ok;
    if (item.mux) {
      const seconds = await probeDuration(cached);
      const bed = await videoBed(item.title, seconds);
      if (!bed) continue;
      // Audio copied verbatim: the point of these files is real encoder output.
      ok = await ff(["-y", "-i", bed, "-i", cached, "-map", "0:v", "-map", "1:a", "-c", "copy", "-shortest", out], item.title);
    } else {
      // Already carries video; rewrap to Matroska without touching any stream.
      ok = await ff(["-y", "-i", cached, "-map", "0", "-c", "copy", out], item.title);
    }
    if (ok) {
      log(`  + ${item.title}`);
      built.push({ ...item, out });
    }
  }
  return built;
}

async function buildAtmos(sources) {
  if (!wanted(ATMOS_ID)) return [];
  const out = path.join(VIDEO_DIR, `${ATMOS_TITLE}.mkv`);
  if (exists(out) && !FORCE) {
    log(`  = ${ATMOS_TITLE}`);
    return [{ id: ATMOS_ID, title: ATMOS_TITLE, out }];
  }

  log(`  ↓ ${ATMOS_TITLE}  ${APPLE_MASTER}`);
  const master = await (await fetch(APPLE_MASTER, { signal: AbortSignal.timeout(60000) })).text();

  // The Atmos rendition is the audio group whose CHANNELS attribute carries the
  // JOC marker; Apple signals Atmos there, not in the CODECS string.
  const line = master.split("\n").find((l) => l.startsWith("#EXT-X-MEDIA:TYPE=AUDIO") && /CHANNELS="[^"]*JOC/.test(l));
  if (!line) {
    console.warn("  ✗ no JOC rendition found in Apple's master playlist");
    return [];
  }
  const uri = line.match(/URI="([^"]+)"/)?.[1];
  if (!uri) return [];

  const base = APPLE_MASTER.slice(0, APPLE_MASTER.lastIndexOf("/") + 1);
  const renditionUrl = new URL(uri, base).href;
  const renditionBase = renditionUrl.slice(0, renditionUrl.lastIndexOf("/") + 1);
  const playlist = await (await fetch(renditionUrl, { signal: AbortSignal.timeout(60000) })).text();

  const initName = playlist.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1];
  const segments = playlist
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (!initName || segments.length === 0) {
    console.warn("  ✗ Apple rendition playlist had no init segment or media segments");
    return [];
  }

  // init + segments concatenated is a valid fMP4; that is how fragmented MP4 works.
  const joined = path.join(CACHE_DIR, `${ATMOS_ID}-joc.mp4`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const parts = [initName, ...segments];
  const chunks = [];
  for (const name of parts) {
    const res = await fetch(new URL(name, renditionBase).href, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) {
      console.warn(`  ✗ Atmos segment ${name} -> HTTP ${res.status}`);
      return [];
    }
    chunks.push(Buffer.from(await res.arrayBuffer()));
  }
  fs.writeFileSync(joined, Buffer.concat(chunks));
  log(`    ${(fs.statSync(joined).size / 1048576).toFixed(1)} MB, ${segments.length} segments`);
  sources[ATMOS_ID] = { url: APPLE_MASTER, rendition: uri, sha256: sha256(joined), bytes: fs.statSync(joined).size };

  const seconds = await probeDuration(joined);
  const bed = await videoBed(ATMOS_TITLE, seconds);
  if (!bed) return [];
  // -c copy is the whole point: JOC is side data inside the E-AC-3 stream, so a
  // byte copy preserves Atmos. Re-encoding here would silently destroy it.
  const ok = await ff(["-y", "-i", bed, "-i", joined, "-map", "0:v", "-map", "1:a", "-c", "copy", "-shortest", out], ATMOS_TITLE);
  if (!ok) return [];
  log(`  + ${ATMOS_TITLE}`);
  return [{ id: ATMOS_ID, title: ATMOS_TITLE, out }];
}

/**
 * Attach the poster through the API rather than dropping a sibling
 * `<name>-poster.jpg` in the media folder. The existing test items do it the
 * file way and it costs them: `Development Videos` is a mixed-content library,
 * so every stray jpg also lands as its own Photo item. Uploading to the item
 * sets the same image with none of that clutter.
 */
async function applyPosters(env, items) {
  if (!exists(POSTER_SOURCE)) {
    console.warn(`  poster source missing: ${POSTER_SOURCE}`);
    return;
  }
  const jpg = path.join(CACHE_DIR, "poster.jpg");
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!exists(jpg) || FORCE) {
    const made = await ff(["-y", "-i", POSTER_SOURCE, "-vf", "scale=600:900:force_original_aspect_ratio=decrease,pad=600:900:(ow-iw)/2:(oh-ih)/2:black", jpg], "poster");
    if (!made) return;
  }
  const b64 = fs.readFileSync(jpg).toString("base64");

  for (const item of items) {
    let id;
    try {
      const found = await (await jf(env, `/Items?recursive=true&limit=5&searchTerm=${encodeURIComponent(item.title)}`)).json();
      id = found.Items?.find((i) => i.Name === item.title)?.Id;
    } catch {
      /* fall through to the warning below */
    }
    if (!id) {
      console.warn(`  poster skipped, item not indexed yet: ${item.title}`);
      continue;
    }
    await jf(env, `/Items/${id}/Images/Primary`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: b64,
    }).catch((e) => console.warn(`  poster failed for ${item.id}: ${e.message}`));
  }
  log(`  ${items.length} posters applied`);
}

async function ensureLibrary(env, name, collectionType, dir) {
  const existing = await (await jf(env, "/Library/VirtualFolders")).json();
  const match = existing.find((v) => v.Locations?.includes(dir));
  if (match) {
    log(`  = library ${match.Name} -> ${dir}`);
    return;
  }
  const qs = new URLSearchParams({ name, collectionType, refreshLibrary: "true" });
  await jf(env, `/Library/VirtualFolders?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ LibraryOptions: { PathInfos: [{ Path: dir }] } }),
  });
  log(`  + library ${name} -> ${dir}`);
}

// ---------- main ----------

async function main() {
  if (!exists(FFMPEG)) {
    fail(
      `Jellyfin's ffmpeg not found at ${FFMPEG}\n` +
        `It carries the ac3/eac3/truehd/dca encoders this script needs; Homebrew's build does not.\n` +
        `Install Jellyfin.app, or point FFMPEG at another full build.`,
    );
  }
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  fs.mkdirSync(SURROUND_DIR, { recursive: true });

  const sources = exists(SOURCES_PATH) ? JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8")) : {};

  log("\nSynthetic video items");
  const video = await buildSynthetic();

  log("\nSynthetic audio-only items");
  const audio = await buildSyntheticAudio();

  let downloaded = [];
  let atmos = [];
  if (!flag("--no-download")) {
    log("\nReal encoder output (samples.ffmpeg.org)");
    downloaded = await buildDownloads(sources);
    log("\nReal Atmos (Apple HLS example)");
    atmos = await buildAtmos(sources);
  }

  fs.mkdirSync(path.dirname(SOURCES_PATH), { recursive: true });
  fs.writeFileSync(SOURCES_PATH, `${JSON.stringify(sources, null, 2)}\n`);

  if (!flag("--skip-library")) {
    const env = loadEnv();
    if (!env) {
      console.warn(`\nSkipping library step: ${ENV_PATH} missing or incomplete.`);
    } else {
      log("\nJellyfin libraries");
      await ensureLibrary(env, "Development Surround", "music", SURROUND_DIR);
      await jf(env, "/Library/Refresh", { method: "POST" }).catch((e) => console.warn(`  refresh failed: ${e.message}`));

      // Posters attach to items, so they need the scan to have picked the files
      // up first. Poll rather than sleep a fixed amount: a cold scan of the
      // whole folder takes far longer than an incremental one.
      const posterItems = [...video, ...downloaded, ...atmos];
      if (posterItems.length) {
        log("\nPosters");
        const probe = posterItems[posterItems.length - 1].title;
        for (let i = 0; i < 30; i++) {
          const found = await (await jf(env, `/Items?recursive=true&limit=5&searchTerm=${encodeURIComponent(probe)}`)).json().catch(() => ({}));
          if (found.Items?.some((it) => it.Name === probe)) break;
          await new Promise((r) => setTimeout(r, 4000));
        }
        await applyPosters(env, posterItems);
      }
    }
  }

  const total = video.length + audio.length + downloaded.length + atmos.length;
  log(`\n${total} items ready`);
  log(`  ${VIDEO_DIR}`);
  log(`  ${SURROUND_DIR}`);
  log(`  sources recorded in ${path.relative(ROOT, SOURCES_PATH)}`);
  if (failures.length) {
    console.warn(`\n${failures.length} item(s) did not build cleanly:`);
    for (const f of failures) console.warn(`  ${f}`);
    process.exitCode = 1;
  }
}

main().catch((e) => fail(e.stack || e.message));
