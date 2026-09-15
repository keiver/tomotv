#!/usr/bin/env node
/**
 * make-test-books.mjs
 *
 * Builds the book fixture set for the reader: a generated PDF, the same pages as a
 * cbz, cbt and cb7, a generated EPUB, plus pinned public-domain files (Gutenberg
 * MOBI and KF8, an archive.org CBR) listed in test/playback/book-sources.json.
 *
 * Writes to ~/Books/development-books. That directory sits outside every library
 * path on the dev server on purpose: a books folder under ~/Movies or ~/Music would
 * be claimed by that library and never resolve as books (the BookResolver only runs
 * inside a `books` collection).
 *
 * Usage:
 *   node scripts/make-test-books.mjs                # generate + download
 *   node scripts/make-test-books.mjs --library      # also register "Development Books"
 *   node scripts/make-test-books.mjs --force        # rebuild generated files
 *
 * The library step mutates a real server and is opt-in, as in make-test-media.mjs.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ensureLibrary, jf, loadEnv } from "./lib/jellyfin-library.mjs";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env.playback-test");
const SOURCES_PATH = path.join(ROOT, "test", "playback", "book-sources.json");
const BOOKS_DIR = path.join(os.homedir(), "Books", "development-books");
const CACHE_DIR = path.join(os.homedir(), "Movies", ".tomotv-media-cache");
const GENERATOR = path.join(ROOT, "scripts", "books", "make-fixtures.swift");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const FORCE = flag("--force");
const failures = [];

function log(msg) {
  console.log(msg);
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  if (fs.existsSync(part)) fs.rmSync(part);
  await exec("curl", ["-fSL", "--retry", "5", "--retry-delay", "3", "--retry-all-errors", "--connect-timeout", "20", "--max-time", "1800", "-o", part, url], { maxBuffer: 4 * 1024 * 1024 });
  fs.renameSync(part, dest);
  return fs.statSync(dest).size;
}

/** The PDF, PNG pages and EPUB tree from the Swift generator, then the archives around them. */
async function buildGenerated() {
  const scratch = path.join(CACHE_DIR, "books-generated");
  const marker = path.join(scratch, "fixtures.ok");
  if (FORCE) fs.rmSync(scratch, { recursive: true, force: true });
  if (!fs.existsSync(marker)) {
    fs.mkdirSync(scratch, { recursive: true });
    log("  generating pdf, pages and epub tree");
    await exec("swift", [GENERATOR, scratch], { maxBuffer: 4 * 1024 * 1024 });
    fs.writeFileSync(marker, "");
  }
  fs.mkdirSync(BOOKS_DIR, { recursive: true });

  const copy = (from, to) => {
    const dest = path.join(BOOKS_DIR, to);
    if (!FORCE && fs.existsSync(dest)) return log(`  = ${to}`);
    fs.copyFileSync(path.join(scratch, from), dest);
    log(`  + ${to}`);
  };
  copy("Tomo Fixture Book.pdf", "Tomo Fixture Book.pdf");

  const pages = path.join(scratch, "pages");
  const pageFiles = fs
    .readdirSync(pages)
    .filter((f) => f.endsWith(".png"))
    .sort();
  const archive = async (name, argv) => {
    const dest = path.join(BOOKS_DIR, name);
    if (!FORCE && fs.existsSync(dest)) return log(`  = ${name}`);
    fs.rmSync(dest, { force: true });
    await exec(argv[0], [...argv.slice(1), dest, ...pageFiles], { cwd: pages });
    log(`  + ${name}`);
  };
  await archive("Tomo Fixture Comic.cbz", ["zip", "-q", "-X"]);
  // ustar, not pax: the server counts pax extended headers as pages.
  await archive("Tomo Fixture Comic Tar.cbt", ["/usr/bin/tar", "--format", "ustar", "-cf"]);
  // /usr/bin/tar is bsdtar and writes 7-Zip.
  await archive("Tomo Fixture Comic 7z.cb7", ["/usr/bin/tar", "--format", "7zip", "-cf"]);

  const epubDest = path.join(BOOKS_DIR, "Tomo Fixture Novel.epub");
  if (FORCE || !fs.existsSync(epubDest)) {
    fs.rmSync(epubDest, { force: true });
    const src = path.join(scratch, "epub-src");
    // mimetype first and stored, as the EPUB container spec requires.
    await exec("zip", ["-q", "-X", "-0", epubDest, "mimetype"], { cwd: src });
    await exec("zip", ["-q", "-X", "-r", epubDest, "META-INF", "OEBPS"], { cwd: src });
    log("  + Tomo Fixture Novel.epub");
  } else {
    log("  = Tomo Fixture Novel.epub");
  }
}

/** Pinned public-domain files: bytes and sha256 must match book-sources.json. */
async function buildDownloaded() {
  const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));
  for (const [id, source] of Object.entries(sources)) {
    const dest = path.join(BOOKS_DIR, source.file);
    if (fs.existsSync(dest) && fs.statSync(dest).size === source.bytes && sha256(dest) === source.sha256) {
      log(`  = ${source.file}`);
      continue;
    }
    const cached = path.join(CACHE_DIR, "books", `${id}${path.extname(source.file)}`);
    if (!fs.existsSync(cached) || sha256(cached) !== source.sha256) {
      log(`  downloading ${id}`);
      await download(source.url, cached);
    }
    const got = sha256(cached);
    if (got !== source.sha256 || fs.statSync(cached).size !== source.bytes) {
      failures.push(`${id}: expected sha256 ${source.sha256} (${source.bytes} bytes), got ${got} (${fs.statSync(cached).size} bytes)`);
      console.warn(`  ✗ ${id} does not match its pin`);
      continue;
    }
    fs.mkdirSync(BOOKS_DIR, { recursive: true });
    fs.copyFileSync(cached, dest);
    log(`  + ${source.file}`);
  }
}

async function main() {
  log(`Books -> ${BOOKS_DIR}`);
  await buildGenerated();
  await buildDownloaded();

  if (flag("--library")) {
    const env = loadEnv(ENV_PATH);
    if (!env) {
      console.warn(`\nSkipping library step: ${ENV_PATH} missing or incomplete.`);
    } else {
      log(`\nLibrary on ${env.JELLYFIN_URL}`);
      await ensureLibrary(env, "Development Books", "books", BOOKS_DIR, { log, failures });
      await jf(env, "/Library/Refresh", { method: "POST" }).catch((e) => console.warn(`  refresh failed: ${e.message}`));
    }
  }

  const files = fs.readdirSync(BOOKS_DIR).filter((f) => !f.startsWith("."));
  log(`\n${files.length} files in ${BOOKS_DIR}`);
  if (failures.length) {
    console.error("\nProblems:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
