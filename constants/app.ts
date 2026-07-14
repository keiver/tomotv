/**
 * Shared application constants
 */

// Cache settings
export const CACHE = {
  /** Default TTL for cached data (5 minutes) */
  DEFAULT_TTL_MS: 5 * 60 * 1000,
} as const;

// Library grid sizing. Each grid picks ONE slot shape from the folder's dominant
// orientation (portrait poster grid vs landscape thumbnail grid), with the
// column count tuned per shape. Cards inside still render their own image in its
// native orientation.
export const GRID = {
  /** Portrait poster slot (width / height). */
  PORTRAIT_RATIO: 2 / 3,
  /** Landscape thumbnail slot (width / height). */
  LANDSCAPE_RATIO: 16 / 9,
  /** Columns for a portrait grid (TV / phone). */
  COLUMNS_PORTRAIT: { tv: 6, phone: 3 },
  /** Columns for a landscape grid (TV / phone) — wider cards, fewer columns. */
  COLUMNS_LANDSCAPE: { tv: 4, phone: 2 },
} as const;

export type SlotOrientation = "portrait" | "landscape";

/** Aspect ratio (w/h) for a slot orientation. */
export function slotRatio(orientation: SlotOrientation): number {
  return orientation === "landscape" ? GRID.LANDSCAPE_RATIO : GRID.PORTRAIT_RATIO;
}

/** Column count for a slot orientation on the current platform. */
export function slotColumns(orientation: SlotOrientation, isTV: boolean): number {
  const cols = orientation === "landscape" ? GRID.COLUMNS_LANDSCAPE : GRID.COLUMNS_PORTRAIT;
  return isTV ? cols.tv : cols.phone;
}

// Design system values
export const DESIGN = {
  /** Standard border radius for cards and grid items */
  BORDER_RADIUS_CARD: 32,
  /** Border radius for medium elements (settings rows, etc) */
  BORDER_RADIUS_MEDIUM: 12,
  /** Standard border radius for buttons */
  BORDER_RADIUS_BUTTON: 10,
  /** Standard border radius for inputs and small elements */
  BORDER_RADIUS_SMALL: 8,
  /** Fully circular elements */
  BORDER_RADIUS_ROUND: 999,
} as const;

// Shared focus treatment for grid cards (video + folder items). The glow is a
// static shadow on the card wrapper — the wrapper must NOT have overflow:hidden
// or iOS clips the shadow (masksToBounds clips the layer's own shadow).
export const CARD_FOCUS = {
  /** Gold accent glow around the focused card (matches FocusableButton). Kept
   * dim and tight so it reads as a backlight, not a halo — the white border
   * does the identifying, the glow adds warmth. */
  GLOW_COLOR: "#FFC312",
  GLOW_OPACITY: 0.55,
  /** Glow spread (TV / phone). */
  GLOW_RADIUS: { tv: 7, phone: 4 },
  /** Android elevation for the focused card. */
  GLOW_ELEVATION: 12,
  /** Solid gold focused border: thickness + hue change over the resting border. */
  BORDER_COLOR_FOCUSED: "#FFC312",
  BORDER_WIDTH_FOCUSED: 4,
  /** Focused title bar: gold with deep warm-brown text (8.5:1) — pure black
   * vibrates against saturated gold; the brown reads as one material. The bar
   * works regardless of artwork, so focus never depends on the border being
   * visible against the poster. */
  TITLE_BG_FOCUSED: "#FFC312",
  TITLE_TEXT_FOCUSED: "#2B1F05",
  /** Resting border on every card. */
  BORDER_COLOR: "rgba(255, 255, 255, 0.15)",
  BORDER_WIDTH: 2,
} as const;
