/**
 * Device shells, traced from keiver.dev's Tv/PhoneBody, IPadBody and TvBody.
 *
 * The screen is a real hole in a compound path, so the capture is drawn behind
 * the shell and shows through it: hardware (Dynamic Island, antenna bands,
 * buttons) paints over the screenshot, and the corners stay the shell's own.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "frames");

/** Aperture is in viewBox units; both numbers must move together if a shell is retraced. */
export const FRAMES = {
  phone: { viewBox: [0, 0, 431, 884], aperture: [19, 16, 393, 852], screenRadius: 36 },
  ipad: { viewBox: [0, 0, 558, 724], aperture: [21, 18, 516, 688], screenRadius: 14 },
  tv: { viewBox: [116, 116, 1671.71654, 1004.80615], aperture: [145.52, 147.2, 1612.68, 907.13], screenRadius: 0 },
  // In points, so both screens share one scale. Screen holes are Apple's iPhone Duo framebuffer
  // masks; `corners` (top left, top right, bottom right, bottom left) masks the capture to the same curve.
  "duo-outer": { viewBox: [0, 0, 504, 716], aperture: [19, 19, 466, 678], screenRadius: 10.256, corners: [10.256, 75.635, 75.635, 10.256] },
  "duo-inner": { viewBox: [0, 0, 989, 707], aperture: [19, 19, 951, 669], screenRadius: 68.49, corners: [68.49, 68.49, 68.49, 68.49] },
};

/** Apple's continuous corner, read from the iPhone Duo masks: three cubics per corner, in units of its radius. */
const CORNER = [
  [0.3477, 0],
  [0.4738, 0.0362],
  [0.6009, 0.1042],
  [0.7281, 0.1763],
  [0.8278, 0.272],
  [0.8958, 0.399],
  [0.9638, 0.5262],
  [1, 0.6523],
  [1, 1],
];

/** A rectangle with continuous corners, radii clockwise from the top left, as SVG path data. */
export function cornerPath(x, y, w, h, [tl, tr, br, bl]) {
  const f = (n) => +n.toFixed(3);
  const corner = (map) => {
    const p = CORNER.map(map).map(([px, py]) => `${f(px)} ${f(py)}`);
    return `C${p[0]} ${p[1]} ${p[2]}C${p[3]} ${p[4]} ${p[5]}C${p[6]} ${p[7]} ${p[8]}`;
  };
  return [
    `M${f(x + tl)} ${f(y)}H${f(x + w - tr)}`,
    corner(([u, v]) => [x + w - tr + u * tr, y + v * tr]),
    `V${f(y + h - br)}`,
    corner(([u, v]) => [x + w - v * br, y + h - br + u * br]),
    `H${f(x + bl)}`,
    corner(([u, v]) => [x + bl - u * bl, y + h - v * bl]),
    `V${f(y + tl)}`,
    corner(([u, v]) => [x + v * tl, y + tl - u * tl]),
    "Z",
  ].join("");
}

const cache = new Map();

/** The shell's markup with its own <svg> wrapper stripped, ready to nest in a scene. */
export function frameBody(name) {
  if (!cache.has(name)) {
    const svg = fs.readFileSync(path.join(DIR, `${name}.svg`), "utf8");
    cache.set(
      name,
      svg
        .replace(/^[\s\S]*?<svg[^>]*>/, "")
        .replace(/<\/svg>\s*$/, "")
        .trim(),
    );
  }
  return cache.get(name);
}

/**
 * Place a shell on the canvas: where its aperture lands, and the transform that
 * puts the shell's viewBox there. Width drives it; height follows the shell.
 */
export function placeFrame(name, x, y, width) {
  const f = FRAMES[name];
  const [vx, vy, vw, vh] = f.viewBox;
  const [ax, ay, aw, ah] = f.aperture;
  const scale = width / vw;

  return {
    scale,
    height: vh * scale,
    transform: `translate(${x} ${y}) scale(${scale}) translate(${-vx} ${-vy})`,
    screen: {
      x: x + (ax - vx) * scale,
      y: y + (ay - vy) * scale,
      width: aw * scale,
      height: ah * scale,
      radius: f.screenRadius * scale,
      corners: f.corners?.map((r) => r * scale),
    },
  };
}
