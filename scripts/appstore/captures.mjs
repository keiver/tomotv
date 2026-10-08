import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { hashFile, loadManifest } from "./cache.mjs";
import { DISPLAY_TYPES } from "./platforms.mjs";

/** Read-only release gate. Never manufacture a capture or upload a placeholder. */
export async function validateCaptures(root, config, devices = Object.keys(config.devices), locales = Object.keys(config.locales)) {
  const base = path.join(root, "applestore", "captures");
  const manifestPath = path.join(base, ".placeholders.json");
  const placeholders = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
  const problems = new Set();
  for (const locale of locales) {
    for (const device of devices) {
      for (const shot of config.shots.filter((shot) => shot.devices.includes(device))) {
        const key = `${device}/${shot.id}`;
        const english = path.join(base, `${key}.png`);
        const own = locale === "en" ? english : path.join(base, locale, `${key}.png`);
        const file = fs.existsSync(own) ? own : english;
        if (!fs.existsSync(file)) {
          problems.add(`${key}: missing capture at ${path.relative(root, english)} (localized captures are optional)`);
          continue;
        }
        if (placeholders[key] === createHash("sha256").update(fs.readFileSync(file)).digest("hex")) {
          problems.add(`${key}: CAPTURE PENDING; replace ${path.relative(root, file)} with a real screenshot`);
          continue;
        }
        if (device === "mac") {
          const meta = await sharp(file).metadata();
          if (!meta.width || !meta.height || Math.abs(meta.width / meta.height - 1.6) / 1.6 > 0.01) {
            problems.add(`${path.relative(root, file)}: Mac captures must be landscape 16:10 (for example 2880x1800)`);
          }
        }
      }
    }
  }
  if (problems.size) throw new Error([...problems].join("\n"));
}

/** Only configured, unchanged renders from the current captures may be uploaded. */
export async function generatedShots(root, config, locale, device) {
  const dir = path.join(root, "applestore", "generated", locale);
  const manifest = loadManifest(dir);
  const files = [];
  for (const shot of config.shots.filter((shot) => shot.devices.includes(device))) {
    const key = `${device}/${shot.id}`;
    const file = path.join(dir, `${key}.png`);
    const own = path.join(root, "applestore", "captures", ...(locale === "en" ? [] : [locale]), `${key}.png`);
    const capture = fs.existsSync(own) ? own : path.join(root, "applestore", "captures", `${key}.png`);
    const entry = manifest[key];
    if (!fs.existsSync(file) || !entry || entry.sha !== hashFile(file) || entry.capture !== path.relative(root, capture) || entry.captureSha !== hashFile(capture)) {
      throw new Error(`${locale}/${key}: missing or stale render. Run npm run shots -- --render first.`);
    }
    const meta = await sharp(file).metadata();
    if (`${meta.width}x${meta.height}` !== DISPLAY_TYPES[device].size || meta.hasAlpha) throw new Error(`${file}: invalid App Store size or transparency`);
    files.push(file);
  }
  return files;
}
