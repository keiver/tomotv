/**
 * One capture -> one App Store Connect image.
 *
 * Four layers: the arc backdrop, a cast shadow, the capture masked to the panel,
 * then panel stroke or shell plus the type. Only the top layer is SVG, so no
 * large raster is ever base64'd through librsvg.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { COLORS } from "./palette.mjs";
import { FRAMES, frameBody, placeFrame } from "./frames.mjs";
import { loadFont, typeset, fitSize, capRatio } from "./typeset.mjs";
import { FIELDS } from "./field.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FONTS = path.join(ROOT, "applestore", "fonts");

const display = loadFont(path.join(FONTS, "ScienceGothic-CndBlk.ttf"));
/** The family's normal-width bold. Mono at subhead size read thin and fought the condensed caps. */
const sub_ = loadFont(path.join(FONTS, "ScienceGothic-Bd.ttf"));

export const DEVICES = {
  iphone: {
    simulator: "iPhone 17 Pro Max",
    canvas: [1320, 2868],
    frame: "phone",
    tune: { margin: 0.06, railTop: 0.028, tierGap: 0.012, gap: 0.024, headSize: 0.105, headMax: 0.1, subRatio: 0.42, ebRatio: 0.26, ruleWidth: 0.075, panelWidth: 0.92, clearance: 0.028 },
    landscape: {
      canvas: [2868, 1320],
      tune: { margin: 0.045, railTop: 0.036, tierGap: 0.013, gap: 0.022, headSize: 0.068, headMax: 0.085, subRatio: 0.4, ebRatio: 0.25, ruleWidth: 0.05, panelWidth: 0.9, clearance: 0.035 },
    },
  },
  ipad: {
    simulator: "iPad Pro 13-inch (M5)",
    canvas: [2064, 2752],
    frame: "ipad",
    tune: { margin: 0.055, railTop: 0.027, tierGap: 0.011, gap: 0.022, headSize: 0.085, headMax: 0.09, subRatio: 0.42, ebRatio: 0.26, ruleWidth: 0.07, panelWidth: 0.93, clearance: 0.028 },
    landscape: {
      canvas: [2752, 2064],
      tune: { margin: 0.05, railTop: 0.036, tierGap: 0.012, gap: 0.023, headSize: 0.066, headMax: 0.085, subRatio: 0.4, ebRatio: 0.25, ruleWidth: 0.055, panelWidth: 0.88, clearance: 0.035 },
    },
  },
  tv: {
    simulator: "Apple TV 4K (3rd generation)",
    canvas: [3840, 2160],
    frame: "tv",
    tune: { margin: 0.05, railTop: 0.044, tierGap: 0.013, gap: 0.026, headSize: 0.066, headMax: 0.088, subRatio: 0.42, ebRatio: 0.26, ruleWidth: 0.05, panelWidth: 0.86, clearance: 0.04 },
  },
};

/**
 * App Store Connect takes either orientation per set, so a landscape capture
 * gets the transposed canvas and the shell laid on its side.
 */
export function deviceProfile(deviceKey, landscape = false) {
  const device = DEVICES[deviceKey];
  if (!landscape || !device.landscape) return { ...device, rotate: false };
  return { ...device, ...device.landscape, rotate: true };
}

/** Which profile a capture wants, read off the file rather than declared. */
export async function orientationOf(file) {
  const meta = await sharp(file).metadata();
  return meta.width > meta.height ? "landscape" : "portrait";
}

const round = (n) => +n.toFixed(2);
const lines = (s) =>
  String(s ?? "")
    .split("\n")
    .filter(Boolean);

const CAP_TRACK = -0.005;
const SUB_TRACK = 0.005;
const EB_TRACK = 0.16;
const LINE_HEIGHT = 1.02;
const SUB_LINE = 1.5;

/** Panel corner and hairline, as fractions of the canvas width. */
const PANEL_RADIUS = 0.009;
const PANEL_STROKE = 0.0013;

/**
 * One vertical rhythm for the whole set.
 *
 * Sizing each shot on its own gave every image a different type size, so the
 * panel under it sat at a different height in each. The set is sized to its
 * longest line and its tallest block, so the panel lands on the same pixel.
 */
export function setMetrics(device, shots) {
  const [W, H] = device.canvas;
  const t = device.tune;
  const box = W - 2 * W * t.margin;
  const heads = shots.map((s) => lines(s.title));
  const subs = shots.map((s) => lines(s.spec)).filter((l) => l.length);
  const ebs = shots.map((s) => lines(s.eyebrow)).filter((l) => l.length);

  const headSize = Math.min(
    ...heads.map((l) => fitSize(display, l, W * t.headSize, CAP_TRACK, box)),
    (H * t.headMax) / (capRatio(display) + Math.max(...heads.map((l) => l.length - 1)) * LINE_HEIGHT),
  );
  const block = (font, all, size, track, lh) => Math.max(0, ...all.map((l) => typeset(font, l, { size, tracking: track, lineHeight: lh }).height));
  // Sized off the headline, not the canvas: portrait and landscape take their
  // short edge from different axes, so a canvas fraction drifts between them.
  const fitAll = (all, ratio, track) => Math.min(headSize * ratio, ...all.map((l) => fitSize(sub_, l, headSize * ratio, track, box)));

  const subSize = subs.length ? fitAll(subs, t.subRatio, SUB_TRACK) : 0;
  const ebSize = ebs.length ? fitAll(ebs, t.ebRatio, EB_TRACK) : 0;

  const m = {
    headSize,
    headHeight: block(display, heads, headSize, CAP_TRACK, LINE_HEIGHT),
    subSize,
    subHeight: subs.length ? block(sub_, subs, subSize, SUB_TRACK, SUB_LINE) : 0,
    ebSize,
    ebHeight: ebs.length ? block(sub_, ebs, ebSize, EB_TRACK, SUB_LINE) : 0,
    ruleHeight: Math.max(2, H * 0.0024),
  };
  const gap = H * t.tierGap;
  m.ebTop = H * t.railTop + m.ruleHeight + gap * 0.85;
  m.headTop = m.ebTop + (m.ebHeight ? m.ebHeight + gap : 0) + gap * 0.4;
  m.subTop = m.headTop + m.headHeight + (m.subHeight ? gap * 1.25 : 0);
  m.panelTop = m.subTop + m.subHeight + H * t.gap;
  return m;
}

/**
 * The panel, whole: `panelWidth` unless the room under the type runs out first,
 * then centred in what is left. A cut-off device reads as a mistake, and on the
 * player shot it cropped the transport controls out of the frame.
 */
function panelRect(device, top) {
  const [W, H] = device.canvas;
  const t = device.tune;
  const room = H - top - H * t.clearance;
  const place = (ratio) => {
    const width = Math.min(W * t.panelWidth, room / ratio);
    return { width, y: top + Math.max(0, room - width * ratio) / 2 };
  };

  if (!device.frame) {
    const { width, y } = place(H / W);
    return { shell: null, screen: { x: (W - width) / 2, y, width, height: width * (H / W), radius: W * PANEL_RADIUS } };
  }
  const [, , vw, vh] = FRAMES[device.frame].viewBox;
  const { width, y } = place(device.rotate ? vw / vh : vh / vw);
  const placed = placeFrame(device.frame, (W - width) / 2, y, width, device.rotate);
  return { shell: placed, screen: placed.screen };
}

function layout(device, shot, shared) {
  const [W, H] = device.canvas;
  const t = device.tune;
  const margin = W * t.margin;
  const m = shared ?? setMetrics(device, [shot]);
  const box = W - 2 * margin;

  const head = lines(shot.title);
  const measured = typeset(display, head, { size: m.headSize, tracking: CAP_TRACK, lineHeight: LINE_HEIGHT });
  // Shorter blocks centre inside the shared height rather than moving the panel.
  const headY = m.headTop + Math.max(0, m.headHeight - measured.height) / 2;

  const { shell, screen } = panelRect(device, m.panelTop);

  return {
    W,
    H,
    margin,
    box,
    head,
    sub: lines(shot.spec),
    eb: lines(shot.eyebrow),
    metrics: m,
    headY,
    captionSize: m.headSize,
    rule: { x: (W - W * t.ruleWidth) / 2, y: H * t.railTop, width: W * t.ruleWidth, height: m.ruleHeight },
    shell,
    screen,
  };
}

/**
 * Grain, tiled. It exists to break the banding a dark gradient shows at 4K;
 * librsvg's feTurbulence does the same job at 11s a canvas against 0.8s here.
 */
let grainTile = null;
const grain = async () =>
  (grainTile ??= sharp({ create: { width: 512, height: 512, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 8 } } })
    .greyscale()
    .toColourspace("srgb")
    .png()
    .toBuffer());

async function base(L, spec) {
  const s = L.screen;
  const ink = spec.ink;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}">${spec.svg}
  <defs><filter id="cast" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${round(L.W * 0.024)}"/></filter></defs>
  <rect x="${round(s.x)}" y="${round(s.y + L.H * 0.014)}" width="${round(s.width)}" height="${round(s.height)}" rx="${round(s.radius ?? 0)}" fill="${ink.shadow}" opacity="${ink.shadowOpacity}" filter="url(#cast)"/>
</svg>`);
  const grainLayer = { input: await grain(), tile: true, blend: "overlay" };

  if (spec.image) {
    let art = sharp(path.join(ROOT, spec.image.file)).resize(L.W, L.H, { fit: "cover", position: spec.image.position, kernel: "lanczos3" });
    if (spec.image.brightness) art = art.modulate({ brightness: spec.image.brightness });
    const bg = await art.toBuffer();
    return sharp(bg)
      .composite([{ input: svg }, grainLayer])
      .png()
      .toBuffer();
  }
  return sharp(svg).composite([grainLayer]).png().toBuffer();
}

/**
 * The capture scaled to the panel and masked to its radius, then cut to what the
 * canvas shows. sharp rejects a composite larger than its base, so a panel that
 * bleeds has to be cropped before it is placed.
 */
async function screen(capture, s, W, H) {
  const w = Math.round(s.width);
  const h = Math.round(s.height);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${round(s.radius ?? 0)}" fill="#fff"/></svg>`);
  const full = await sharp(capture)
    .resize(w, h, { fit: "cover", position: "centre", kernel: "lanczos3" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();

  const left = Math.round(s.x);
  const top = Math.round(s.y);
  const cropL = Math.max(0, -left);
  const cropT = Math.max(0, -top);
  const width = Math.min(w - cropL, W - Math.max(0, left));
  const height = Math.min(h - cropT, H - Math.max(0, top));
  if (width <= 0 || height <= 0) throw new Error("The panel falls entirely outside the canvas");
  if (cropL || cropT || width !== w || height !== h) {
    return { buffer: await sharp(full).extract({ left: cropL, top: cropT, width, height }).png().toBuffer(), left: Math.max(0, left), top: Math.max(0, top) };
  }
  return { buffer: full, left, top };
}

/** Panel hairline or device shell, the accent rail, and the three tiers of type. */
function overlay(device, L, spec) {
  const ink = spec.ink;
  const m = L.metrics;
  const s = L.screen;
  const type = (ls, size, track, y) =>
    ls.length && size ? typeset(sub_, ls, { size, tracking: track, lineHeight: SUB_LINE, x: round(L.margin), y: round(y), align: "center", boxWidth: round(L.box) }) : null;

  const caption = L.head.length
    ? typeset(display, L.head, { size: m.headSize, tracking: CAP_TRACK, lineHeight: LINE_HEIGHT, x: round(L.margin), y: round(L.headY), align: "center", boxWidth: round(L.box) })
    : null;
  const subhead = type(L.sub, m.subSize, SUB_TRACK, m.subTop);
  const eb = type(
    L.eb.map((l) => l.toUpperCase()),
    m.ebSize,
    EB_TRACK,
    m.ebTop,
  );

  const frame = device.frame
    ? `<g transform="${L.shell.transform}">${frameBody(device.frame)}</g>`
    : `<rect x="${round(s.x)}" y="${round(s.y)}" width="${round(s.width)}" height="${round(s.height)}" rx="${round(s.radius)}" fill="none" stroke="#FFFFFF" stroke-opacity="${spec.panelStroke ?? 0.16}" stroke-width="${round(L.W * PANEL_STROKE)}"/>`;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}" fill="none">
  <defs>
    <filter id="lift" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="${round(L.H * (ink.flat ? 0.0012 : 0.0025))}" stdDeviation="${round(L.W * (ink.flat ? 0.0008 : 0.005))}" flood-color="${ink.shadow}" flood-opacity="${ink.flat ? 0.28 : 0.55}"/>
    </filter>
  </defs>
  ${frame}
  <rect x="${round(L.rule.x)}" y="${round(L.rule.y)}" width="${round(L.rule.width)}" height="${round(L.rule.height)}" rx="${round(L.rule.height / 2)}" fill="${ink.rule}"/>
  ${eb ? `<path d="${eb.d}" fill="${ink.rule}"/>` : ""}
  ${caption ? `<g filter="url(#lift)"><path d="${caption.d}" fill="${ink.head}"/></g>` : ""}
  ${subhead ? `<path d="${subhead.d}" fill="${ink.sub}" fill-opacity="${ink.subOpacity}"/>` : ""}
</svg>`);
}

/** Alpha is rejected by App Store Connect, so the result is flattened to 3 channels. */
export async function compose(device, shot, capturePath, outPath, shared, place = { index: 0, count: 1 }) {
  const L = layout(device, shot, shared);
  const spec = (FIELDS[shot.field ?? place.field] ?? FIELDS.app)(L, { ...place, device });

  const [bg, panel] = await Promise.all([base(L, spec), screen(capturePath, L.screen, L.W, L.H)]);

  await sharp(bg)
    .composite([{ input: panel.buffer, left: panel.left, top: panel.top }, { input: overlay(device, L, spec) }])
    .flatten({ background: COLORS.BACKGROUND_DEEP })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  return { canvas: device.canvas, captionSize: L.captionSize, panel: L.screen };
}

export { layout };
