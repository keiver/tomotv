#!/usr/bin/env node
/**
 * Keeps every change to packages/* behind a version npm does not have yet, and checks what each
 * package would ship. A published version records the commit it was published from (gitHead);
 * any change to the package since that commit needs a new version before it merges.
 *
 * Usage:
 *   --staged   pre-commit: a commit touching a package whose version is already on npm bumps its patch
 *   --check    CI: fails when a package changed since its published commit without a new version
 *   --files    CI: fails when a package's tarball misses a file its sources or native specs need
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PACKAGES = ["tomo-engine", "tomo-live"];
/** Files that change with a release itself, never a reason for one. */
const RELEASE_FILES = ["package.json", "CHANGELOG.md"];

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const manifest = (pkg) => JSON.parse(fs.readFileSync(path.join(ROOT, "packages", pkg, "package.json"), "utf8"));

/** The published version's commit; null when npm does not have the version; throws when npm cannot be asked. */
function publishedHead(name, version) {
  try {
    const out = execFileSync("npm", ["view", `${name}@${version}`, "gitHead", "--json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (!out) return null;
    return JSON.parse(out) || "unknown";
  } catch (error) {
    if (String(error.stderr ?? "").includes("E404")) return null;
    throw new Error(`npm view ${name}@${version} failed: ${String(error.stderr ?? error.message).split("\n")[0]}`);
  }
}

const pathspec = (pkg) => [`packages/${pkg}`, ...RELEASE_FILES.map((file) => `:(exclude)packages/${pkg}/${file}`)];

function staged() {
  const changed = git("diff", "--cached", "--name-only", "--", ...PACKAGES.flatMap(pathspec))
    .split("\n")
    .filter(Boolean);
  for (const pkg of PACKAGES) {
    if (!changed.some((file) => file.startsWith(`packages/${pkg}/`))) continue;
    const { name, version } = manifest(pkg);
    let head;
    try {
      head = publishedHead(name, version);
    } catch (error) {
      console.warn(`package-versions: ${error.message}; ${name} left at ${version}, CI will ask for the bump.`);
      continue;
    }
    if (head === null) continue;
    execFileSync("npm", ["version", "patch", "--no-git-tag-version", "-w", `packages/${pkg}`], { cwd: ROOT, stdio: "ignore" });
    git("add", `packages/${pkg}/package.json`, "package-lock.json");
    console.log(`package-versions: ${name} ${version} is on npm, bumped to ${manifest(pkg).version}.`);
  }
}

function check() {
  const failures = [];
  for (const pkg of PACKAGES) {
    const { name, version } = manifest(pkg);
    const head = publishedHead(name, version);
    if (head === null) continue;
    if (head === "unknown") {
      failures.push(`${name}@${version} is on npm without a recorded commit; bump it (npm run release:${pkg.replace("tomo-", "")} -- patch).`);
      continue;
    }
    try {
      git("cat-file", "-e", `${head}^{commit}`);
    } catch {
      failures.push(`${name}@${version} was published from ${head}, which this checkout does not have (fetch full history).`);
      continue;
    }
    const changed = git("diff", "--name-only", head, "HEAD", "--", ...pathspec(pkg));
    if (changed)
      failures.push(
        `${name} changed since ${version} was published (${head.slice(0, 8)}) but still says ${version}; run npm run release:${pkg.replace("tomo-", "")} -- patch.\n  ${changed.split("\n").join("\n  ")}`,
      );
  }
  return failures;
}

/** Relative imports in the package's sources that the tarball would not carry. */
function files() {
  const failures = [];
  for (const pkg of PACKAGES) {
    const dir = path.join(ROOT, "packages", pkg);
    const { name, main } = manifest(pkg);
    // npm 11 prints an array of packs, npm 12 an object keyed by package name.
    const report = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    const packed = Array.isArray(report) ? report[0] : report[name];
    const shipped = new Set(packed.files.map((file) => file.path));
    const need = [main, "README.md", "LICENSE", "CHANGELOG.md"];
    for (const file of ["app.plugin.js", "expo-module.config.json", "ffmpeg-lock.json", "scripts/fetch-ffmpeg.js"]) if (fs.existsSync(path.join(dir, file))) need.push(file);
    for (const file of shipped) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      for (const [, spec] of source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
        const base = path.posix.join(path.posix.dirname(file), spec);
        if (![".ts", ".tsx", "/index.ts"].some((ext) => shipped.has(base + ext))) failures.push(`${name}: ${file} imports ${spec}, which the tarball does not carry.`);
      }
    }
    for (const file of need) if (!shipped.has(file)) failures.push(`${name}: the tarball is missing ${file}.`);
    const specs = fs.existsSync(path.join(dir, "ios")) ? fs.readdirSync(path.join(dir, "ios")).filter((file) => file.endsWith(".podspec")) : [];
    for (const spec of specs.map((file) => `ios/${file}`)) {
      if (!shipped.has(spec)) {
        failures.push(`${name}: the tarball is missing ${spec}.`);
        continue;
      }
      const sources = fs.readFileSync(path.join(dir, spec), "utf8").match(/source_files\s*=\s*"([^"]*)"/);
      if (!sources) continue;
      const folder = sources[1].split("*")[0].replace(/\/$/, "");
      const prefix = path.posix.join(path.posix.dirname(spec), folder) + "/";
      if (![...shipped].some((file) => file.startsWith(prefix) && /\.(swift|m|h)$/.test(file))) failures.push(`${name}: ${spec} compiles ${prefix}, which the tarball does not carry.`);
    }
  }
  return failures;
}

const mode = process.argv[2];
if (mode === "--staged") {
  staged();
} else if (mode === "--check" || mode === "--files") {
  const failures = mode === "--check" ? check() : files();
  for (const failure of failures) console.error(failure);
  if (failures.length) process.exit(1);
  console.log(mode === "--check" ? "package-versions: every changed package carries an unpublished version." : "package-versions: every tarball carries what its sources and specs need.");
} else {
  console.error("Usage: node scripts/package-versions.mjs --staged | --check | --files");
  process.exit(2);
}
