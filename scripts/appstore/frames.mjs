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
};

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
  const scale = width / vw;
  const [ax, ay, aw, ah] = f.aperture;
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
    },
  };
}
