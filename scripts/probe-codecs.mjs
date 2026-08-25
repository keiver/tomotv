#!/usr/bin/env node
/**
 * Builds and runs scripts/probe-codecs.c against the FFmpeg the app actually
 * links, and prints what is REGISTERED in that build.
 *
 * Why this exists: the vendored frameworks are static archives, so `nm` lists
 * every object in them whether or not the build enabled it. Reading symbols
 * gave a codec list that was wrong in both directions — it showed ac3, eac3 and
 * the AudioToolbox wrappers, none of which are registered. `av_codec_iterate`
 * is the only honest answer, which is the same rule services/localRemux.ts
 * already states for decoders.
 *
 * No prebuild, no simulator, no device: the xcframeworks ship a macOS slice
 * with headers, and its configure line differs from the tvOS one only in
 * --arch, asm/neon and --prefix, so the codec set is identical.
 *
 *   npm run probe:codecs
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRAMEWORKS = path.join(ROOT, "native", "ios", "Frameworks");
// scripts/ffmpeg/build.sh builds this slice for exactly this script: same
// configure line as the shipped slices, so the same codec set, reachable with
// no prebuild, no simulator and no device.
const SLICE = "macos-arm64";
const SOURCE = path.join(ROOT, "scripts", "probe-codecs.c");

/** FFmpeg headers include each other as <libavutil/...>, but each framework
 *  keeps its headers flat, so they need a shim tree to resolve against. */
const MODULES = ["avcodec", "avformat", "avutil", "swresample", "swscale", "avfilter"];

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function main() {
  if (!fs.existsSync(FRAMEWORKS)) {
    fail(`No frameworks at ${FRAMEWORKS}\nRun \`npm run fetch:ffmpeg\` first (~187MB, gitignored).`);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-probe-"));
  const inc = path.join(work, "inc");
  fs.mkdirSync(inc);

  for (const m of MODULES) {
    const headers = path.join(FRAMEWORKS, `Lib${m}.xcframework`, SLICE, `Lib${m}.framework`, "Headers");
    if (!fs.existsSync(headers)) fail(`Missing ${SLICE} headers for Lib${m}. This slice is required; re-run \`npm run fetch:ffmpeg\`.`);
    fs.symlinkSync(headers, path.join(inc, `lib${m}`));
  }

  // Every xcframework that ships this slice. -F only adds a search path: a static
  // framework still has to be named in `linked` below or its symbols go unresolved,
  // which is what left Libdav1d out and broke this probe (tomo_dav1d_* undefined).
  const searchPaths = fs
    .readdirSync(FRAMEWORKS)
    .filter((d) => d.endsWith(".xcframework") && fs.existsSync(path.join(FRAMEWORKS, d, SLICE)))
    .map((d) => `-F${path.join(FRAMEWORKS, d, SLICE)}`);

  // Mirrors TomoFFmpeg.podspec. Keep the two in sync.
  const linked = ["Libavfilter", "Libavformat", "Libavcodec", "Libswscale", "Libswresample", "Libavutil", "Libdav1d", "Libuavs3d", "Libass", "Mbedtls"];
  const system = ["AudioToolbox", "VideoToolbox", "CoreMedia", "CoreVideo", "CoreFoundation", "CoreText", "Metal"];
  const bin = path.join(work, "probe-codecs");

  try {
    await exec("clang", ["-O0", `-I${inc}`, ...searchPaths, "-o", bin, SOURCE, ...linked.flatMap((f) => ["-framework", f]), "-liconv", "-lz", ...system.flatMap((f) => ["-framework", f])]);
  } catch (e) {
    fail(`compile failed:\n${String(e.stderr || e.message).trim()}`);
  }

  await new Promise((resolve) => spawn(bin, { stdio: "inherit" }).on("close", resolve));
  fs.rmSync(work, { recursive: true, force: true });
}

main().catch((e) => fail(e.stack || e.message));
