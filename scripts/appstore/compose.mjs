/**
 * One capture -> one App Store Connect image.
 *
 * Four layers: the backdrop with its cast shadow, the capture masked to the panel,
 * the panel stroke or shell, then the type. Backdrop and shell are the same for
 * every shot in a device set, so they render once per set and stay raw.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { COLORS } from "./palette.mjs";
import { FRAMES, frameBody, placeFrame } from "./frames.mjs";
import { loadFace, typeset, fitSize, blockEm } from "./typeset.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FONTS = path.join(ROOT, "applestore", "fonts");

const face = (file) => loadFace(path.join(FONTS, file));
/** The band's own face is squared like the headline, but open where the caption has to read. */
const LATIN = { display: face("ScienceGothic-CndBlk.ttf"), sub: face("SpaceGrotesk-SemiBold.ttf") };

let display = LATIN.display;
let sub_ = LATIN.sub;

/**
 * Swap the two faces for a locale. A stack falls back left to right, so a
 * script font with no Latin still sets "Jellyfin" in the brand face.
 */
export function setFonts(fonts) {
  const stack = (files, fallback) => (files?.length ? [...files.map(face), fallback] : fallback);
  display = stack(fonts?.display, LATIN.display);
  sub_ = stack(fonts?.sub, LATIN.sub);
}

/** Depth below the baseline, so a band centres the ink box and not the cap box. */
const descentOf = (stack) => {
  // Noto Devanagari has no "p"; take the depth from the first face that does.
  const f = [stack].flat().find((x) => x.font.charToGlyph("p").index) ?? [stack].flat()[0];
  return Math.abs(f.font.charToGlyph("p").getMetrics().yMin) / f.font.unitsPerEm;
};

export const DEVICES = {
  iphone: {
    simulator: "iPhone 17 Pro Max",
    canvas: [1320, 2868],
    frame: "phone",
    tune: { margin: 0.06, railTop: 0.028, tierGap: 0.012, gap: 0.024, headSize: 0.105, headMax: 0.1, subRatio: 0.68, ebRatio: 0.26, panelWidth: 0.92, clearance: 0.028 },
  },
  ipad: {
    simulator: "iPad Pro 13-inch (M5)",
    canvas: [2064, 2752],
    frame: "ipad",
    tune: { margin: 0.055, railTop: 0.027, tierGap: 0.011, gap: 0.022, headSize: 0.085, headMax: 0.09, subRatio: 0.68, ebRatio: 0.26, panelWidth: 0.93, clearance: 0.028 },
  },
  tv: {
    simulator: "Apple TV 4K (3rd generation)",
    canvas: [3840, 2160],
    // Full bleed: the listing is read from across a room, so the capture gets the whole canvas.
    bleed: true,
    tune: { margin: 0.05, railTop: 0.044, tierGap: 0.013, gap: 0.026, headSize: 0.066, headMax: 0.088, subRatio: 0.68, ebRatio: 0.26, panelWidth: 0.86, clearance: 0.04 },
  },
};

/**
 * The App Store app draws a landscape shot into the portrait tile when a set
 * mixes the two, so every phone and tablet capture has to be upright.
 */
export async function wrongOrientation(file, deviceKey) {
  const [cw, ch] = DEVICES[deviceKey].canvas;
  const meta = await sharp(file).metadata();
  const landscape = meta.width > meta.height;
  if (landscape === cw > ch) return null;
  return `${meta.width}x${meta.height} is ${landscape ? "landscape" : "portrait"}; ${deviceKey} takes ${cw > ch ? "landscape" : "portrait"} only`;
}

const round = (n) => +n.toFixed(2);
const lines = (s) =>
  String(s ?? "")
    .split("\n")
    .filter(Boolean);

const CAP_TRACK = -0.005;
const SUB_TRACK = 0.03;
const EB_TRACK = 0.16;
const LINE_HEIGHT = 1.02;
const SUB_LINE = 1.5;
/** Band height as a multiple of the type it carries. */
const BAR_PAD = 2.6;

/** Panel corner and hairline, as fractions of the canvas width. */
const PANEL_RADIUS = 0.009;
const PANEL_STROKE = 0.0013;

/**
 * components/card-scrim.tsx's ramps, [offset, black opacity], held denser at the dark end: the
 * app's tab bar sits under the headline and cut rows under the band. The foot is a canvas fraction.
 */
const CORNER_STOPS = [
  [0, 0.97],
  [0.4, 0.92],
  [0.6, 0.62],
  [0.82, 0.2],
  [1, 0],
];
const BOTTOM_STOPS = [
  [0, 0],
  [0.55, 0.45],
  [1, 0.92],
];
const FOOT_WASH = 0.22;

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

  const headSize = Math.min(...heads.map((l) => fitSize(display, l, W * t.headSize, CAP_TRACK, box)), ...heads.map((l) => (H * t.headMax) / blockEm(display, l, LINE_HEIGHT).crown));
  const block = (font, all, size, track, lh) => Math.max(0, ...all.map((l) => typeset(font, l, { size, tracking: track, lineHeight: lh }).height));
  // Sized off the headline rather than the canvas, so the ratios hold whatever
  // the canvas is.
  const fitAll = (all, ratio, track) => Math.min(headSize * ratio, ...all.map((l) => fitSize(sub_, l, headSize * ratio, track, box)));

  const subSize = subs.length ? fitAll(subs, t.subRatio, SUB_TRACK) : 0;
  const ebSize = ebs.length ? fitAll(ebs, t.ebRatio, EB_TRACK) : 0;

  const m = {
    headSize,
    headHeight: Math.max(0, ...heads.map((l) => blockEm(display, l, LINE_HEIGHT).span * headSize)),
    subSize,
    subHeight: subs.length ? block(sub_, subs, subSize, SUB_TRACK, SUB_LINE) : 0,
    ebSize,
    ebHeight: ebs.length ? block(sub_, ebs, ebSize, EB_TRACK, SUB_LINE) : 0,
  };
  const gap = H * t.tierGap;
  m.ebTop = H * t.railTop;
  m.headTop = m.ebTop + (m.ebHeight ? m.ebHeight + gap : 0) + gap * 0.4;
  // The spec rides a gold band bled to the bottom edge, so it leaves the headline
  // stack and the panel gets the room it used to occupy.
  m.barHeight = m.subHeight ? m.subHeight * BAR_PAD : 0;
  m.barTop = H - m.barHeight;
  m.subTop = m.barTop + (m.barHeight - m.subHeight - descentOf(sub_) * m.subSize) / 2;
  m.panelTop = m.headTop + m.headHeight + H * t.gap;
  return m;
}

/**
 * The panel, whole: `panelWidth` unless the room under the type runs out first,
 * then centred in what is left. A cut-off device reads as a mistake, and on the
 * player shot it cropped the transport controls out of the frame.
 */
function panelRect(device, top, reserved = 0) {
  const [W, H] = device.canvas;
  const t = device.tune;
  if (device.bleed) return { shell: null, screen: { x: 0, y: 0, width: W, height: H, radius: 0 } };
  const room = H - top - H * t.clearance - reserved;
  const place = (ratio) => {
    const width = Math.min(W * t.panelWidth, room / ratio);
    return { width, y: top + Math.max(0, room - width * ratio) / 2 };
  };

  if (!device.frame) {
    const { width, y } = place(H / W);
    return { shell: null, screen: { x: (W - width) / 2, y, width, height: width * (H / W), radius: W * PANEL_RADIUS } };
  }
  const [, , vw, vh] = FRAMES[device.frame].viewBox;
  const { width, y } = place(vh / vw);
  const placed = placeFrame(device.frame, (W - width) / 2, y, width);
  return { shell: placed, screen: placed.screen };
}

function layout(device, shot, shared) {
  const [W, H] = device.canvas;
  const t = device.tune;
  const margin = W * t.margin;
  const m = shared ?? setMetrics(device, [shot]);
  const box = W - 2 * margin;

  const head = lines(shot.title);
  const measured = blockEm(display, head, LINE_HEIGHT).span * m.headSize;
  // Shorter blocks centre inside the shared height rather than moving the panel.
  const headY = m.headTop + Math.max(0, m.headHeight - measured) / 2;

  const { shell, screen } = panelRect(device, m.panelTop, m.barHeight);

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
    // Gold falls on the line that carries the claim, which is the last one in
    // every caption written so far. `accent: -1` in the config opts a shot out.
    accent: shot.accent ?? head.length - 1,
    captionSize: m.headSize,
    bleed: Boolean(device.bleed),
    shell,
    screen,
  };
}

/** Shared layers, keyed by everything that draws them. Held until resetLayers(). */
const layers = new Map();
const memo = (key, make) => {
  if (!layers.has(key)) layers.set(key, make());
  return layers.get(key);
};
export const resetLayers = () => layers.clear();

const raw = (pipeline) => pipeline.raw().toBuffer({ resolveWithObject: true });
const asInput = ({ data, info }) => ({ input: data, raw: { width: info.width, height: info.height, channels: info.channels } });

/** Type and shadow colours, from constants/colors.ts. */
const INK = { head: COLORS.TEXT_PRIMARY, rule: COLORS.ACCENT, shadow: "#000", shadowOpacity: 0.7 };

/** Largest canvas edge: a background rasterises once at this size and every device crops from it. */
const MASTER = Math.max(...Object.values(DEVICES).flatMap((d) => d.canvas));
const masters = new Map();
const rasterise = (background) => {
  if (!masters.has(background))
    masters.set(
      background,
      sharp(background)
        .metadata()
        .then(({ width, height }) => raw(sharp(background, { density: (72 * MASTER) / Math.min(width, height) }))),
    );
  return masters.get(background);
};

/** The background image cover-scaled to the canvas and centre-cropped, with the device's cast shadow. */
async function base(L, background) {
  const s = L.screen;
  // One key light from upper left: a tight contact shadow the device sits on and
  // a long soft cast below it. A single symmetric blur reads as a sticker.
  const shadow = (dx, dy, blur, opacity, id) => `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${round(blur)}"/></filter>
  <rect x="${round(s.x + dx)}" y="${round(s.y + dy)}" width="${round(s.width)}" height="${round(s.height)}" rx="${round(s.radius ?? 0)}" fill="${INK.shadow}" opacity="${opacity}" filter="url(#${id})"/>`;

  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}">
  ${shadow(L.W * 0.012, L.H * 0.026, L.W * 0.03, round(INK.shadowOpacity * 0.72), "cast")}
  ${shadow(L.W * 0.002, L.H * 0.005, L.W * 0.005, round(INK.shadowOpacity * 0.85), "contact")}
</svg>`);
  const master = await rasterise(background);
  const art = await raw(sharp(master.data, { raw: master.info }).resize(L.W, L.H, { fit: "cover", position: "centre", kernel: "lanczos3" }).flatten({ background: COLORS.BACKGROUND_DEEP }));
  return raw(sharp(art.data, { raw: art.info }).composite([{ input: svg }]));
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

/** Panel hairline or device shell. */
function frame(device, L) {
  const s = L.screen;
  const body = device.bleed
    ? ""
    : device.frame
      ? `<g transform="${L.shell.transform}">${frameBody(device.frame)}</g>`
      : `<rect x="${round(s.x)}" y="${round(s.y)}" width="${round(s.width)}" height="${round(s.height)}" rx="${round(s.radius)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="${round(L.W * PANEL_STROKE)}"/>`;
  return raw(sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}" fill="none">${body}</svg>`)));
}

/** The gold band and the three tiers of type. */
function overlay(L) {
  const ink = INK;
  const m = L.metrics;
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

  // The app's card scrims (components/card-scrim.tsx): a radial wash whose radii put the type at
  // 60% of the reach, and the bottom wash that eases the art into the gold bar.
  const stops = (list) => list.map(([at, a]) => `<stop offset="${at}" stop-color="#000" stop-opacity="${a}"/>`).join("");
  let washDefs = "";
  let wash = "";
  if (L.bleed) {
    const rx = L.W / 2 / 0.6;
    const ry = (L.headY + m.headHeight) / 0.6;
    const footTop = m.barTop - L.H * FOOT_WASH;
    washDefs = `<radialGradient id="head" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${round(L.W / 2)} 0) scale(${round(rx)} ${round(ry)})">${stops(CORNER_STOPS)}</radialGradient>
    <linearGradient id="foot" x1="0" y1="0" x2="0" y2="1">${stops(BOTTOM_STOPS)}</linearGradient>`;
    wash = `<rect width="${L.W}" height="${round(ry)}" fill="url(#head)"/>
  ${subhead ? `<rect y="${round(footTop)}" width="${L.W}" height="${round(m.barTop - footTop)}" fill="url(#foot)"/>` : ""}`;
  }

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}" fill="none">
  <defs>
    ${washDefs}
    <filter id="lift" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="${round(L.H * 0.0025)}" stdDeviation="${round(L.W * 0.005)}" flood-color="${ink.shadow}" flood-opacity="0.55"/>
    </filter>
  </defs>
  ${wash}
  ${eb ? `<path d="${eb.d}" fill="${ink.rule}"/>` : ""}
  ${caption ? `<g filter="url(#lift)">${caption.lineData.map((d, i) => `<path d="${d}" fill="${i === L.accent ? ink.rule : ink.head}"/>`).join("")}</g>` : ""}
  ${subhead ? `<rect x="0" y="${round(m.barTop)}" width="${L.W}" height="${round(m.barHeight)}" fill="${COLORS.ACCENT}"/>` : ""}
  ${subhead ? `<path d="${subhead.d}" fill="${COLORS.ON_ACCENT_WARM}"/>` : ""}
</svg>`);
}

/** Alpha is rejected by App Store Connect, so the result is flattened to 3 channels. */
export async function compose(device, shot, capturePath, outPath, shared, background) {
  const L = layout(device, shot, shared);
  const key = JSON.stringify([device.frame, L.W, L.H, L.screen, L.shell?.transform, background]);

  const [bg, shell, panel] = await Promise.all([memo(`base ${key}`, () => base(L, background)), memo(`frame ${key}`, () => frame(device, L)), screen(capturePath, L.screen, L.W, L.H)]);

  await sharp(bg.data, { raw: bg.info })
    .composite([{ input: panel.buffer, left: panel.left, top: panel.top }, asInput(shell), { input: overlay(L) }])
    .flatten({ background: COLORS.BACKGROUND_DEEP })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  return { canvas: device.canvas, captionSize: L.captionSize, panel: L.screen };
}

export { layout };
