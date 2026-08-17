/**
 * fetch-ffmpeg.js
 *
 * Downloads the FFmpeg xcframeworks the LocalRemuxer links against into
 * native/ios/Frameworks/ (gitignored). Runs from postinstall; exits instantly
 * when every framework is already present.
 *
 * These artifacts are OURS. scripts/ffmpeg/build.sh builds them from upstream
 * FFmpeg with our configure line, CI publishes them to a release on this repo,
 * and the tag plus every SHA256 is recorded in scripts/ffmpeg/ffmpeg-lock.json.
 * We used to pull MPVKit's prebuilt FFmpeg from five third-party release repos;
 * that build disabled most decoders and enabled Vulkan, which cost us playback
 * coverage and made libswscale unlinkable on tvOS.
 *
 * NOTHING IS COMPILED HERE. `npm install` downloads, exactly as before. The
 * build is a release-time job, not an install-time one.
 *
 * Why a pinned hash and not the release's own checksum file: a checksum fetched
 * from the same release as the payload proves nothing — whoever can swap the zip
 * can swap the checksum with it. The trust anchor has to live in this repo,
 * under review, exactly like SPM binaryTarget(checksum:) and package-lock's
 * integrity field. The lock file is written by the build workflow and committed,
 * so a drifted artifact fails the install instead of silently replacing the
 * binary the test matrix ran against.
 */

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Xcode consumes these frameworks on macOS only; a JS-only environment
// (Linux CI running the test suite) should not pay the download.
if (process.platform !== "darwin") {
  process.exit(0);
}

const lockPath = path.join(__dirname, "ffmpeg", "ffmpeg-lock.json");
const destDir = path.join(__dirname, "..", "native", "ios", "Frameworks");

// Thrown for integrity violations (bad/missing pin) so the outer handler can
// keep them fatal instead of downgrading them to a soft network warning.
class IntegrityError extends Error {}

function readLock() {
  if (!fs.existsSync(lockPath)) {
    throw new IntegrityError(`No ${path.relative(process.cwd(), lockPath)} — run scripts/ffmpeg/build.sh and publish a release, or restore the lock file.`);
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  if (!lock.tag || !lock.repository || !lock.artifacts || Object.keys(lock.artifacts).length === 0) {
    throw new IntegrityError("ffmpeg-lock.json is missing repository, tag, or artifacts.");
  }
  return lock;
}

function download(url, dest) {
  // curl is guaranteed on macOS and follows GitHub's S3 redirects with -L
  execFileSync("curl", ["-sfL", "--retry", "3", "-o", dest, url], { stdio: "inherit" });
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fetchFramework(lock, name) {
  const frameworkPath = path.join(destDir, `${name}.xcframework`);
  if (fs.existsSync(path.join(frameworkPath, "Info.plist"))) {
    return false;
  }

  // Fail closed: a framework with no pinned hash must never install unverified.
  const expected = lock.artifacts[name];
  if (!expected) {
    throw new IntegrityError(`No pinned SHA256 for ${name}.xcframework in ffmpeg-lock.json.`);
  }

  console.log(`[fetch-ffmpeg] Downloading ${name}.xcframework...`);
  const zipPath = path.join(destDir, `${name}.xcframework.zip`);
  download(`https://github.com/${lock.repository}/releases/download/${lock.tag}/${name}.xcframework.zip`, zipPath);

  const actual = sha256(zipPath);
  if (actual !== expected) {
    fs.rmSync(zipPath, { force: true });
    throw new IntegrityError(`Checksum mismatch for ${name}.xcframework.zip: expected ${expected}, got ${actual}`);
  }

  execFileSync("unzip", ["-qo", zipPath, "-d", destDir]);
  fs.rmSync(zipPath, { force: true });
  console.log(`[fetch-ffmpeg] ✓ ${name}.xcframework verified and ready`);
  return true;
}

fs.mkdirSync(destDir, { recursive: true });
try {
  const lock = readLock();
  const names = Object.keys(lock.artifacts);
  const fetched = names.map((n) => fetchFramework(lock, n)).filter(Boolean).length;
  if (fetched > 0) {
    console.log(`[fetch-ffmpeg] Done: ${fetched} downloaded, ${names.length - fetched} already present (${lock.tag}).`);
  }
} catch (error) {
  // Integrity violations are a security event, not a hiccup: fail hard so a
  // tampered or unpinned binary can never slip into a build unnoticed.
  if (error instanceof IntegrityError) {
    console.error(`[fetch-ffmpeg] ❌ ${error.message}`);
    console.error("[fetch-ffmpeg] ❌ Refusing to install unverified frameworks.");
    process.exit(1);
  }
  // Everything else (a flaky network, a transient 5xx) is non-fatal: a missing
  // framework fails the native build with a clear podspec error later, so it
  // shouldn't kill `npm install` itself.
  console.warn(`[fetch-ffmpeg] ⚠️  ${error.message}`);
  console.warn("[fetch-ffmpeg] ⚠️  Run `npm run fetch:ffmpeg` again before `npm run prebuild:tv`.");
}
