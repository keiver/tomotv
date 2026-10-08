/** Colour math for themes: "#RRGGBB" strings, hue/saturation/brightness, WCAG contrast. */

export interface Hsb {
  /** 0 to 360. */
  h: number;
  /** 0 to 1. */
  s: number;
  /** 0 to 1. */
  b: number;
}

const HEX = /^#?([0-9a-f]{6})$/i;

/** "#RRGGBB" in upper case, or null for anything else ("ffc312" and "#ffc312" both read). */
export function normalizeHex(input: string): string | null {
  const match = HEX.exec(input.trim());
  return match ? `#${match[1].toUpperCase()}` : null;
}

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(r: number, g: number, b: number): string {
  const digits = [r, g, b].map((c) =>
    Math.round(Math.min(Math.max(c, 0), 255))
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${digits.join("").toUpperCase()}`;
}

export function hsbToHex({ h, s, b }: Hsb): string {
  const hue = (((h % 360) + 360) % 360) / 60;
  const chroma = b * s;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const [r, g, bl] = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const m = b - chroma;
  return toHex((r + m) * 255, (g + m) * 255, (bl + m) * 255);
}

export function hexToHsb(hex: string): Hsb {
  const [r, g, b] = channels(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h, s: max === 0 ? 0 : delta / max, b: max };
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour with the higher contrast against `fill`; the first wins a tie. */
export function bestInk(fill: string, inks: readonly string[]): string {
  return inks.reduce((best, ink) => (contrastRatio(fill, ink) > contrastRatio(fill, best) ? ink : best));
}

/** "rgba(r, g, b, alpha)" from "#RRGGBB": an accent at a tint's opacity. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
