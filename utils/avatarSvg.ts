/**
 * A generated avatar for a person with no picture: two flat discs sliding across a dark ground,
 * every colour and offset taken from a hash of the seed, so a name always draws the same face
 * and two names rarely draw alike. Returned as an SVG data URI for expo-image.
 */

/** The Flat UI palette: the two darks are grounds, the rest inks. Clouds is out, it reads as an empty disc. */
const GROUNDS = ["#34495E", "#2C3E50"];
const INKS = [
  "#1ABC9C",
  "#16A085",
  "#2ECC71",
  "#27AE60",
  "#3498DB",
  "#2980B9",
  "#9B59B6",
  "#8E44AD",
  "#F1C40F",
  "#F39C12",
  "#E67E22",
  "#D35400",
  "#E74C3C",
  "#C0392B",
  "#BDC3C7",
  "#95A5A6",
  "#7F8C8D",
];

const SIZE = 100;

/** FNV-1a: cheap, stable across platforms, spreads short names well. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** xorshift32 off the hash: as many draws as the face needs. */
function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

export interface AvatarFace {
  /** Ground, bloom and glow, in that order. */
  palette: [string, string, string];
  /** The large disc, drifting off one edge. */
  bloom: { cx: number; cy: number; r: number };
  /** The small disc, off the opposite corner. */
  glow: { cx: number; cy: number; r: number };
}

/** The face for `seed`, in a `SIZE`-unit square. */
export function avatarFace(seed: string): AvatarFace {
  const next = rng(hash(seed.trim().toLowerCase()));
  const inks = [...INKS];
  const draw = () => inks.splice(Math.floor(next() * inks.length), 1)[0];
  const ground = GROUNDS[Math.floor(next() * GROUNDS.length)];
  const bloomInk = draw();
  const glowInk = draw();
  const bx = 20 + next() * 60;
  const by = 55 + next() * 45;
  const gx = SIZE - bx + (next() - 0.5) * 30;
  const gy = 20 + next() * 30;
  return {
    palette: [ground, bloomInk, glowInk],
    bloom: { cx: round(bx), cy: round(by), r: 46 },
    glow: { cx: round(gx), cy: round(gy), r: 22 },
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The SVG markup for `seed`. */
export function avatarSvg(seed: string): string {
  const { palette, bloom, glow } = avatarFace(seed);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" fill="${palette[0]}"/>` +
    `<circle cx="${bloom.cx}" cy="${bloom.cy}" r="${bloom.r}" fill="${palette[1]}"/>` +
    `<circle cx="${glow.cx}" cy="${glow.cy}" r="${glow.r}" fill="${palette[2]}"/>` +
    `</svg>`
  );
}

/** The avatar as a data URI, the form expo-image takes. */
export function avatarSvgDataUri(seed: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(seed))}`;
}
