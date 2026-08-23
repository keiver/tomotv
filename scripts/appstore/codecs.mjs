/**
 * The formats the app actually handles, read from the source of truth so the
 * artwork cannot claim a codec the engine does not carry.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Pull a `const NAME = [ ... ]` array of string literals out of a TS source file. */
function arrayFrom(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const start = src.indexOf(`${name} = [`);
  if (start < 0) throw new Error(`${file} no longer defines ${name}`);
  // Comments come out first: localRemux names codecs it deliberately excludes inside them.
  const body = src
    .slice(start, src.indexOf("];", start))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return [...body.matchAll(/"([a-z0-9_-]+)"/g)].map((m) => m[1]);
}

/** Prefix tokens that are the same format twice; the wall shows one name each. */
const ALIASES = new Set(["avc", "h265", "hvc1", "hev1", "mp4a", "ac-3", "ec-3", "av01", "mpeg1", "mpeg2", "vp7", "vp6"]);

export function formats() {
  const all = [
    ...arrayFrom("constants/codecs.ts", "REMUXABLE_CODECS"),
    ...arrayFrom("services/localRemux.ts", "TRANSCODABLE_VIDEO_CODECS"),
    ...arrayFrom("services/localRemux.ts", "REMUXABLE_AUDIO_CODECS"),
  ];
  const seen = new Set();
  const out = [];
  for (const token of all) {
    if (ALIASES.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token.toUpperCase());
  }
  return out;
}
