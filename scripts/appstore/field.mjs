/**
 * Backdrop recipes. Each takes the layout and returns the SVG body for a
 * full-canvas field, the ink colours that field demands, and its cast shadow.
 */
import { COLORS } from "./palette.mjs";

const round = (n) => +n.toFixed(2);

/** Ink for a dark ground and for a light one. Both sides come from constants/colors.ts. */
const DARK_INK = { head: COLORS.TEXT_PRIMARY, sub: COLORS.TEXT_PRIMARY, subOpacity: 0.92, rule: COLORS.ACCENT, shadow: "#000", shadowOpacity: 0.7 };
const LIGHT_INK = { head: COLORS.ON_ACCENT_WARM, sub: COLORS.ON_ACCENT_WARM, subOpacity: 0.78, rule: COLORS.ACCENT_DEEP, shadow: "#3A2600", shadowOpacity: 0.45 };

const meshStops = (id, p) => `<radialGradient id="${id}" cx="${p.x}%" cy="${p.y}%" r="${p.r}%">
      <stop offset="0" stop-color="${p.c}" stop-opacity="${p.o}"/>
      <stop offset="0.5" stop-color="${p.c}" stop-opacity="${round(p.o * 0.42)}"/>
      <stop offset="1" stop-color="${p.c}" stop-opacity="0"/>
    </radialGradient>`;

const vignette = (corner, stop, cy = 46, r = 74) => `<radialGradient id="vig" cx="50%" cy="${cy}%" r="${r}%">
      <stop offset="0.38" stop-color="${corner}" stop-opacity="0"/>
      <stop offset="1" stop-color="${corner}" stop-opacity="${stop}"/>
    </radialGradient>`;

/** A glow centred behind the panel, `drop` of the way down it. */
const lantern = (L, color, opacity, r, drop = 0.3) => {
  const s = L.screen;
  return `<radialGradient id="lantern" cx="${round(((s.x + s.width / 2) / L.W) * 100)}%" cy="${round(((s.y + s.height * drop) / L.H) * 100)}%" r="${r}%">
      <stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>`;
};

const fill = (L, id) => `<rect width="${L.W}" height="${L.H}" fill="url(#${id})"/>`;

/**
 * Two lobes of separated hue over a chromatic near-black. The base never lands
 * on #000: chroma collapses there and the gradient reads as a smudge, not light.
 */
function meshField({ base, points, glow = 0.075, corner = "#000104" }) {
  return (L) => ({
    ink: DARK_INK,
    svg: `<defs>${points.map((p, i) => meshStops(`m${i}`, p)).join("")}${lantern(L, COLORS.ACCENT, glow, 32)}${vignette(corner, 0.86)}</defs>
    <rect width="${L.W}" height="${L.H}" fill="${base}"/>
    ${points.map((_, i) => fill(L, `m${i}`)).join("")}
    ${fill(L, "lantern")}
    ${fill(L, "vig")}`,
  });
}

/** Artwork cover-cropped to the canvas. Portrait crops left; a centre crop keeps only the empty middle. */
function imageField({ file, ink, brightness, glowColor, glow, glowR, vig, vigStop }) {
  return (L, ctx) => ({
    ink,
    image: { file: typeof file === "function" ? file(ctx.device) : file, position: L.W > L.H ? "centre" : "left", brightness },
    svg: `<defs>${lantern(L, glowColor, glow, glowR, 0.35)}${vignette(vig, vigStop, 46, 76)}</defs>
    ${fill(L, "lantern")}
    ${fill(L, "vig")}`,
  });
}

export const FIELDS = {
  /** The app's own ambient backdrop, darkened, with the robot's CRT green behind the panel. */
  app: imageField({
    file: (device) => (device.canvas[0] > device.canvas[1] ? "assets/images/ambient-background.png" : "assets/images/ambient-background-portrait.png"),
    ink: DARK_INK,
    brightness: 0.72,
    glowColor: "#A3CB38",
    glow: 0.26,
    glowR: 80,
    vig: "#000104",
    vigStop: 0.5,
  }),

  /** The supplied film-reel artwork. Light ground, so the type inverts. */
  bg: imageField({ file: "applestore/bg.png", ink: LIGHT_INK, glowColor: "#FFFFFF", glow: 0.28, glowR: 34, vig: "#4A3200", vigStop: 0.38 }),

  /** Amber against deep blue: 162 degrees apart, gold's own complement family. */
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
    glow: 0.07,
  }),

  /** Warm-dominant with a single cool counterpoint low in the frame. */
  warm: meshField({
    base: "#0B0500",
    points: [
      { x: 32, y: 26, r: 64, c: "#5C3000", o: 0.95 },
      { x: 80, y: 78, r: 56, c: "#00263F", o: 0.8 },
      { x: 18, y: 86, r: 46, c: "#2A1400", o: 0.7 },
    ],
    glow: 0.08,
    corner: "#050200",
  }),

  /** Daylight: a light warm field. A dark panel separates on luminance alone here. */
  daylight: (L) => ({
    ink: LIGHT_INK,
    svg: `<defs>
      <linearGradient id="sky" x1="0.15" y1="0" x2="0.85" y2="1">
        <stop offset="0" stop-color="#F6EBD2"/>
        <stop offset="0.45" stop-color="#E8D9B6"/>
        <stop offset="1" stop-color="#CBB489"/>
      </linearGradient>
      ${lantern(L, "#FFF6DC", 0.95, 46, 0.24)}
      <radialGradient id="warmEdge" cx="86%" cy="88%" r="62%">
        <stop offset="0" stop-color="${COLORS.ACCENT}" stop-opacity="0.32"/>
        <stop offset="1" stop-color="${COLORS.ACCENT}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${L.W}" height="${L.H}" fill="url(#sky)"/>
    ${fill(L, "warmEdge")}
    ${fill(L, "lantern")}`,
  }),

  /** Duotone: a gold plate behind the type, black below. Loudest at thumbnail size. */
  duotone: (L) => ({
    ink: { ...LIGHT_INK, rule: COLORS.ON_ACCENT_WARM, shadow: "#000", shadowOpacity: 0.6, flat: true },
    panelStroke: 0.22,
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
