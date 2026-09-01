/**
 * The app's colour palette. Every value here was a hex literal repeated across
 * screens; nothing is new. Roles, not hues: two roles may share a value.
 */
export const COLORS = {
  /** Brand gold: fills, focus rings, progress, the tab tint. */
  ACCENT: "#FFC312",
  /** Gold under focus, a step lighter so the lift reads without a size change. */
  ACCENT_FOCUSED: "#FFD54F",
  /** Unwatched remainder of a progress bar, dim enough to sit under ACCENT. */
  ACCENT_DIM: "#B8891A",
  ACCENT_DIM_FOCUSED: "#C79A2E",
  /** Saturated gold for fills that carry no text. */
  ACCENT_DEEP: "#E3A900",
  /** Text and icons on a gold fill. */
  ON_ACCENT: "#000000",
  /** Deep warm brown on gold (8.5:1). Pure black vibrates against saturated gold. */
  ON_ACCENT_WARM: "#2B1F05",

  /** App canvas. */
  BACKGROUND: "#141414",
  /** Below the canvas: sheets, the ambient base. */
  BACKGROUND_DEEP: "#0D0D0F",
  /** Cards, inputs, chips. */
  SURFACE: "#2C2C2E",
  /** Wells: progress tracks, artwork placeholders. */
  SURFACE_SUNKEN: "#1C1C1E",
  SURFACE_RAISED: "#232326",
  SURFACE_NEUTRAL: "#3d3d3d",
  SURFACE_MUTED: "#48484A",
  /** Letterbox behind video, audio artwork and photos. */
  MEDIA_BACKGROUND: "#000000",

  TEXT_PRIMARY: "#FFFFFF",
  TEXT_BRIGHT: "#E5E5EA",
  TEXT_BODY: "#D1D1D6",
  TEXT_DIM: "#C4C4C4",
  TEXT_SECONDARY: "#98989D",
  TEXT_TERTIARY: "#8E8E93",
  TEXT_QUATERNARY: "#6E6E73",

  DESTRUCTIVE: "#FF3B30",
  /** Softer red for body copy, where full destructive red glares. */
  DESTRUCTIVE_SOFT: "#FF6961",
  /** Filled destructive surface: white sits at 3.6:1 on the plain red and 5.4:1 on this. */
  DESTRUCTIVE_DEEP: "#D70015",
  SUCCESS: "#34C759",
  /** Diagnostics log ink. Phosphor green on the sunken card, read as a terminal, not as UI. */
  TERMINAL_INK: "#00FF41",
  /** The same ink at rest, so a focused line in the log reads brighter than its neighbours. */
  TERMINAL_INK_DIM: "#2A9D4B",

  /** White focus border on a filled button. */
  BORDER_FOCUSED: "#FFFFFF",
  /** Resting card border as 8-digit ARGB: the native search view parses hex, not rgba(). */
  BORDER_RESTING_ARGB: "#26FFFFFF",

  SHADOW: "#000000",
  TEXT_SHADOW: "#201F1F",
} as const;
