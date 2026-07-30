/**
 * Shared application constants
 */

import { Platform, type PlatformIOSStatic } from "react-native";

/** True on iPad. `isPad` only exists on the iOS platform type, hence the cast. */
const IS_PAD = Platform.OS === "ios" && (Platform as PlatformIOSStatic).isPad;

// Cache settings
export const CACHE = {
  /** Default TTL for cached data (5 minutes) */
  DEFAULT_TTL_MS: 5 * 60 * 1000,
  /** TTL for search results — short, so typos and back-navigation reuse without going stale. */
  SEARCH_TTL_MS: 30 * 1000,
  /** TTL for the resume list — short, and explicitly invalidated on playback stop. */
  RESUME_TTL_MS: 30 * 1000,
  /** TTL for filter facets (genres/artists/years) — rarely change during a session. */
  FACET_TTL_MS: 5 * 60 * 1000,
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
  /** Columns for a portrait grid (TV / narrow phone / wide phone-family screens). */
  COLUMNS_PORTRAIT: { tv: 6, phone: 2, phoneWide: 5 },
  /** Columns for a landscape grid — wider cards, fewer columns. TV and tablets fit 4
   * per row in either orientation; phones cap at 2 (a third makes cards too small,
   * and at 2 the phone cards match the shelf). */
  COLUMNS_LANDSCAPE: { tv: 4, phone: 2, pad: 4 },
  /** Window width (pt) at which a phone-family screen uses the wide column counts
   * (landscape phones, tablets). */
  PHONE_WIDE_MIN_WIDTH: 600,
  /** Horizontal screen padding around library grids (TV / phone). Shared by the
   * grid and the Continue Watching shelf so their card widths stay in step. */
  SIDE_PADDING: { tv: 80, phone: 12 },
} as const;

export type SlotOrientation = "portrait" | "landscape";

/** Aspect ratio (w/h) for a slot orientation. */
export function slotRatio(orientation: SlotOrientation): number {
  return orientation === "landscape" ? GRID.LANDSCAPE_RATIO : GRID.PORTRAIT_RATIO;
}

/**
 * Column count for a slot orientation on the current platform. Landscape slots key
 * on the device class (tablet vs phone, fixed per device); portrait slots key on the
 * live window width so a rotated phone gets more poster columns instead of blowing
 * the narrow-portrait count up to viewport-filling cards.
 */
export function slotColumns(orientation: SlotOrientation, isTV: boolean, windowWidth?: number): number {
  if (orientation === "landscape") {
    if (isTV) return GRID.COLUMNS_LANDSCAPE.tv;
    return IS_PAD ? GRID.COLUMNS_LANDSCAPE.pad : GRID.COLUMNS_LANDSCAPE.phone;
  }
  if (isTV) return GRID.COLUMNS_PORTRAIT.tv;
  return windowWidth !== undefined && windowWidth >= GRID.PHONE_WIDE_MIN_WIDTH ? GRID.COLUMNS_PORTRAIT.phoneWide : GRID.COLUMNS_PORTRAIT.phone;
}

// Design system values
export const DESIGN = {
  /** Standard border radius for cards and grid items. 32 reads right on a 10-foot
   * TV card; on a ~180pt phone card it turns the card into a pill. */
  BORDER_RADIUS_CARD: Platform.isTV ? 32 : 16,
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
