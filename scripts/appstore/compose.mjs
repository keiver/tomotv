/**
 * One capture -> one App Store Connect image.
 *
 * Four layers: the app's ambient backdrop, a shadow and bloom, the capture
 * masked to the shell's aperture, then the shell, plate and caption as vector.
 * Only the top layer is SVG, so no large raster is ever base64'd through librsvg.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { COLORS } from "./palette.mjs";
import { FRAMES, frameBody, placeFrame } from "./frames.mjs";
import { loadFont, typeset, fitSize, capRatio } from "./typeset.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FONTS = path.join(ROOT, "applestore", "fonts");

const display = loadFont(path.join(FONTS, "ScienceGothic-CndBlk.ttf"));
const label = loadFont(path.join(FONTS, "IBMPlexMono-SemiBold.ttf"));

export const DEVICES = {
  iphone: {
    simulator: "iPhone 17 Pro Max",
    canvas: [1320, 2868],
    frame: "phone",
    backdrop: "assets/images/ambient-background-portrait.png",
    tune: { margin: 0.055, capTop: 0.028, capMax: 0.2, gap: 0.034, clearance: 0.033, scrim: 0.4, deviceWidth: 0.84, captionSize: 0.135, bandSize: 0.036 },
  },
  ipad: {
    simulator: "iPad Pro 13-inch (M5)",
    canvas: [2064, 2752],
    frame: "ipad",
    backdrop: "assets/images/ambient-background-portrait.png",
    tune: { margin: 0.05, capTop: 0.026, capMax: 0.17, gap: 0.03, clearance: 0.03, scrim: 0.36, deviceWidth: 0.86, captionSize: 0.105, bandSize: 0.028 },
  },
  tv: {
    simulator: "Apple TV 4K (3rd generation)",
    canvas: [3840, 2160],
    frame: "tv",
    backdrop: "assets/images/ambient-background.png",
    tune: { margin: 0.045, capTop: 0.04, capMax: 0.16, gap: 0.028, clearance: 0.025, scrim: 0.4, deviceWidth: 0.76, captionSize: 0.115, bandSize: 0.019 },
  },
};

const round = (n) => +n.toFixed(2);

/**
 * Hue of the glow behind the device. The robot's CRT screen from
 * assets/brand/tomo-tv.svg — a brand colour, and the only one that does not
 * compete with the gold caption and gold band already in the frame.
 */
const BLOOM = "#A3CB38";

/** Tight tracking keeps the condensed caps reading as one mass at poster size. */
const CAP_TRACK = -0.005;
const BAND_TRACK = 0.04;
const LINE_HEIGHT = 1.02;

/** The loading bar completed: components/folder-loading-bar.tsx snaps to 1 on handoff. */

/**
 * No panel: the caption sits on the backdrop, clear of the device. Depth comes
 * from a cast shadow and from a scrim fading the device's top into the field —
 * the scrim's stops are components/card-scrim.tsx, turned to run downward.
 */
/**
 * One type size and one block height for the whole set.
 *
 * Fitting each caption on its own gave every shot a different size, so the block
 * under it — and the device below that — sat at a different height in each
 * image. The set is sized to its longest line and its tallest block instead, so
 * the device lands on the same pixel in every shot.
 */
export function captionMetrics(deviceKey, shots) {
  const device = DEVICES[deviceKey];
  const [W, H] = device.canvas;
  const t = device.tune;
  const margin = W * t.margin;
  const all = shots.map((s) => String(s.title).split("\n"));

  const size = Math.min(
    ...all.map((lines) => fitSize(display, lines, W * t.captionSize, CAP_TRACK, W - 2 * margin)),
    (H * t.capMax) / (capRatio(display) + Math.max(...all.map((l) => l.length - 1)) * LINE_HEIGHT),
  );
  const height = Math.max(...all.map((lines) => typeset(display, lines, { size, tracking: CAP_TRACK, lineHeight: LINE_HEIGHT }).height));
  return { size, height };
}

function layout(device, shot, shared) {
  const [W, H] = device.canvas;
  const t = device.tune;
  const margin = W * t.margin;
  const lines = String(shot.title).split("\n");

  const size = shared?.size ?? fitSize(display, lines, W * t.captionSize, CAP_TRACK, W - 2 * margin);
  const blockHeight = shared?.height ?? 0;
  const caption = typeset(display, lines, { size, tracking: CAP_TRACK, lineHeight: LINE_HEIGHT, align: "center", boxWidth: W - 2 * margin });

  // Shorter captions centre inside the shared block rather than pushing the device up.
  const capY = H * t.capTop + Math.max(0, blockHeight - caption.height) / 2;
  const capBottom = H * t.capTop + Math.max(blockHeight, caption.height);

  // Scaled off the short edge: on a 16:9 canvas a width-scaled band eats twice
  // the vertical share it does in portrait.
  const bandSize = Math.min(W, H) * t.bandSize;
  const bandHeight = bandSize * 1.3;

  // Full-bleed platforms hand the whole canvas to the screenshot: the capture is
  // already the canvas size, so it renders 1:1 instead of being downscaled into
  // a shell, and the caption overlays it rather than competing for height.
  const [, , vw, vh] = FRAMES[device.frame].viewBox;
  const ratio = vh / vw;
  const deviceTop = t.bleed ? 0 : capBottom + H * t.gap;
  const room = H - bandHeight - H * t.clearance - deviceTop;
  const deviceWidth = t.bleed ? W : Math.min(W * t.deviceWidth, room / ratio);

  return {
    W,
    H,
    margin,
    lines,
    captionSize: size,
    caption,
    capX: margin,
    capY,
    scrimHeight: H * t.scrim,
    bleed: !!t.bleed,
    frame: t.bleed ? { scale: 1, height: H, transform: "", screen: { x: 0, y: 0, width: W, height: H, radius: 0 } } : placeFrame(device.frame, (W - deviceWidth) / 2, deviceTop, deviceWidth),
    band: { top: H - bandHeight, height: bandHeight, size: bandSize, maxWidth: W - 2 * margin },
  };
}

/**
 * Backdrop directions.
 *
 * The field must not read as the app's own wallpaper, and it has to give a very
 * dark device something to sit against. Each entry returns the SVG body for a
 * full-canvas field plus the caption colour that field demands.
 */
/**
 * Backdrop fields.
 *
 * Built to sourced rules rather than taste, after three passes of single-hue
 * washes that read as dirt. What was wrong: one hue ramping to #000 with no
 * texture. Chroma collapses at the dark end, so the eye sees a smudge, not a
 * gradient. The rules that fix it:
 *   - never land on pure black; the darkest stop stays chromatic
 *   - at least two hues far enough apart to resolve as separate light
 *   - a dark device separates from a dark field by HUE, not by luminance
 *   - fractalNoise grain kills the banding that gives dark gradients away
 * Gold stays under ~15% of the surface: as a blanket it reads as a filter.
 */
const MESH_STOPS = (id, p) => `<radialGradient id="${id}" cx="${p.x}%" cy="${p.y}%" r="${p.r}%">
      <stop offset="0" stop-color="${p.c}" stop-opacity="${p.o}"/>
      <stop offset="0.5" stop-color="${p.c}" stop-opacity="${round(p.o * 0.42)}"/>
      <stop offset="1" stop-color="${p.c}" stop-opacity="0"/>
    </radialGradient>`;

/** One recipe -> the SVG body for a full-canvas field. */
function meshField({ base, points, lantern = 0.075, corner = "#000104", grain = 0.55 }) {
  return (L, s) => ({
    caption: COLORS.ACCENT,
    glow: true,
    svg: `<defs>
      ${points.map((p, i) => MESH_STOPS(`m${i}`, p)).join("")}
      <radialGradient id="lantern" cx="${round(((s.x + s.width / 2) / L.W) * 100)}%" cy="${round(((s.y + s.height * 0.3) / L.H) * 100)}%" r="32%">
        <stop offset="0" stop-color="${COLORS.ACCENT}" stop-opacity="${lantern}"/>
        <stop offset="1" stop-color="${COLORS.ACCENT}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="vig" cx="50%" cy="46%" r="74%">
        <stop offset="0.38" stop-color="${corner}" stop-opacity="0"/>
        <stop offset="1" stop-color="${corner}" stop-opacity="0.86"/>
      </radialGradient>
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="3" stitchTiles="stitch"/>
        <feColorMatrix type="saturate" values="0"/>
        <feComponentTransfer><feFuncA type="linear" slope="${grain}"/></feComponentTransfer>
      </filter>
    </defs>
    <rect width="${L.W}" height="${L.H}" fill="${base}"/>
    ${points.map((_, i) => `<rect width="${L.W}" height="${L.H}" fill="url(#m${i})"/>`).join("")}
    <rect width="${L.W}" height="${L.H}" fill="url(#lantern)"/>
    <rect width="${L.W}" height="${L.H}" fill="url(#vig)"/>
    <rect width="${L.W}" height="${L.H}" filter="url(#grain)" style="mix-blend-mode:overlay"/>`,
  });
}

/**
 * An artwork field: the supplied image cover-cropped, then the same lantern,
 * vignette and grain the generated fields use. Portrait crops to the gold edge
 * because a centre crop of a landscape source keeps only its empty middle.
 */
function imageField({ file, band, caption, glow = false }) {
  return (L, s) => ({
    caption,
    glow,
    band,
    image: { file, position: L.W > L.H ? "centre" : "left" },
    svg: `<defs>
      <radialGradient id="lantern" cx="${round(((s.x + s.width / 2) / L.W) * 100)}%" cy="${round(((s.y + s.height * 0.3) / L.H) * 100)}%" r="34%">
        <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.28"/>
        <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="vig" cx="50%" cy="46%" r="76%">
        <stop offset="0.42" stop-color="#4A3200" stop-opacity="0"/>
        <stop offset="1" stop-color="#4A3200" stop-opacity="0.38"/>
      </radialGradient>
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="3" stitchTiles="stitch"/>
        <feColorMatrix type="saturate" values="0"/>
        <feComponentTransfer><feFuncA type="linear" slope="0.34"/></feComponentTransfer>
      </filter>
    </defs>
    <rect width="${L.W}" height="${L.H}" fill="url(#lantern)"/>
    <rect width="${L.W}" height="${L.H}" fill="url(#vig)"/>
    <rect width="${L.W}" height="${L.H}" filter="url(#grain)" style="mix-blend-mode:multiply"/>`,
  });
}

export const FIELDS = {
  /** The app's own ambient backdrop, darkened, with a gold bloom behind the device. */
  app: (L, s, device) => ({
    caption: COLORS.ACCENT,
    glow: true,
    bloom: BLOOM,
    image: { file: device.backdrop, position: "centre", brightness: 0.72 },
    svg: `<defs>
      <radialGradient id="bloom" cx="${round(((s.x + s.width / 2) / L.W) * 100)}%" cy="${round(((s.y + s.height * 0.42) / L.H) * 100)}%" r="80%">
        <stop offset="0" stop-color="${BLOOM}" stop-opacity="0.26"/>
        <stop offset="1" stop-color="${BLOOM}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${L.W}" height="${L.H}" fill="url(#bloom)"/>`,
  }),

  /** The supplied film-reel artwork. Dark caption and a sunken band, since the field is light. */
  bg: imageField({
    file: "applestore/bg.png",
    caption: COLORS.ON_ACCENT_WARM,
    shadow: "#3A2600",
    band: { bg: COLORS.SURFACE_SUNKEN, fg: COLORS.ACCENT },
  }),

  /** Amber against deep blue: 162° apart, gold's own complement family. */
  ember: meshField({
    base: "#00050f",
    points: [
      { x: 26, y: 22, r: 62, c: "#4D2900", o: 0.95 },
      { x: 78, y: 58, r: 58, c: "#002E4F", o: 0.9 },
      { x: 44, y: 88, r: 54, c: "#002B2D", o: 0.75 },
    ],
  }),

  /** Cool-dominant. Gold reads at its hottest against a teal ground. */
  teal: meshField({
    base: "#00070C",
    points: [
      { x: 20, y: 70, r: 66, c: "#002B2D", o: 0.95 },
      { x: 74, y: 24, r: 60, c: "#00344F", o: 0.85 },
      { x: 52, y: 50, r: 48, c: "#3D2200", o: 0.6 },
    ],
    lantern: 0.07,
  }),

  /** Warm-dominant with a single cool counterpoint low in the frame. */
  warm: meshField({
    base: "#0B0500",
    points: [
      { x: 32, y: 26, r: 64, c: "#5C3000", o: 0.95 },
      { x: 80, y: 78, r: 56, c: "#00263F", o: 0.8 },
      { x: 18, y: 86, r: 46, c: "#2A1400", o: 0.7 },
    ],
    lantern: 0.08,
    corner: "#050200",
  }),

  /** Daylight: a light warm field. A dark device separates on luminance alone here. */
  daylight: (L, s) => ({
    caption: COLORS.ON_ACCENT_WARM,
    glow: false,
    svg: `<defs>
      <linearGradient id="sky" x1="0.15" y1="0" x2="0.85" y2="1">
        <stop offset="0" stop-color="#F6EBD2"/>
        <stop offset="0.45" stop-color="#E8D9B6"/>
        <stop offset="1" stop-color="#CBB489"/>
      </linearGradient>
      <radialGradient id="sun" cx="${round(((s.x + s.width / 2) / L.W) * 100)}%" cy="${round(((s.y + s.height * 0.24) / L.H) * 100)}%" r="46%">
        <stop offset="0" stop-color="#FFF6DC" stop-opacity="0.95"/>
        <stop offset="1" stop-color="#FFF6DC" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="warmEdge" cx="86%" cy="88%" r="62%">
        <stop offset="0" stop-color="${COLORS.ACCENT}" stop-opacity="0.32"/>
        <stop offset="1" stop-color="${COLORS.ACCENT}" stop-opacity="0"/>
      </radialGradient>
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="3" stitchTiles="stitch"/>
        <feColorMatrix type="saturate" values="0"/>
        <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
      </filter>
    </defs>
    <rect width="${L.W}" height="${L.H}" fill="url(#sky)"/>
    <rect width="${L.W}" height="${L.H}" fill="url(#warmEdge)"/>
    <rect width="${L.W}" height="${L.H}" fill="url(#sun)"/>
    <rect width="${L.W}" height="${L.H}" filter="url(#grain)" style="mix-blend-mode:multiply"/>`,
  }),

  /** Duotone: a gold plate behind the caption, black below. Loudest at thumbnail size. */
  duotone: (L) => ({
    caption: COLORS.ON_ACCENT_WARM,
    glow: false,
    svg: `<defs>
      <linearGradient id="plate" x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0" stop-color="#FFD24A"/>
        <stop offset="1" stop-color="${COLORS.ACCENT}"/>
      </linearGradient>
    </defs>
    <rect width="${L.W}" height="${L.H}" fill="#0A0A0C"/>
    <rect width="${L.W}" height="${round(L.H * 0.34)}" fill="url(#plate)"/>`,
  }),
};

async function base(device, L, fieldName) {
  const s = L.frame.screen;
  const field = (FIELDS[fieldName] ?? FIELDS.app)(L, s, device);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}">${field.svg}</svg>`);

  if (field.image) {
    const art = await sharp(path.join(ROOT, field.image.file)).resize(L.W, L.H, { fit: "cover", position: field.image.position, kernel: "lanczos3" }).toBuffer();
    const layers = [{ input: svg }];
    if (!L.bleed) {
      layers.push({
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}">
  <defs><filter id="cast" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${round(L.W * 0.026)}"/></filter></defs>
  <rect x="${round(s.x)}" y="${round(s.y + L.H * 0.016)}" width="${round(s.width)}" height="${round(s.height)}" rx="${round(s.radius)}" fill="${field.shadow ?? "#000"}" opacity="0.62" filter="url(#cast)"/>
</svg>`),
      });
    }
    return sharp(art).composite(layers).png().toBuffer();
  }

  const cast = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}">
  <defs><filter id="cast" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${round(L.W * 0.026)}"/></filter></defs>
  <rect x="${round(s.x)}" y="${round(s.y + L.H * 0.016)}" width="${round(s.width)}" height="${round(s.height)}" rx="${round(s.radius)}" fill="#000" opacity="0.72" filter="url(#cast)"/>
</svg>`);

  return sharp(svg)
    .composite([{ input: cast }])
    .png()
    .toBuffer();
}

/** The capture, scaled to fill the aperture and masked to its corner radius. */
async function screen(capture, s) {
  const w = Math.round(s.width);
  const h = Math.round(s.height);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${round(s.radius)}" fill="#fff"/></svg>`);
  return sharp(capture)
    .resize(w, h, { fit: "cover", position: "centre", kernel: "lanczos3" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

/**
 * Shell, plate and caption.
 *
 * The plate is the app's card title bar at poster scale: a sunken bar with a
 * gold progress fill, and the caption inverting where the fill has swept past
 * it (components/video-grid-item.tsx). The app gets that from a difference
 * blend; here the same result comes from painting the caption twice against a
 * clip at the fill edge, which librsvg renders deterministically.
 */
/**
 * The bottom band is components/folder-loading-bar.tsx at poster scale: a sunken
 * full-bleed strip, no radii, gold sweeping to the trickle target, and the label
 * inverting where the fill passes under it.
 */
function bandSvg(L, spec, band) {
  const b = L.band;
  const words = String(spec).toUpperCase();
  const size = fitSize(label, [words], b.size, BAND_TRACK, b.maxWidth);
  const measured = typeset(label, [words], { size, tracking: BAND_TRACK, align: "left" });
  const laid = typeset(label, [words], {
    size,
    tracking: BAND_TRACK,
    x: (L.W - measured.width) / 2,
    y: b.top + (b.height - measured.height) / 2,
    align: "left",
  });

  return `<g>
    <rect x="0" y="${round(b.top)}" width="${L.W}" height="${round(b.height)}" fill="${band?.bg ?? COLORS.ACCENT}"/>
    <path d="${laid.d}" fill="${band?.fg ?? COLORS.ON_ACCENT_WARM}"/>
  </g>`;
}

function overlay(device, L, shot, field) {
  const caption = typeset(display, L.lines, {
    size: L.captionSize,
    tracking: CAP_TRACK,
    lineHeight: LINE_HEIGHT,
    x: round(L.capX),
    y: round(L.capY),
    align: "center",
    boxWidth: round(L.W - 2 * L.margin),
  });

  // A black drop shadow on a near-black field is invisible. Gold type gets a
  // gold bloom so it reads as emissive; dark type on the gold plate gets a
  // tight warm contact shadow instead.
  const lift = field.glow
    ? `<filter id="lift" x="-45%" y="-45%" width="190%" height="190%">
         <feDropShadow dx="0" dy="0" stdDeviation="${round(L.W * 0.03)}" flood-color="${COLORS.ACCENT}" flood-opacity="0.5"/>
         <feDropShadow dx="0" dy="0" stdDeviation="${round(L.W * 0.008)}" flood-color="#FF9A1F" flood-opacity="0.45"/>
         <feDropShadow dx="0" dy="${round(L.H * 0.003)}" stdDeviation="${round(L.W * 0.004)}" flood-color="#1A0A02" flood-opacity="0.75"/>
       </filter>`
    : `<filter id="lift" x="-25%" y="-25%" width="150%" height="150%">
         <feDropShadow dx="0" dy="${round(L.H * 0.0035)}" stdDeviation="${round(L.W * 0.005)}" flood-color="#8A5E00" flood-opacity="0.55"/>
       </filter>`;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}" fill="none">
  <defs>${lift}
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.97"/>
      <stop offset="0.62" stop-color="#000" stop-opacity="0.9"/>
      <stop offset="0.84" stop-color="#000" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
  </defs>
  ${L.bleed ? `<rect x="0" y="0" width="${L.W}" height="${round(L.H * 0.42)}" fill="url(#scrim)"/>` : `<g transform="${L.frame.transform}">${frameBody(device.frame)}</g>`}
  <g filter="url(#lift)"><path d="${caption.d}" fill="${field.caption}"/></g>
  ${shot.spec ? bandSvg(L, shot.spec, field.band) : ""}
</svg>`);
}

/** Alpha is rejected by App Store Connect, so the result is flattened to 3 channels. */
export async function compose(deviceKey, shot, capturePath, outPath, shared, fieldName = "app") {
  const device = DEVICES[deviceKey];
  const L = layout(device, shot, shared);
  const field = (FIELDS[fieldName] ?? FIELDS.app)(L, L.frame.screen, device);
  const [bg, shot_] = await Promise.all([base(device, L, fieldName), screen(capturePath, L.frame.screen)]);

  await sharp(bg)
    .composite([{ input: shot_, left: Math.round(L.frame.screen.x), top: Math.round(L.frame.screen.y) }, { input: overlay(device, L, shot, field) }])
    .flatten({ background: "#0A0A0C" })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  return { canvas: device.canvas, captionSize: L.captionSize, plate: L.plate };
}

export { layout };
