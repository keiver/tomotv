import { CARD_SIZE_PICKS, type CardSize, GRID } from "@/constants/app";

/** A pinch, a key and the Appearance slider all land on this grid, so cards re-lay in steps rather than on every frame. */
export const CARD_ZOOM_STEP = 0.05;
/** One Command-plus or Command-minus. */
const KEY_FACTOR = 1.15;

/** The stored zoom as this window can show it: between GRID.CARD_ZOOM_MIN and the window's ceiling. */
export function clampCardZoom(zoom: number, ceiling: number): number {
  return Math.min(Math.max(zoom, GRID.CARD_ZOOM_MIN), Math.max(ceiling, GRID.CARD_ZOOM_MIN));
}

function snap(zoom: number, ceiling: number): number {
  return clampCardZoom(Math.round(clampCardZoom(zoom, ceiling) / CARD_ZOOM_STEP) * CARD_ZOOM_STEP, ceiling);
}

/** The zoom a pinch has reached: the zoom it started from times the fingers' scale. */
export function pinchedCardZoom(base: number, scale: number, ceiling: number): number {
  return snap(base * scale, ceiling);
}

/** One key press in or out from the current zoom. */
export function steppedCardZoom(current: number, direction: 1 | -1, ceiling: number): number {
  return snap(direction > 0 ? current * KEY_FACTOR : current / KEY_FACTOR, ceiling);
}

/** The TV pill to light: the largest step at or under the saved zoom. */
export function shownCardSize(saved: number, choices: readonly CardSize[]): CardSize {
  return choices.reduce((shown, size) => (size <= saved ? size : shown), choices[0]);
}

/** The picker's sizes for this window: the picks up to its ceiling, so every card drawn can be chosen. */
export function cardSizePicks(ceiling: number): number[] {
  return CARD_SIZE_PICKS.filter((size) => size <= ceiling + 1e-6);
}

/** The pick nearest the zoom the cards draw at, which a pinch may have left between picks. */
export function nearestCardSize(zoom: number, sizes: readonly number[]): number {
  return sizes.reduce((nearest, size) => (Math.abs(size - zoom) < Math.abs(nearest - zoom) ? size : nearest), sizes[0]);
}
