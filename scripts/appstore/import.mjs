/**
 * Hand-off flow: adopt screenshots taken by hand instead of driving simulators.
 *
 * Scans a directory (default ~/Desktop) for folders named for a platform, checks
 * every image in them against that platform's canvas, and maps them onto the
 * config's shots. Nothing is adopted silently, the mapping is printed before it
 * is written, and every rejection states its reason.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DEVICES } from "./compose.mjs";

/** Folder-name patterns, most specific first: "tvos" must not be read as iOS. */
const FOLDER_PATTERNS = [
  ["tv", /(tvos|appletv|apple-tv|\btv\b)/i],
  ["ipad", /(ipad|tablet)/i],
  ["iphone", /(iphone|\bios\b)/i],
];

/** A capture is usable when its aspect matches the canvas; exact size is ideal. */
const ASPECT_TOLERANCE = 0.01;
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg"]);

/** Apple names the file after the simulator, which catches a misfiled shot. */
const FILENAME_DEVICE = /Simulator Screenshot - (.+?) - /;
const DEVICE_FAMILY = [
  ["tv", /apple ?tv/i],
  ["ipad", /ipad/i],
  ["iphone", /iphone/i],
];

function familyFromFilename(file) {
  const named = FILENAME_DEVICE.exec(path.basename(file))?.[1];
  if (!named) return null;
  return DEVICE_FAMILY.find(([, re]) => re.test(named))?.[0] ?? null;
}

/** The newest `limit` entries, so a Desktop with years of files stays cheap to scan. */
export function findDeviceFolders(root, limit = 100) {
  const dir = root || path.join(os.homedir(), "Desktop");
  if (!fs.existsSync(dir)) throw new Error(`No such directory: ${dir}`);

  const recent = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => ({ name: e.name, full: path.join(dir, e.name), mtime: fs.statSync(path.join(dir, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  const found = [];
  for (const entry of recent) {
    const matches = FOLDER_PATTERNS.filter(([, re]) => re.test(entry.name)).map(([key]) => key);
    if (!matches.length) continue;
    if (matches.length > 1) {
      found.push({ ...entry, deviceKey: matches[0], ambiguous: matches });
      continue;
    }
    found.push({ ...entry, deviceKey: matches[0] });
  }
  return { dir, folders: found };
}

/** Chronological, because that is the order the shots were taken in. */
function imagesIn(folder) {
  return fs
    .readdirSync(folder)
    .filter((f) => !f.startsWith(".") && IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => ({ name: f, full: path.join(folder, f), mtime: fs.statSync(path.join(folder, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
}

async function inspect(file, deviceKey) {
  const [cw, ch] = DEVICES[deviceKey].canvas;
  const wanted = cw / ch;
  const meta = await sharp(file.full)
    .metadata()
    .catch(() => null);
  if (!meta?.width) return { ...file, ok: false, why: "not a readable image" };

  const family = familyFromFilename(file.name);
  if (family && family !== deviceKey) {
    return { ...file, ok: false, why: `filename names a ${family} simulator, not ${deviceKey}` };
  }

  // Only the canvas's own orientation: the App Store app redraws a sideways shot
  // into the portrait tile when a set mixes the two.
  const aspect = meta.width / meta.height;
  if (Math.abs(aspect - wanted) / wanted > ASPECT_TOLERANCE) {
    return { ...file, ok: false, why: `${meta.width}x${meta.height} is the wrong shape for ${cw}x${ch}` };
  }
  return {
    ...file,
    ok: true,
    width: meta.width,
    height: meta.height,
    exact: meta.width === cw && meta.height === ch,
  };
}

/**
 * Map files onto shots: a filename that opens with a shot's id or number claims
 * that shot; everything else fills the remaining shots in capture order.
 */
export function assign(shots, files) {
  const byShot = new Map();
  const claimed = new Set();
  const duplicates = [];

  for (const file of files) {
    const stem = path.basename(file.name, path.extname(file.name)).toLowerCase();
    const shot = shots.find((s) => {
      const number = s.id.split("-")[0];
      return stem.startsWith(s.id.toLowerCase()) || new RegExp(`^${number}\\b|^${number}[-_. ]`).test(stem);
    });
    if (!shot) continue;
    // Claimed whether or not it wins the slot. A second file named for a taken shot is still
    // named for THAT shot, and leaving it unclaimed hands it to some other shot's caption.
    claimed.add(file.full);
    if (byShot.has(shot.id)) duplicates.push({ ...file, shotId: shot.id });
    else byShot.set(shot.id, file);
  }

  const rest = files.filter((f) => !claimed.has(f.full));
  for (const shot of shots) {
    if (byShot.has(shot.id)) continue;
    const next = rest.shift();
    if (!next) break;
    byShot.set(shot.id, next);
  }
  return { byShot, surplus: rest, duplicates };
}

/**
 * Report what each platform folder offers against the shots configured for it.
 * Returns the plan; writing it is the caller's decision.
 */
export async function planImport(config, plan, root, limit) {
  const { dir, folders } = findDeviceFolders(root, limit);
  const results = [];

  for (const { deviceKey, shots } of plan) {
    const folder = folders.find((f) => f.deviceKey === deviceKey);
    if (!folder) {
      results.push({ deviceKey, folder: null, shots, assignments: [], surplus: [], duplicates: [], rejected: [] });
      continue;
    }
    const inspected = await Promise.all(imagesIn(folder.full).map((f) => inspect(f, deviceKey)));
    const usable = inspected.filter((f) => f.ok);
    const rejected = inspected.filter((f) => !f.ok);
    const { byShot, surplus, duplicates } = assign(shots, usable);
    results.push({
      deviceKey,
      folder,
      shots,
      assignments: shots.map((s) => ({ shot: s, file: byShot.get(s.id) || null })),
      surplus,
      duplicates,
      rejected,
    });
  }
  return { dir, results };
}

/** Copy adopted files into applestore/captures under the shot's own id. */
export function adopt(results, captureDir) {
  let adopted = 0;
  for (const { deviceKey, assignments } of results) {
    const target = path.join(captureDir, deviceKey);
    fs.mkdirSync(target, { recursive: true });
    for (const { shot, file } of assignments) {
      if (!file) continue;
      fs.copyFileSync(file.full, path.join(target, `${shot.id}.png`));
      adopted++;
    }
  }
  return adopted;
}
