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
import { execFileSync } from "node:child_process";
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

function productionTree() {
  // --long is what carries `path` and `license`; without it npm reports neither.
  //
  // npm ls exits non-zero for any tree complaint — a missing peer, an extraneous
  // package — while still printing the full JSON. This runs on postinstall, so
  // throwing there would break `npm install` itself over something cosmetic.
  let raw;
  try {
    raw = execFileSync("npm", ["ls", "--omit=dev", "--all", "--long", "--json"], { cwd: ROOT, maxBuffer: 128 * 1024 * 1024 }).toString();
  } catch (error) {
    raw = error.stdout?.toString() ?? "";
    if (!raw.trim()) throw error;
  }
  return JSON.parse(raw);
}

function collectPackages(tree) {
  const found = new Map();
  (function walk(node) {
    for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
      // `missing` is an unresolved optional/peer dep and `extraneous` is not part of
      // the tree we ship; neither reaches a build, so neither is ours to attribute.
      if (!dep.missing && !dep.extraneous && dep.path) {
        const key = `${name}@${dep.version}`;
        if (!found.has(key)) found.set(key, { name, version: dep.version, dir: dep.path, declared: licenseField(dep) });
      }
      walk(dep);
    }
  })(tree);
  return [...found.values()].sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));
}

/** npm normalises most of these, but old packages still use the array form. */
function licenseField(node) {
  if (typeof node.license === "string") return node.license;
  if (node.license?.type) return node.license.type;
  if (Array.isArray(node.licenses)) return node.licenses.map((entry) => entry.type ?? entry).join(" OR ");
  return null;
}

function readLicenseFile(dir) {
  for (const filename of LICENSE_FILENAMES) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { filename, text: fs.readFileSync(candidate, "utf8").replace(/\r\n/g, "\n").trim() };
    }
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
  const packages = collectPackages(productionTree());
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
    const body = file.text.replace(COPYRIGHT_LINE, "").replace(/\s+/g, " ").trim();
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
    if (!bodies.has(hash)) bodies.set(hash, { text: file.text, id: `L${bodies.size + 1}` });
    attributed.push({ name: pkg.name, version: pkg.version, license: pkg.declared, body: bodies.get(hash).id, copyright });
  }

  if (failures.length > 0) {
    console.error("Cannot attribute these packages, so the notice would be incomplete:");
    failures.forEach((line) => console.error(`  ${line}`));
    process.exit(1);
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

// The fast path postinstall takes: nothing that feeds the notice has moved, so
// there is nothing to regenerate. --check never takes it, because CI has to catch
// a file edited by hand as well as one left stale.
if (IF_STALE && !CHECK && committedFingerprint() === fingerprint()) {
  console.log("Licenses unchanged (dependency tree and generator both unmoved).");
  process.exit(0);
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
} else {
  fs.writeFileSync(OUTPUT, rendered);
  const kb = (Buffer.byteLength(rendered) / 1024).toFixed(0);
  console.log(`Wrote constants/bundled-licenses.ts (${kb} KB)`);
  console.log(`  ${result.attributed.length} packages with their own license file`);
  console.log(`  ${result.declaredOnly.length} declaring a license but shipping no file`);
  console.log(`  ${result.bodies.size} distinct license texts`);
}
