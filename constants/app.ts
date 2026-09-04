/**
 * Shared application constants
 */

import { COLORS } from "./colors";
import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Marketing version of the binary that is actually running — this resolves to
 * CFBundleShortVersionString, not to whatever app.json currently says, so a device
 * holding an older build reports that older build.
 */
export const APP_VERSION = Constants.expoConfig?.version ?? "";

/** Build number from the same embedded config, so it too describes the running binary. */
export const APP_BUILD_NUMBER = Constants.expoConfig?.ios?.buildNumber ?? "";

/**
 * Every brand mark: the phone spine and masthead (components/library-grid.tsx) and the tvOS
 * spine (components/brand-corners.tsx). Name only on both. A spine is a mark in a margin, and
 * a build number is not what that space should spend itself on.
 */
export const BRAND_NAME = "Tomo TV";

/** Version and build of the running binary, the build in parentheses when there is one. */
export const APP_BUILD_LABEL = `${APP_VERSION}${APP_BUILD_NUMBER ? ` (${APP_BUILD_NUMBER})` : ""}`;

/** The diagnostics log head. */
export const APP_VERSION_LABEL = `${BRAND_NAME} ${APP_BUILD_LABEL}`;

/** The Open Source page's second pill, under the build. */
export const APP_ABOUT_LINE = `${BRAND_NAME}, a Jellyfin Client`;

/**
 * Title of the libraries root. Its header is hidden, so this only ever surfaces as the back label
 * a pushed folder shows (app/(tabs)/(library)/_layout.tsx and [folderId].tsx both name it).
 */
export const LIBRARY_ROOT_TITLE = "Home";

/** The Open Source row's label (components/settings/AboutSection.tsx). */
export const ABOUT_LABEL = "Open Source";

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
  /** Screen SHORT side (pt) at which a phone-family device uses the wide column counts.
   * The short side, not the current width: rotating a device must not change its class. */
  PHONE_WIDE_MIN_WIDTH: 600,
  /** Portrait window width the card densities below are tuned against (iPhone 15). */
  DENSITY_REFERENCE_WIDTH: 393,
  /** Density follows the device's portrait width to this power, so card size grows as
   * width^(1 - this). At 1 every device shares one card size, at 0 the card swells with the screen. */
  DENSITY_EXPONENT: 0.75,
  /** Cards per screen at the reference width. A grid takes a denser wide card: the shelf's
   * peeking nominal justifies into one-per-row billboards inside a folder. */
  DENSITY_PER_SCREEN: { portrait: 3.5, square: 2.5, landscapeShelf: 1.5, landscapeGrid: 2 },
  /** Shelves the home screen fills a viewport with, and the height that is not shelf
   * (status bar, tab bar, screen padding). A viewport tall enough to hold more than this
   * many width-derived shelves grows its rows instead of trailing off into a void. */
  SHELVES_PER_SCREEN: 4,

  /** Ceiling on that growth: the widest card a row can hold stays under this share of the
   * usable width, so filling a tall screen never brings back the landscape billboard. */
  MAX_CARD_WIDTH_SHARE: 0.5,
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

/**
 * Shelf spacing per device class: the heading's type, the gap under it, and the gap to the
 * next shelf. slotRowHeights sizes rows against this same block, so row height and the air
 * around it can never drift apart.
 */
export const SHELF_SPACING = {
  // chrome is the height a shelf never gets: status bar, screen padding, and the tab bar where
  // it sits at the bottom. iPadOS puts the bar at the TOP, so a tablet clears far less.
  phone: { headingSize: 13, headingLine: 16, headingGap: 7, rowGap: 10, chrome: 180 },
  tablet: { headingSize: 16, headingLine: 20, headingGap: 14, rowGap: 22, chrome: 147 },
  tv: { headingSize: 26, headingLine: 30, headingGap: 14, rowGap: 30, chrome: 250 },
} as const;

export type ShelfSpacing = (typeof SHELF_SPACING)[keyof typeof SHELF_SPACING];

/** Tablet from the SHORT side, so rotating a device never re-spaces its shelves. */
export function shelfSpacing(isTV: boolean, windowWidth: number, windowHeight: number): ShelfSpacing {
  if (isTV) return SHELF_SPACING.tv;
  const shortSide = Number.isFinite(windowHeight) && windowHeight > 0 ? Math.min(windowWidth, windowHeight) : windowWidth;
  return shortSide >= GRID.PHONE_WIDE_MIN_WIDTH ? SHELF_SPACING.tablet : SHELF_SPACING.phone;
}

/** Vertical space a shelf spends on anything that is not its cards. */
export function shelfHeadingBlock(spacing: ShelfSpacing): number {
  return spacing.headingLine + spacing.headingGap + spacing.rowGap;
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
  return isTV ? 16 : 8;
}

/**
 * Where content's visible edge sits on a phone, one line for every tab. A grid lands on it as
 * gridEdgePadding plus the card's own padding; a list surface takes the whole value.
 */
export const CONTENT_EDGE_PHONE = GRID.SIDE_PADDING.phone + slotCardPadding(false);

/**
 * Per-shape card heights for mixed rows (home shelves AND folder rows). A row renders at
 * the tallest shape it holds and every card in it matches that height.
 * TV (live-tuned): one converged height for every shape, the 4-per-screen wide anchor
 * scaled up 20% — between the wide anchor (too small for posters) and the full poster
 * anchor (billboards). Phone family: per-shape, from the density model below.
 */
export interface SlotRowHeights {
  portrait: number;
  square: number;
  landscape: number;
}

export function slotRowHeights(windowWidth: number, windowHeight: number, insetLeft: number, insetRight: number, isTV: boolean, surface: "shelf" | "grid" = "shelf"): SlotRowHeights {
  const usable = windowWidth - gridEdgePadding(insetLeft, isTV) - gridEdgePadding(insetRight, isTV);
  const padding = slotCardPadding(isTV);
  if (isTV) {
    const landscapeAnchor = (usable / 4 - 2 * padding) / GRID.LANDSCAPE_RATIO + 2 * padding;
    const height = Math.round(landscapeAnchor * 1.2);
    return { portrait: height, square: height, landscape: height };
  }
  // Width buys density, never size: the device factor is sub-linear, the rotation factor
  // linear, so a card holds its size through a rotation and the row just carries more.
  // useWindowDimensions reports 0 mid-layout, which would send density to infinity.
  const shortSide = Number.isFinite(windowHeight) && windowHeight > 0 ? Math.min(windowWidth, windowHeight) : windowWidth;
  // Platform minimum, never the live inset: a landscape phone's inset dwarfs its own portrait's.
  const portraitUsable = Math.max(1, shortSide - 2 * GRID.SIDE_PADDING.phone);
  const referenceUsable = GRID.DENSITY_REFERENCE_WIDTH - 2 * GRID.SIDE_PADDING.phone;
  const density = Math.pow(portraitUsable / referenceUsable, GRID.DENSITY_EXPONENT) * (usable / portraitUsable);
  // Half-card steps; whole ones overshoot at low counts. A shelf steps off a whole result so a
  // resting carousel ends mid-card and reads as scrollable, taking the NEARER half, stepping
  // always up shrank a 3.84 poster count to 4.5 and every poster with it. A grid justifies its
  // own rows and needs no peek.
  const perScreen = (base: number) => {
    const raw = base * density;
    const quantized = Math.max(1.5, Math.round(raw * 2) / 2);
    if (surface === "grid" || !Number.isInteger(quantized)) return quantized;
    const down = quantized - 0.5;
    return down >= 1.5 && raw - down <= quantized + 0.5 - raw ? down : quantized + 0.5;
  };
  const shapeHeight = (base: number, ratio: number) => (usable / perScreen(base) - 2 * padding) / ratio + 2 * padding;
  const per = GRID.DENSITY_PER_SCREEN;
  const rows = {
    portrait: shapeHeight(per.portrait, GRID.PORTRAIT_RATIO),
    square: shapeHeight(per.square, 1),
    landscape: shapeHeight(surface === "grid" ? per.landscapeGrid : per.landscapeShelf, GRID.LANDSCAPE_RATIO),
  };
  const scale = surface === "grid" ? 1 : shelfFillScale(rows, usable, padding, windowWidth, windowHeight);
  return { portrait: Math.round(rows.portrait * scale), square: Math.round(rows.square * scale), landscape: Math.round(rows.landscape * scale) };
}

/**
 * Grow-only correction for a viewport with more height than the width-derived rows can fill.
 * Four shelves across a 13-inch iPad in portrait left 30% of the screen empty at the
 * width-derived size.
 *
 * Home shelves only, by choice rather than because they are the only surface that can
 * underfill: a short folder grid underfills a tall screen too (twelve episodes on a 13-inch
 * iPad leave roughly half of it empty). Home is always the same four shelves, so growing them
 * is stable, while a grid's card size would then track its folder's item count and every card
 * would resize as you navigated between libraries. The grid keeps one card size instead and
 * accepts the empty space.
 */
function shelfFillScale(rows: SlotRowHeights, usable: number, padding: number, windowWidth: number, windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return 1;
  const tallest = Math.max(rows.portrait, rows.square, rows.landscape);
  if (tallest <= 0) return 1;
  const spacing = shelfSpacing(false, windowWidth, windowHeight);
  const content = Math.max(0, windowHeight - spacing.chrome);
  // Solve for the height that actually lands the stack on the bottom edge. Libraries is an
  // all-wide shelf and renders shorter than the poster rows, so counting four equal shelves
  // left a whole card's worth of screen unclaimed.
  const units = GRID.SHELVES_PER_SCREEN - 1 + rows.landscape / tallest;
  const target = (content - GRID.SHELVES_PER_SCREEN * shelfHeadingBlock(spacing)) / units;
  // A row renders every card at its tallest shape, so the wide card is what the ceiling binds.
  const ceiling = (GRID.MAX_CARD_WIDTH_SHARE * usable - 2 * padding) / GRID.LANDSCAPE_RATIO + 2 * padding;
  return Math.min(Math.max(1, target / tallest), Math.max(1, ceiling / tallest));
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
  GLOW_COLOR: COLORS.ACCENT,
  GLOW_OPACITY: 0.55,
  /** Glow spread (TV / phone). */
  GLOW_RADIUS: { tv: 7, phone: 4 },
  /** Android elevation for the focused card. */
  GLOW_ELEVATION: 12,
  /** Solid gold focused border: thickness + hue change over the resting border. */
  BORDER_COLOR_FOCUSED: COLORS.ACCENT,
  BORDER_WIDTH_FOCUSED: 4,
  /** Focused title bar: gold with deep warm-brown text (8.5:1) — pure black
   * vibrates against saturated gold; the brown reads as one material. The bar
   * works regardless of artwork, so focus never depends on the border being
   * visible against the poster. */
  TITLE_BG_FOCUSED: COLORS.ACCENT,
  TITLE_TEXT_FOCUSED: COLORS.ON_ACCENT_WARM,
  /** Resting border on every card. */
  BORDER_COLOR: "rgba(255, 255, 255, 0.15)",
  BORDER_WIDTH: 2,
} as const;

// Resting depth shadow under every card, lifting it off the ambient canvas. Dark-theme
// shadows need more density than light-theme ones to register at all, and they stay
// tight so they read as contact shadow, not murk. Cheap on iOS only while the card
// keeps an opaque background (the shadow derives from the rounded rect); the focused
// state overrides every one of these props with the gold glow.
export const CARD_DEPTH = {
  SHADOW_COLOR: COLORS.SHADOW,
  SHADOW_OPACITY: 0.55,
  SHADOW_OFFSET: { tv: { width: 0, height: 8 }, phone: { width: 0, height: 3 } },
  SHADOW_RADIUS: { tv: 16, phone: 8 },
  /** Android elevation for the resting card (below GLOW_ELEVATION so focus still lifts). */
  ELEVATION: 6,
} as const;
