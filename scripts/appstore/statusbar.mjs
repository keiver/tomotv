/**
 * Status bar stamp. One reference frame per device, shot under simctl's status bar
 * override, supplies the time, date and icons as the OS drew them. Each capture's own
 * clusters are erased and that ink is composited in their place, so no glyph is redrawn.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { hash, hashFile } from "./cache.mjs";
import * as sim from "./simctl.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TEMPLATE_DIR = path.join(ROOT, "applestore", "statusbar");

/** Apple's marketing clock, 9:41 AM Tue Jan 9. simctl takes only toISOString() form. */
export const STAMP_TIME = new Date(2024, 0, 9, 9, 41);

/** Full bars, wifi, a white full battery (charged draws it green), no carrier. */
const OVERRIDE = [
  "--dataNetwork",
  "wifi",
  "--wifiMode",
  "active",
  "--wifiBars",
  "3",
  "--cellularMode",
  "active",
  "--cellularBars",
  "4",
  "--operatorName",
  "",
  "--batteryState",
  "discharging",
  "--batteryLevel",
  "100",
];

/** Luminance a pixel must clear its row's median by to count as status bar ink. */
const INK = 40;
/** Pixels of background kept around a cluster when erasing it. */
const PAD = 6;
/** Mean and peak deviation from a straight ramp that still counts as a flat backdrop. */
const FLAT_MEAN = 6;
const FLAT_PEAK = 40;
/** Rows below the template's ink that are searched for a capture's own clusters. */
const SLACK = 10;

const ZONES = { left: [0, 0.45], right: [0.55, 1] };

const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

const files = (deviceKey) => ({ mask: path.join(TEMPLATE_DIR, `${deviceKey}.png`), meta: path.join(TEMPLATE_DIR, `${deviceKey}.json`) });

/**
 * Ink bounding box per zone, or null for a zone with none. The bar is the first run of
 * inked rows from y0, so app chrome under it never joins a cluster.
 */
export function findClusters(img, y0, y1) {
  const { data, info } = img;
  const { width: W, channels: C } = info;
  const boxes = { left: null, right: null };
  let started = false;
  for (let y = y0; y < y1; y++) {
    const sample = [];
    for (let x = 0; x < W; x += 4) sample.push(lum(data, (y * W + x) * C));
    sample.sort((a, b) => a - b);
    const bg = sample[sample.length >> 1];
    const hits = [];
    // The outer 2px skip a frame's antialiased alpha edge.
    for (const [zone, [from, to]] of Object.entries(ZONES)) {
      for (let x = Math.max(2, Math.round(from * W)); x < Math.min(W - 2, Math.round(to * W)); x++) {
        if (lum(data, (y * W + x) * C) - bg > INK) hits.push([zone, x]);
      }
    }
    const inked = hits.length >= 2;
    for (const [zone, x] of inked ? hits : []) {
      const b = (boxes[zone] ??= { left: x, right: x, top: y, bottom: y });
      b.left = Math.min(b.left, x);
      b.right = Math.max(b.right, x);
      b.bottom = y;
    }
    if (inked) started = true;
    else if (started) break;
  }
  return boxes;
}

const pixel = (img, x, y) => {
  const i = (y * img.info.width + x) * img.info.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);

/** The box padded and clamped so a column of backdrop stays on each side. */
function padded(box, W, H) {
  return { left: Math.max(1, box.left - PAD), right: Math.min(W - 2, box.right + PAD), top: Math.max(0, box.top - PAD), bottom: Math.min(H - 2, box.bottom + PAD) };
}

/** Backdrop under a box: a per-row ramp between the columns either side of it. */
const ramp = (img, box, x, y) => lerp(pixel(img, box.left - 1, y), pixel(img, box.right + 1, y), (x - box.left + 1) / (box.right - box.left + 2));

/** Why the backdrop around a box is not a ramp the erase can rebuild, or null. */
function notFlat(img, box) {
  const rows = [box.top - 1, box.bottom + 1].filter((y) => y >= 0 && y < img.info.height);
  let sum = 0;
  let n = 0;
  let peak = 0;
  for (const y of rows) {
    for (let x = box.left; x <= box.right; x++) {
      const want = ramp(img, box, x, y);
      const got = pixel(img, x, y);
      const d = Math.max(...got.map((v, k) => Math.abs(v - want[k])));
      sum += d;
      n++;
      peak = Math.max(peak, d);
    }
  }
  const mean = n ? sum / n : 0;
  return mean > FLAT_MEAN || peak > FLAT_PEAK ? `backdrop under the status bar is not flat (mean ${mean.toFixed(1)}, peak ${peak.toFixed(0)})` : null;
}

const rawOf = (input, canvas) => {
  const p = sharp(input);
  return (canvas ? p.resize(canvas[0], canvas[1], { fit: "cover", position: "centre", kernel: "lanczos3" }) : p).removeAlpha().raw().toBuffer({ resolveWithObject: true });
};

/**
 * Shoot the reference frame on a booted simulator and keep its ink as a white mask.
 * Only status_bar and screenshot touch the device; TomoTV must already be on screen.
 */
export async function captureTemplate(deviceKey, profile, scratch) {
  const device = await sim.resolveDevice(profile.simulator);
  if (device.state !== "Booted") throw new Error(`${profile.simulator} is not booted. Boot it with TomoTV on screen and re-run.`);
  const frame = path.join(scratch, `${deviceKey}-statusbar.png`);
  // --time goes last on its own: any override sent with or after it turns iPad's "Tue Jan 9" into "Sun Jan 9".
  await sim.simctl(["status_bar", device.udid, "override", ...OVERRIDE]);
  await sim.simctl(["status_bar", device.udid, "override", "--time", STAMP_TIME.toISOString()]);
  try {
    await sim.sleep(2000);
    await sim.screenshot(device.udid, frame);
  } finally {
    await sim.clearStatusBar(device.udid);
  }
  return buildTemplate(deviceKey, profile, frame);
}

/** The reference frame's ink as a white mask plus its boxes, written to TEMPLATE_DIR. */
export async function buildTemplate(deviceKey, profile, frame) {
  const img = await rawOf(frame);
  const { width: W, height: H } = img.info;
  if (W !== profile.canvas[0] || H !== profile.canvas[1]) throw new Error(`${deviceKey}: ${profile.simulator} shoots ${W}x${H}, the slot is ${profile.canvas.join("x")}`);

  const found = findClusters(img, 0, Math.round(H * 0.06));
  if (!found.left || !found.right) throw new Error(`${deviceKey}: no ${found.left ? "right" : "left"} status bar cluster in the reference frame`);

  const bandH = Math.max(found.left.bottom, found.right.bottom) + PAD + 1;
  const alpha = Buffer.alloc(W * bandH);
  const zones = {};
  for (const [zone, ink] of Object.entries(found)) {
    const box = padded(ink, W, H);
    const why = notFlat(img, box);
    if (why) throw new Error(`${deviceKey} reference frame: ${why}. Put TomoTV on a plain screen and re-run.`);
    for (let y = box.top; y <= box.bottom; y++) {
      for (let x = box.left; x <= box.right; x++) {
        const bg = ramp(img, box, x, y);
        const lb = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
        const a = (lum(img.data, (y * W + x) * img.info.channels) - lb) / (255 - lb);
        alpha[y * W + x] = Math.round(255 * Math.min(1, Math.max(0, a)));
      }
    }
    zones[zone] = { ink, box };
  }

  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  const { mask, meta } = files(deviceKey);
  const white = Buffer.alloc(W * bandH * 4, 255);
  for (let i = 0; i < W * bandH; i++) white[i * 4 + 3] = alpha[i];
  await sharp(white, { raw: { width: W, height: bandH, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(mask);
  fs.writeFileSync(meta, `${JSON.stringify({ simulator: profile.simulator, canvas: [W, H], time: STAMP_TIME.toISOString(), zones }, null, 2)}\n`);
  return { mask, meta };
}

const templates = new Map();
async function loadTemplate(deviceKey) {
  if (templates.has(deviceKey)) return templates.get(deviceKey);
  const { mask, meta } = files(deviceKey);
  let t = null;
  if (fs.existsSync(mask) && fs.existsSync(meta)) {
    const m = JSON.parse(fs.readFileSync(meta, "utf8"));
    const { data, info } = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    t = { ...m, alpha: data, alphaInfo: info };
  }
  templates.set(deviceKey, t);
  return t;
}

/** Part of the render's cache key: a new reference frame redraws every shot it stamps. */
export const templateHash = (deviceKey) => {
  const { mask, meta } = files(deviceKey);
  return fs.existsSync(mask) && fs.existsSync(meta) ? hash(hashFile(mask), hashFile(meta)) : null;
};

/**
 * The capture with its status bar replaced by the reference ink. Returns the source
 * untouched when the device has no template or the frame shows no status bar, and throws
 * when the bar is somewhere the device never draws it or its backdrop cannot be rebuilt.
 */
export async function stampStatusBar(src, deviceKey) {
  const t = await loadTemplate(deviceKey);
  if (!t) return { input: src, status: "no template" };

  const meta = await sharp(src).metadata();
  const scaled = meta.width !== t.canvas[0] || meta.height !== t.canvas[1];
  const img = await rawOf(src, scaled ? t.canvas : null);
  const { width: W, height: H, channels: C } = img.info;

  const ref = Object.values(t.zones);
  const found = findClusters(img, 0, Math.max(...ref.map((z) => z.ink.bottom)) + SLACK);
  if (!found.left && !found.right) return { input: src, status: "no status bar" };

  const boxes = [];
  for (const [zone, { ink, box }] of Object.entries(t.zones)) {
    const own = found[zone];
    if (!own) throw new Error(`no ${zone} status bar cluster where the rest of the bar is`);
    const mid = (b) => (b.top + b.bottom) / 2;
    const tol = Math.max(4, (ink.bottom - ink.top) * 0.3);
    if (Math.abs(mid(own) - mid(ink)) > tol) throw new Error(`the ${zone} status bar cluster sits at rows ${own.top}-${own.bottom}; ${t.simulator} draws it at ${ink.top}-${ink.bottom}`);
    const erase = padded(
      { left: Math.min(own.left, box.left + PAD), right: Math.max(own.right, box.right - PAD), top: Math.min(own.top, box.top + PAD), bottom: Math.max(own.bottom, box.bottom - PAD) },
      W,
      H,
    );
    const why = notFlat(img, erase);
    if (why) throw new Error(why);
    boxes.push(erase);
  }

  for (const box of boxes) {
    for (let y = box.top; y <= box.bottom; y++) {
      for (let x = box.left; x <= box.right; x++) {
        const v = ramp(img, box, x, y);
        const i = (y * W + x) * C;
        for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(v[k]);
      }
    }
  }

  const A = t.alphaInfo;
  for (let y = 0; y < A.height; y++) {
    for (let x = 0; x < A.width; x++) {
      const a = t.alpha[(y * A.width + x) * 4 + 3] / 255;
      if (!a) continue;
      const i = (y * W + x) * C;
      for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(img.data[i + k] * (1 - a) + 255 * a);
    }
  }

  // Geometry only: a resized alpha source reports premultiplied, which would unpremultiply opaque RGB.
  const input = await sharp(img.data, { raw: { width: W, height: H, channels: C } })
    .png()
    .toBuffer();
  return { input, status: scaled ? `stamped (scaled from ${meta.width}x${meta.height})` : "stamped" };
}
