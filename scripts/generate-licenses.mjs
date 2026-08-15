#!/usr/bin/env node
/**
 * Regenerates constants/bundled-licenses.ts from the production dependency tree.
 *
 * MIT, ISC, BSD and Apache all carry the same core condition: ship the copyright
 * notice and the license text with the software. The hand-written CREDITS list in
 * constants/licenses.ts covers the media stack, where LGPL adds obligations worth
 * describing by hand. It cannot cover the npm tree, which is hundreds of packages
 * and overwhelmingly MIT, and a curated handful presented as the whole list is the
 * failure mode this exists to end.
 *
 * Shape mirrors constants/licenses.ts on purpose: each distinct license BODY is
 * stored once and referenced by many packages, exactly as LICENSE_TEXTS is. Bodies
 * are keyed on the text with copyright lines removed, because that is the only part
 * packages genuinely share; the copyright line is per-package and travels with the
 * package entry. That folds the tree down to a few dozen texts without dropping a
 * single notice. The run prints the current counts.
 *
 * What it refuses to do: guess. A package that declares a license but ships no file
 * is recorded as declared-only with its repository, never given a copyright line it
 * did not state. A package with neither a license field nor a file fails the run.
 *
 * Usage:
 *   npm run licenses          rewrite constants/bundled-licenses.ts
 *   npm run licenses:check    verify the committed file is current (CI)
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "constants", "bundled-licenses.ts");
const CHECK = process.argv.includes("--check");
/** postinstall passes this: do the work only when the inputs moved. */
const IF_STALE = process.argv.includes("--if-stale");

/**
 * What the output actually depends on: the resolved tree, and this generator.
 *
 * package-lock.json pins every version, so an unchanged lockfile means unchanged
 * license files on disk — reinstalling the same lock cannot produce different
 * notices. The script's own source is in the key because changing how a notice is
 * extracted changes the output without any dependency moving.
 */
function fingerprint() {
  const lock = fs.readFileSync(path.join(ROOT, "package-lock.json"));
  const self = fs.readFileSync(fileURLToPath(import.meta.url));
  return createHash("sha256").update(lock).update(self).digest("hex").slice(0, 16);
}

function committedFingerprint() {
  if (!fs.existsSync(OUTPUT)) return null;
  // Only the head of the file: the notices themselves are hundreds of KB.
  const head = fs.readFileSync(OUTPUT, "utf8").slice(0, 1024);
  return head.match(/fingerprint: ([a-f0-9]{16})/)?.[1] ?? null;
}

/** Filenames npm packages actually use, in the order we prefer them. */
const LICENSE_FILENAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "LICENCE.txt", "LICENSE-MIT", "LICENSE-MIT.txt", "LICENSE.BSD", "LICENSE.APACHE2", "COPYING", "COPYING.md"];

/**
 * A copyright line is per-package; the rest of the file is the shared grant.
 * Matched on the line, not the file, so multi-holder notices keep every line.
 */
const COPYRIGHT_LINE = /^.*copyright\s*(\(c\)|©|\d{4}).*$/gim;

/**
 * The shipped tree, read from package-lock.json rather than `npm ls`.
 *
 * `npm ls --omit=dev` is not reproducible across npm majors: npm 10 reports
 * `devOptional` packages (dev AND optional-in-prod) and npm 11 does not, so the
 * same lockfile produced a 98-package difference between a dev machine and CI,
 * and `git diff --exit-code` on the generated file failed for nobody's mistake.
 * The lockfile carries the flags itself, so read them directly: same answer on
 * every machine, every npm, with no child process at all.
 *
 * dev / devOptional / optional are all excluded — none of them reaches the app
 * bundle. `link` entries are workspace pointers, not shipped code.
 */
function collectPackages() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
  const found = new Map();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith("node_modules/") || entry.dev || entry.devOptional || entry.optional || entry.link) continue;
    // The last segment wins: a nested "node_modules/a/node_modules/b" is package b.
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    const dir = path.join(ROOT, key);
    // In the lock but not on disk: an install that skipped it (platform-specific
    // optional deps npm still records). Nothing to read, nothing to attribute.
    if (!fs.existsSync(dir)) continue;
    const mapKey = `${name}@${entry.version}`;
    if (!found.has(mapKey)) found.set(mapKey, { name, version: entry.version, dir, declared: licenseField(entry) });
  }
  return [...found.values()].sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));
}

/** npm normalises most of these, but old packages still use the array form. */
function licenseField(node) {
  if (typeof node.license === "string") return node.license;
  if (node.license?.type) return node.license.type;
  if (Array.isArray(node.licenses)) return node.licenses.map((entry) => entry.type ?? entry).join(" OR ");
  return null;
}

/**
 * Matched against the real directory listing, case-insensitively.
 *
 * `existsSync(dir + "/LICENSE")` answers yes on a case-insensitive filesystem
 * (macOS) for a file named `license`, and no on Linux. 72 packages ship the
 * lowercase spelling — chalk, strip-ansi, @sinclair/typebox, ms — so the notice
 * generated on a Mac attributed them and the one CI generated dropped their
 * copyright lines. Reading the listing makes both machines agree.
 *
 * Sorted, first spelling wins: a package carrying both LICENSE and license on a
 * case-sensitive filesystem must resolve the same way every run.
 */
function readLicenseFile(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const byLowercase = new Map();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const key = entry.name.toLowerCase();
    if (!byLowercase.has(key)) byLowercase.set(key, entry.name);
  }
  for (const filename of LICENSE_FILENAMES) {
    const actual = byLowercase.get(filename.toLowerCase());
    if (!actual) continue;
    const candidate = path.join(dir, actual);
    if (!fs.statSync(candidate).isFile()) continue;
    return { filename: actual, text: fs.readFileSync(candidate, "utf8").replace(/\r\n/g, "\n").trim() };
  }
  return null;
}

function repositoryUrl(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    if (!repository) return pkg.homepage ?? null;
    return repository
      .replace(/^git\+/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/\.git$/, "");
  } catch {
    return null;
  }
}

function build() {
  const packages = collectPackages();
  const bodies = new Map(); // hash -> { text, id }
  const attributed = [];
  const declaredOnly = [];
  const failures = [];

  for (const pkg of packages) {
    const file = readLicenseFile(pkg.dir);
    if (!file) {
      if (!pkg.declared) {
        failures.push(`${pkg.name}@${pkg.version} declares no license and ships no license file`);
        continue;
      }
      declaredOnly.push({ name: pkg.name, version: pkg.version, license: pkg.declared, url: repositoryUrl(pkg.dir) });
      continue;
    }

    const copyright = (file.text.match(COPYRIGHT_LINE) ?? []).map((line) => line.trim()).filter(Boolean);
    // Two strippings, because they answer different questions. The single-spaced
    // one decides whether two packages share a grant, so line wrapping cannot
    // split one body into several. The stored one has to stay readable, so it
    // keeps its paragraphs and only loses the blank run the copyright left behind.
    const fingerprintBody = file.text.replace(COPYRIGHT_LINE, "").replace(/\s+/g, " ").trim();
    const storedBody = file.text
      .replace(COPYRIGHT_LINE, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const hash = createHash("sha256").update(fingerprintBody).digest("hex").slice(0, 16);
    // The STRIPPED text, never file.text: a body is shared by up to 39 packages,
    // so storing the first one's file embedded its copyright line in every other
    // package's notice. Each package's own lines travel on its entry below.
    if (!bodies.has(hash)) bodies.set(hash, { text: storedBody, id: `L${bodies.size + 1}` });
    attributed.push({ name: pkg.name, version: pkg.version, license: pkg.declared, body: bodies.get(hash).id, copyright });
  }

  if (failures.length > 0) {
    // Thrown, not exited: postinstall downgrades this to a warning, every other
    // caller lets it fail. Writing a partial notice would be worse than either.
    throw new Error(`Cannot attribute ${failures.length} package(s), so the notice would be incomplete:\n  ${failures.join("\n  ")}`);
  }

  return { packages, bodies, attributed, declaredOnly };
}

function render({ bodies, attributed, declaredOnly }) {
  // Bodies keyed by the id assigned above; the first package to use a body defines it,
  // and the ids are positional so a dependency change produces a readable diff.
  const bodyEntries = [...bodies.values()].map((body) => `  ${body.id}: ${JSON.stringify(body.text)},`).join("\n");
  const attributedEntries = attributed
    .map(
      (entry) =>
        `  { name: ${JSON.stringify(entry.name)}, version: ${JSON.stringify(entry.version)}, license: ${JSON.stringify(entry.license ?? "")}, body: ${JSON.stringify(entry.body)}, copyright: ${JSON.stringify(entry.copyright)} },`,
    )
    .join("\n");
  const declaredEntries = declaredOnly
    .map((entry) => `  { name: ${JSON.stringify(entry.name)}, version: ${JSON.stringify(entry.version)}, license: ${JSON.stringify(entry.license)}, url: ${JSON.stringify(entry.url)} },`)
    .join("\n");

  return `/**
 * bundled-licenses.ts — GENERATED. Do not edit.
 *
 * fingerprint: ${fingerprint()}
 *
 * Run \`npm run licenses\` to rebuild from the production dependency tree.
 * See scripts/generate-licenses.mjs for what it will and will not infer.
 *
 * BUNDLED_LICENSE_BODIES holds each distinct license text once, with copyright
 * lines removed; those live on the package entry that carried them, because the
 * copyright notice is the part MIT and BSD require to travel per package.
 *
 * BUNDLED_PACKAGES_DECLARED_ONLY is not a gap in the notice: those packages state
 * a license in their manifest and ship no license file of their own. They are
 * listed with their repository rather than given a copyright line they never wrote.
 */

export interface BundledPackage {
  name: string;
  version: string;
  license: string;
  /** Key into BUNDLED_LICENSE_BODIES. */
  body: string;
  /** Verbatim copyright lines from this package's own license file. */
  copyright: string[];
}

export interface DeclaredOnlyPackage {
  name: string;
  version: string;
  license: string;
  url: string | null;
}

export const BUNDLED_LICENSE_BODIES: Record<string, string> = {
${bodyEntries}
};

export const BUNDLED_PACKAGES: BundledPackage[] = [
${attributedEntries}
];

export const BUNDLED_PACKAGES_DECLARED_ONLY: DeclaredOnlyPackage[] = [
${declaredEntries}
];
`;
}

function run() {
  // The fast path postinstall takes: nothing that feeds the notice has moved, so
  // there is nothing to regenerate. --check never takes it, because CI has to catch
  // a file edited by hand as well as one left stale.
  if (IF_STALE && !CHECK && committedFingerprint() === fingerprint()) {
    console.log("Licenses unchanged (dependency tree and generator both unmoved).");
    return;
  }

  const result = build();
  const rendered = render(result);

  if (CHECK) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : "";
    if (current !== rendered) {
      console.error("constants/bundled-licenses.ts is out of date. Run `npm run licenses` and commit the result.");
      process.exit(1);
    }
    console.log(`Licenses are current: ${result.attributed.length} attributed, ${result.declaredOnly.length} declared-only, ${result.bodies.size} distinct texts.`);
    return;
  }

  fs.writeFileSync(OUTPUT, rendered);
  const kb = (Buffer.byteLength(rendered) / 1024).toFixed(0);
  console.log(`Wrote constants/bundled-licenses.ts (${kb} KB)`);
  console.log(`  ${result.attributed.length} packages with their own license file`);
  console.log(`  ${result.declaredOnly.length} declaring a license but shipping no file`);
  console.log(`  ${result.bodies.size} distinct license texts`);
}

try {
  run();
} catch (error) {
  // --if-stale is the postinstall path. Nothing here is worth failing an install
  // over: the committed notice is still on disk and still correct for the tree it
  // was built from, and CI regenerates and fails properly on the way to merge.
  // Every other caller — npm run licenses, --check, the release build — fails.
  if (!IF_STALE || CHECK) throw error;
  console.warn("");
  console.warn("  Third-party licenses were NOT regenerated:");
  console.warn(`    ${error.message.split("\n").join("\n    ")}`);
  console.warn("  constants/bundled-licenses.ts is unchanged. Run `npm run licenses` to see the failure in full.");
  console.warn("");
}
