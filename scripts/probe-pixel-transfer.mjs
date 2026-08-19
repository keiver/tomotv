#!/usr/bin/env node
/**
 * Builds and runs scripts/probe-pixel-transfer.c, which proves the pixel-format
 * conversion the remux engine depends on.
 *
 * Why this exists: libswscale is deliberately not vendored (see
 * scripts/fetch-mpvkit.js), so VideoTranscoder converts decoded frames with
 * CoreVideo and VideoToolbox instead. That conversion has no unit test — the
 * engine is Swift with no test target — and the playback matrix only exercises
 * it on a device. This is the one check that runs anywhere in seconds.
 *
 * It needs no FFmpeg and no simulator: the system frameworks are the thing under
 * test, and the plane layouts are synthesised to match what FFmpeg produces.
 *
 *   npm run probe:pixel-transfer
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "scripts", "probe-pixel-transfer.c");

if (process.platform !== "darwin") {
  console.log("probe:pixel-transfer needs macOS (CoreVideo/VideoToolbox). Skipping.");
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-pixel-"));
const binary = path.join(tmp, "probe");

try {
  await exec("clang", ["-O1", "-o", binary, SOURCE, "-framework", "VideoToolbox", "-framework", "CoreVideo", "-framework", "CoreMedia", "-framework", "CoreFoundation"]);
} catch (error) {
  console.error(`Failed to build the probe:\n${error.stderr || error.message}`);
  process.exit(1);
}

try {
  const { stdout } = await exec(binary);
  process.stdout.write(stdout);
} catch (error) {
  process.stdout.write(error.stdout ?? "");
  console.error("\nA conversion the engine relies on is unavailable on this system.");
  process.exit(1);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
