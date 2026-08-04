/**
 * fetch-mpvkit.js
 *
 * Downloads the FFmpeg xcframeworks the LocalRemuxer links against, plus their
 * transitive dependencies, from the MPVKit releases pinned below, into
 * native/ios/Frameworks/ (gitignored: the frameworks unpack to ~350MB across
 * their platform slices).
 *
 * The LGPL variants are downloaded on purpose. The -GPL variants of the same
 * frameworks exist in the release and must never be used here: they would put
 * the whole app under GPL terms, which conflicts with App Store distribution.
 *
 * Runs from postinstall; exits instantly when every framework is already
 * present. Each zip is verified against a SHA256 pinned in CHECKSUMS below
 * before unpacking, and a mismatch is fatal.
 *
 * Why a pinned hash and not the release's own .checksum.txt: a checksum fetched
 * from the same release as the payload proves nothing — whoever can swap the
 * zip can swap the checksum with it. The trust anchor has to live in this repo,
 * under review, exactly like SPM binaryTarget(checksum:) and package-lock's
 * integrity field. This detects any retroactive swap of a pinned tag's assets
 * or silent drift between the tested build and a later install; it does not, and
 * cannot cheaply, defend against a poisoned upstream release adopted fresh.
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

// SHA256 of each <name>.xcframework.zip, pinned to the versions in FRAMEWORKS
// above. These are the trust anchor; verification runs on every install. To
// update after bumping a version: download the new zip and
//   shasum -a 256 <name>.xcframework.zip
// then paste the value here in the same commit as the version change.
const CHECKSUMS = {
  Libavformat: "2afb601375929640e743e7bdaa6c4a88e2b582a07e1c5f2dc95cc7f5b26a0810",
  Libavcodec: "136e432919a8a7b5b80155c68e9dc91b0ef3ae6623970b87bb8bd96a452543cf",
  Libavutil: "5dc251c8807c501982edfb0bc9bddfee4148733142d6ebb947738c60fb3bf8d8",
  Libswresample: "d5c36acf2ff944e15706f4b7bfbf18bb1993ffc5b446c9f67f1aa79de5441f15",
  gnutls: "3dbec5809339189bf9679e218c6cff387ebf8fb72745927835afc2678f5c9f4d",
  nettle: "0fdf3ebf8bd7b8bc8eee837cf27261cb4c52ae520b6576a2f468656aa1691e02",
  hogweed: "25727c9fa67287fa0a4f4722f88bb8be669b23cd7e837e2d00870eb8a25d3f27",
  gmp: "ad33c7a08f4cdcb9924c8f0e6d9a054dad33d7794b97667bf8b6fb2b236ae585",
  lcms2: "dc0dce0606f6ab6841a8ec5a6bd4448e2f3ef00661a050460f806c9393dc6982",
  Libdav1d: "d1a32ae6a1f0193e9f05c44c9176844af7f6d2a58cb33843f6f1b8dfd9224083",
  Libuavs3d: "bd5256081486d16c51c868d755bf70266c424b54c895269580de44ec6707f789",
};

const destDir = path.join(__dirname, "..", "native", "ios", "Frameworks");

// Thrown for integrity violations (bad/missing pin) so the outer handler can
// keep them fatal instead of downgrading them to a soft network warning.
class IntegrityError extends Error {}

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

  // Fail closed: a framework with no pinned hash must never install unverified.
  const expected = CHECKSUMS[name];
  if (!expected) {
    throw new IntegrityError(`[fetch-mpvkit] No pinned SHA256 for ${name}.xcframework — add one to CHECKSUMS before installing.`);
  }

  const baseUrl = FRAMEWORKS[name];
  console.log(`[fetch-mpvkit] Downloading ${name}.xcframework...`);
  const zipPath = path.join(destDir, `${name}.xcframework.zip`);

  download(`${baseUrl}/${name}.xcframework.zip`, zipPath);

  const actual = sha256(zipPath);
  if (actual !== expected) {
    fs.rmSync(zipPath, { force: true });
    throw new IntegrityError(`[fetch-mpvkit] Checksum mismatch for ${name}.xcframework.zip: expected ${expected}, got ${actual}`);
  }

  execFileSync("unzip", ["-qo", zipPath, "-d", destDir]);
  fs.rmSync(zipPath, { force: true });
  console.log(`[fetch-mpvkit] ✓ ${name}.xcframework verified and ready`);
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
  // Integrity violations are a security event, not a hiccup: fail hard so a
  // tampered or unpinned binary can never slip into a build unnoticed.
  if (error instanceof IntegrityError) {
    console.error(`[fetch-mpvkit] ❌ ${error.message}`);
    console.error("[fetch-mpvkit] ❌ Refusing to install unverified frameworks.");
    process.exit(1);
  }
  // Everything else (a flaky network, a transient 5xx) is non-fatal: a missing
  // framework fails the native build with a clear podspec error later, so it
  // shouldn't kill `npm install` itself.
  console.warn(`[fetch-mpvkit] ⚠️  ${error.message}`);
  console.warn("[fetch-mpvkit] ⚠️  Run `npm run fetch:mpvkit` again before `npm run prebuild:tv`.");
}
