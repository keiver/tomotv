#!/usr/bin/env node
/**
 * Regenerates constants/demo-credits.json from the manifest the demo server publishes.
 *
 * The demo box builds https://tomotv.cubita.studio/credits.json from the same lists
 * that place its media, one item per clip, album, book, photo, show and Live TV
 * source, each with its maker, licence and source page. The app ships a copy so the
 * Credits screen opens with the full list and refreshes it from the server only when
 * the server's copy is newer.
 *
 * What it refuses to do: accept a manifest that is not the full shape. An item
 * without a title, maker, licence, licence link or source page fails the run, so a
 * half-written manifest never ships.
 *
 * Usage:
 *   npm run demo-credits          rewrite constants/demo-credits.json from the server
 *   npm run demo-credits:check    verify the committed file matches the server (CI)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_REL = path.join("constants", "demo-credits.json");
const OUTPUT = path.join(ROOT, OUTPUT_REL);
const URL = "https://tomotv.cubita.studio/credits.json";
const CHECK = process.argv.includes("--check");
const FIELDS = ["library", "title", "by", "licence", "licenceUrl", "source"];

function validate(manifest) {
  if (typeof manifest?.generated !== "string" || !Array.isArray(manifest.items)) throw new Error(`${URL}: not a manifest with generated and items`);
  const incomplete = manifest.items.filter((item) => FIELDS.some((field) => typeof item?.[field] !== "string" || item[field].length === 0));
  if (incomplete.length) throw new Error(`${URL}: ${incomplete.length} items without a ${FIELDS.join(", ")}: ${incomplete.map((item) => item?.title).join("; ")}`);
  const badImage = manifest.items.filter((item) => !(item.image === null || item.image === undefined || (typeof item.image === "string" && item.image.length > 0)));
  if (badImage.length) throw new Error(`${URL}: ${badImage.length} items whose image is neither a URL nor null: ${badImage.map((item) => item.title).join("; ")}`);
  return manifest;
}

const response = await fetch(URL, { headers: { Accept: "application/json" } });
if (!response.ok) throw new Error(`${URL}: HTTP ${response.status}`);
const manifest = validate(await response.json());
const text = JSON.stringify(manifest, null, 2) + "\n";

if (CHECK) {
  const committed = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : "";
  if (committed !== text) {
    console.error(`${OUTPUT_REL} differs from ${URL}: run npm run demo-credits and commit the result`);
    process.exit(1);
  }
  console.log(`${OUTPUT_REL}: matches the server, ${manifest.items.length} items generated ${manifest.generated}`);
} else {
  fs.writeFileSync(OUTPUT, text);
  console.log(`${OUTPUT_REL}: ${manifest.items.length} items generated ${manifest.generated}`);
}
