/**
 * Content checksums for the render. An output is redrawn only when the hash of
 * what it is drawn from moves, or when its own bytes no longer match the record.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = ".shots-manifest.json";

export const hash = (...parts) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(typeof p === "string" || Buffer.isBuffer(p) ? p : JSON.stringify(p)).update("\0");
  return h.digest("hex");
};

const fileHashes = new Map();
/** Memoized per path and mtime, so a file read by every locale is hashed once. */
export function hashFile(file) {
  const { mtimeMs, size } = fs.statSync(file);
  const memo = fileHashes.get(file);
  if (memo && memo.mtimeMs === mtimeMs && memo.size === size) return memo.sha;
  const sha = hash(fs.readFileSync(file));
  fileHashes.set(file, { mtimeMs, size, sha });
  return sha;
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.startsWith(".") ? [] : [path.join(dir, e.name)]));

/** The renderer's code, fonts and colour tokens: a change to any of them redraws everything. */
export const toolchain = () =>
  hash(
    sharp.versions,
    [...walk(path.join(ROOT, "scripts", "appstore")), ...walk(path.join(ROOT, "applestore", "fonts")), path.join(ROOT, "constants", "colors.ts")]
      .sort()
      .map((f) => [path.relative(ROOT, f), hashFile(f)]),
  );

export function loadManifest(dir) {
  const file = path.join(dir, MANIFEST);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function saveManifest(dir, manifest) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** The record still describes the file on disk and was drawn from the same inputs. */
export const fresh = (entry, key, out) => entry?.key === key && fs.existsSync(out) && hashFile(out) === entry.sha;
