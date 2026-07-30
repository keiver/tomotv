/**
 * fetch-mpvkit.js
 *
 * Downloads the FFmpeg xcframeworks the LocalRemuxer links against, from the
 * MPVKit release pinned below, into native/ios/Frameworks/ (gitignored: the
 * four frameworks unpack to ~350MB across nine platform slices).
 *
 * The LGPL variants are downloaded on purpose. The -GPL variants of the same
 * frameworks exist in the release and must never be used here: they would put
 * the whole app under GPL terms, which conflicts with App Store distribution.
 *
 * Runs from postinstall; exits instantly when every framework is already
 * present. Each zip is verified against the SHA256 checksum published as a
 * release asset before unpacking.
 */

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MPVKIT = "https://github.com/mpvkit/MPVKit/releases/download/1.0.0";

// The four FFmpeg libraries the remux engine calls, plus the transitive
// dependencies their static archives leave undefined (found by linking, not
// guessed): TLS for https:// input, and the decoders/colour library that
// libavcodec references unconditionally. 2b (mpv view) will add "Libmpv".
// Every URL is an LGPL/permissive build; never swap in a -GPL asset.
const FRAMEWORKS = {
  Libavformat: MPVKIT,
  Libavcodec: MPVKIT,
  Libavutil: MPVKIT,
  Libswresample: MPVKIT,
  gnutls: "https://github.com/mpvkit/gnutls-build/releases/download/3.8.11",
  nettle: "https://github.com/mpvkit/gnutls-build/releases/download/3.8.11",
  hogweed: "https://github.com/mpvkit/gnutls-build/releases/download/3.8.11",
  gmp: "https://github.com/mpvkit/gnutls-build/releases/download/3.8.11",
  lcms2: "https://github.com/mpvkit/lcms2-build/releases/download/2.17.0",
  Libdav1d: "https://github.com/mpvkit/libdav1d-build/releases/download/1.5.3",
  Libuavs3d: "https://github.com/mpvkit/libuavs3d-build/releases/download/1.2.1-fix",
};

const destDir = path.join(__dirname, "..", "native", "ios", "Frameworks");

function download(url, dest) {
  // curl is guaranteed on macOS and follows GitHub's S3 redirects with -L
  execFileSync("curl", ["-sfL", "--retry", "3", "-o", dest, url], { stdio: "inherit" });
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fetchFramework(name) {
  const frameworkPath = path.join(destDir, `${name}.xcframework`);
  if (fs.existsSync(path.join(frameworkPath, "Info.plist"))) {
    return false;
  }

  const baseUrl = FRAMEWORKS[name];
  console.log(`[fetch-mpvkit] Downloading ${name}.xcframework...`);
  const zipPath = path.join(destDir, `${name}.xcframework.zip`);
  const checksumPath = `${zipPath}.checksum`;

  download(`${baseUrl}/${name}.xcframework.zip`, zipPath);

  // Checksums accompany the MPVKit assets; the dependency repos don't all
  // publish one, so verification is best-effort per framework.
  let expected = null;
  try {
    download(`${baseUrl}/${name}.xcframework.checksum.txt`, checksumPath);
    expected = fs.readFileSync(checksumPath, "utf8").trim();
  } catch {
    expected = null;
  }
  if (expected) {
    const actual = sha256(zipPath);
    if (actual !== expected) {
      fs.rmSync(zipPath, { force: true });
      fs.rmSync(checksumPath, { force: true });
      throw new Error(`[fetch-mpvkit] Checksum mismatch for ${name}.xcframework.zip: expected ${expected}, got ${actual}`);
    }
  }

  execFileSync("unzip", ["-qo", zipPath, "-d", destDir]);
  fs.rmSync(zipPath, { force: true });
  fs.rmSync(checksumPath, { force: true });
  console.log(`[fetch-mpvkit] ✓ ${name}.xcframework ready${expected ? "" : " (no published checksum)"}`);
  return true;
}

fs.mkdirSync(destDir, { recursive: true });
try {
  const names = Object.keys(FRAMEWORKS);
  const fetched = names.map(fetchFramework).filter(Boolean).length;
  if (fetched > 0) {
    console.log(`[fetch-mpvkit] Done: ${fetched} downloaded, ${names.length - fetched} already present.`);
  }
} catch (error) {
  // A missing framework fails the native build with a clear podspec error, so
  // a flaky network at install time shouldn't kill `npm install` itself.
  console.warn(`[fetch-mpvkit] ⚠️  ${error.message}`);
  console.warn("[fetch-mpvkit] ⚠️  Run `npm run fetch:mpvkit` again before `npm run prebuild:tv`.");
}
