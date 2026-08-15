/**
 * Shared application constants
 */

import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Marketing version of the binary that is actually running — this resolves to
 * CFBundleShortVersionString, not to whatever app.json currently says, so a device
 * holding an older build reports that older build. Build number is deliberately absent:
 * app.json pins it at "1", which says nothing true about an installed binary.
 */
export const APP_VERSION = Constants.expoConfig?.version ?? "";

/**
 * Every brand mark: the phone spine and masthead (components/library-grid.tsx) and the tvOS
 * spine (components/brand-corners.tsx). Name only on both. A spine is a mark in a margin, and
 * a build number is not what that space should spend itself on; the version rides the Settings
 * link below instead.
 */
export const BRAND_NAME = "Tomo TV";

/**
 * The Open Source link's label (components/settings/AboutSection.tsx), and the app's only
 * version display. The licenses behind it are this build's, so the version qualifies the
 * destination rather than just sharing a row with it.
 */
export const ABOUT_LABEL = APP_VERSION ? `Open Source · ${APP_VERSION}` : "Open Source";

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

/**
 * Height of a full-size interactive control: a FocusableButton, and any text
 * field meant to sit alongside one. Buttons take it as a floor (their padding
 * and text already land near it) and SunkenTextInput takes it as a fixed height,
 * so a field and a CTA on the same screen read as the same size of control.
 */
export const CONTROL_HEIGHT = Platform.isTV ? 82 : 56;

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
  /** Columns for a landscape grid — wider cards, fewer columns. */
  COLUMNS_LANDSCAPE: { tv: 4, phone: 2, phoneWide: 3 },
  /** Window width (pt) at which a phone-family screen uses the wide column counts
   * (landscape phones, tablets). */
  PHONE_WIDE_MIN_WIDTH: 600,
  /** Minimum horizontal screen padding around library grids (TV / phone). See
   * gridEdgePadding — this is a floor, not an addition to the safe-area inset. */
  SIDE_PADDING: { tv: 80, phone: 20 },
} as const;

/**
 * Horizontal edge padding for a library grid: the larger of the platform minimum and the
 * safe-area inset, NOT their sum.
 *
 * tvOS already reports an 80pt horizontal overscan inset, so adding SIDE_PADDING on top of it
 * pushed the grid 160pt off each edge and shrank every card to 400pt — noticeably narrower than
 * the Continue Watching shelf, which sized itself off the raw window width. Taking the max keeps
 * the grid flush with the safe area (440pt columns on a 1920pt screen) while still guaranteeing
 * the minimum on platforms that report no inset.
 */
export function gridEdgePadding(inset: number, isTV: boolean): number {
  return Math.max(inset, isTV ? GRID.SIDE_PADDING.tv : GRID.SIDE_PADDING.phone);
}

export type SlotOrientation = "portrait" | "landscape";

/** Aspect ratio (w/h) for a slot orientation. */
export function slotRatio(orientation: SlotOrientation): number {
  return orientation === "landscape" ? GRID.LANDSCAPE_RATIO : GRID.PORTRAIT_RATIO;
}

/**
 * Column count for a slot orientation on the current platform. Pass the live window
 * width on phone so a rotated phone (or a tablet) gets more columns instead of
 * blowing the narrow-portrait count up to viewport-filling cards.
 */
export function slotColumns(orientation: SlotOrientation, isTV: boolean, windowWidth?: number): number {
  const cols = orientation === "landscape" ? GRID.COLUMNS_LANDSCAPE : GRID.COLUMNS_PORTRAIT;
  if (isTV) return cols.tv;
  return windowWidth !== undefined && windowWidth >= GRID.PHONE_WIDE_MIN_WIDTH ? cols.phoneWide : cols.phone;
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
