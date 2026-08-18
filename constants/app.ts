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
  /** TTL for per-view item counts — the count walk can fan out on broken servers, so reuse long. */
  VIEW_COUNT_TTL_MS: 30 * 60 * 1000,
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
  COLUMNS_PORTRAIT: { tv: 6, phone: 3, phoneWide: 5 },
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

export type ArtworkSlotShape = "portrait" | "square" | "landscape";

/**
 * Snap artwork to the nearest card shape — poster, square (album art), or wide thumb — so a
 * mixed row shows every item's art cover-filled with only marginal cropping, never letterboxed.
 */
export function artworkSlotShape(aspect: number): ArtworkSlotShape {
  if (aspect < 0.85) return "portrait";
  if (aspect <= 1.25) return "square";
  return "landscape";
}

/** Aspect ratio (w/h) of a snapped card shape. */
const SLOT_SHAPE_RATIO: Record<ArtworkSlotShape, number> = {
  portrait: GRID.PORTRAIT_RATIO,
  square: 1,
  landscape: GRID.LANDSCAPE_RATIO,
};

export function artworkSlotRatio(aspect: number): number {
  return SLOT_SHAPE_RATIO[artworkSlotShape(aspect)];
}

/**
 * An ITEM's snapped card shape from its (untrusted) server-reported aspect. Missing or
 * garbage aspects land on square — the placeholder face is square art. The single source
 * of truth for mixed-shape surfaces: row packing, row heights and the cards themselves
 * must all derive from here or justified rows misalign.
 */
export function itemSlotShape(aspect: number | null | undefined): ArtworkSlotShape {
  return aspect != null && Number.isFinite(aspect) && aspect > 0 ? artworkSlotShape(aspect) : "square";
}

/** Aspect ratio (w/h) of an item's snapped card shape. */
export function itemSlotRatio(aspect: number | null | undefined): number {
  return SLOT_SHAPE_RATIO[itemSlotShape(aspect)];
}

/**
 * The ratio a CARD renders at: the item's snapped shape in fitArtwork surfaces, the host
 * grid's uniform slot otherwise. Shared by the card components so their rendered width can
 * never diverge from what the row packer allocated.
 */
export function cardSlotRatio(fitArtwork: boolean, aspect: number | null | undefined, orientation: SlotOrientation): number {
  return fitArtwork ? itemSlotRatio(aspect) : slotRatio(orientation);
}

/** Inner padding every mixed-shape row card carries (matches the card components' own). */
export function slotCardPadding(isTV: boolean): number {
  return isTV ? 16 : 6;
}

/**
 * Per-shape card heights for mixed rows (home shelves AND folder rows). A row renders at
 * the tallest shape it holds and every card in it matches that height.
 * TV (live-tuned): one converged height for every shape, the 4-per-screen wide anchor
 * scaled up 20% — between the wide anchor (too small for posters) and the full poster
 * anchor (billboards). Phone: per-shape, quantized to the container (see below), with the
 * wide card split by surface — a carousel peeks past the edge, a grid row must land whole.
 */
export interface SlotRowHeights {
  portrait: number;
  square: number;
  landscape: number;
}

export function slotRowHeights(windowWidth: number, insetLeft: number, insetRight: number, isTV: boolean, surface: "shelf" | "grid" = "shelf"): SlotRowHeights {
  const usable = windowWidth - gridEdgePadding(insetLeft, isTV) - gridEdgePadding(insetRight, isTV);
  const padding = slotCardPadding(isTV);
  if (isTV) {
    const landscapeAnchor = (usable / 4 - 2 * padding) / GRID.LANDSCAPE_RATIO + 2 * padding;
    const height = Math.round(landscapeAnchor * 1.2);
    return { portrait: height, square: height, landscape: height };
  }
  // Phone: each shape is QUANTIZED to the container — N full cards plus a half-card peek
  // fill the usable width exactly, so a resting row ends on a clean half card instead of an
  // arbitrary sliver at the device edge. Shelf densities match the Apple TV app's home:
  // 3.5 posters, 2.5 squares, 1.5 wide cards per screen (5 / 3.5 / 2.5 on wide screens).
  // Grids take a denser wide card (2 per row, 3 on wide screens): the shelf's 1.5 nominal
  // justifies into one-per-row billboards inside a folder.
  const wide = windowWidth >= GRID.PHONE_WIDE_MIN_WIDTH;
  const shapeHeight = (perScreen: number, ratio: number) => Math.round((usable / perScreen - 2 * padding) / ratio + 2 * padding);
  const landscapePerScreen = surface === "grid" ? (wide ? 3 : 2) : wide ? 2.5 : 1.5;
  return {
    portrait: shapeHeight(wide ? 5 : 3.5, GRID.PORTRAIT_RATIO),
    square: shapeHeight(wide ? 3.5 : 2.5, 1),
    landscape: shapeHeight(landscapePerScreen, GRID.LANDSCAPE_RATIO),
  };
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
