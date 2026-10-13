/**
 * Themes: one colour per theme, from which the whole app takes its accent (cards, controls, focus
 * fills, tints). Every shade the app draws the accent in is derived here. The Tomo brand marks keep
 * the brand gold whatever the theme.
 */
import { COLORS } from "@/constants/colors";
import { bestInk, contrastRatio, hexToHsb, hsbToHex, normalizeHex } from "@/utils/color";

export interface CardTheme {
  id: string;
  /** Empty on a built-in: the screen names it from the catalogue, in the viewer's language. */
  name: string;
  /** "#RRGGBB". */
  accent: string;
}

/** The accent family, the roles constants/colors.ts gives the gold (ACCENT, ACCENT_FOCUSED, ...). */
export interface CardPalette {
  accent: string;
  /** A step lighter, so the lift under focus reads without a size change. */
  accentFocused: string;
  /** The unwatched remainder of a progress bar, dim enough to sit under the accent. */
  accentDim: string;
  accentDimFocused: string;
  /** Saturated, for fills that carry no text. */
  accentDeep: string;
  /** Text and glyphs on an accent fill: black or white, whichever reads better. */
  onAccent: string;
  /** The warm brown on an accent fill (white on a dark accent), where pure black vibrates. */
  ink: string;
  /** The ambient canvas light: the accent as a pale veil. */
  glow: string;
}

/** The baked canvas's own barely-cool white (scripts/generate-ambient-background.py WHITE). */
export const NEUTRAL_GLOW = "#DEE4F0";

/** The brand gold's family exactly as constants/colors.ts has always drawn it; its canvas stays the neutral light. */
const GOLD_PALETTE: CardPalette = {
  accent: COLORS.ACCENT,
  accentFocused: COLORS.ACCENT_FOCUSED,
  accentDim: COLORS.ACCENT_DIM,
  accentDimFocused: COLORS.ACCENT_DIM_FOCUSED,
  accentDeep: COLORS.ACCENT_DEEP,
  onAccent: COLORS.ON_ACCENT,
  ink: COLORS.ON_ACCENT_WARM,
  glow: NEUTRAL_GLOW,
};

/**
 * Any other accent's family, at the gold's own ratios in hue, saturation and brightness (measured
 * from its tokens): focused 0.74 saturation, dim 0.92 / 0.72, dim focused 0.83 / 0.78, deep 1.08 / 0.89.
 * Focused also lifts brightness for an accent short of full.
 */
export function derivePalette(accent: string): CardPalette {
  const { h, s, b } = hexToHsb(accent);
  return {
    accent,
    accentFocused: hsbToHex({ h, s: s * 0.74, b: b + (1 - b) * 0.4 }),
    accentDim: hsbToHex({ h, s: s * 0.925, b: b * 0.722 }),
    accentDimFocused: hsbToHex({ h, s: s * 0.828, b: b * 0.78 }),
    accentDeep: hsbToHex({ h, s: Math.min(1, s * 1.076), b: b * 0.89 }),
    onAccent: bestInk(accent, [COLORS.ON_ACCENT, COLORS.TEXT_PRIMARY]),
    ink: bestInk(accent, [COLORS.ON_ACCENT_WARM, COLORS.TEXT_PRIMARY]),
    // Pale and near-bright like the neutral light, so the canvas whispers the hue instead of glowing it.
    glow: hsbToHex({ h, s: Math.min(0.45, s * 0.45), b: 0.94 }),
  };
}

export const BUILT_IN_THEMES: readonly CardTheme[] = [
  { id: "gold", name: "", accent: COLORS.ACCENT },
  { id: "blue", name: "", accent: "#4F99FF" },
  { id: "green", name: "", accent: "#2BD96B" },
  { id: "purple", name: "", accent: "#A97AFF" },
];

export const DEFAULT_CARD_THEME: CardTheme = BUILT_IN_THEMES[0];

const palettes = new Map<string, CardPalette>();
/** The editor's sliders mint a colour per step; past this many the cache starts over. */
const PALETTE_CACHE_LIMIT = 64;

/**
 * One object per accent, shared by every surface, so the colour math runs once and the identity stays
 * stable (themed stylesheets cache on it). The gold is the brand's own tokens, untouched.
 */
export function cardPalette(accent: string): CardPalette {
  if (accent === COLORS.ACCENT) return GOLD_PALETTE;
  const cached = palettes.get(accent);
  if (cached) return cached;
  if (palettes.size >= PALETTE_CACHE_LIMIT) palettes.clear();
  const palette = derivePalette(accent);
  palettes.set(accent, palette);
  return palette;
}

/** Below 3:1 on the canvas a focus ring stops reading as one (WCAG 1.4.11). */
export function isLowContrast(accent: string): boolean {
  return contrastRatio(accent, COLORS.BACKGROUND) < 3;
}

/** A theme from storage or the server, or null when any field is missing or malformed. */
export function parseCardTheme(raw: unknown): CardTheme | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, name, accent } = raw as Record<string, unknown>;
  const hex = typeof accent === "string" ? normalizeHex(accent) : null;
  if (typeof id !== "string" || !id || typeof name !== "string" || !hex) return null;
  return { id, name, accent: hex };
}

export function newThemeId(now: number = Date.now()): string {
  return `t${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * What a save writes, or null when there is nothing to save: a theme needs a name. A saved theme keeps
 * its id, and its name when the prompt comes back empty; a new one takes `freshId`.
 */
export function themeToSave(opened: { id?: string; name?: string }, typedName: string, accent: string, freshId: string): CardTheme | null {
  const name = typedName.trim() || (opened.name ?? "").trim();
  if (!name) return null;
  return { id: opened.id || freshId, name, accent };
}
