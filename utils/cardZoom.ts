import { CARD_SIZES, type CardSize, GRID } from "@/constants/app";

/** A pinch and a key both land on this grid, so cards re-lay in steps rather than on every frame. */
const ZOOM_STEP = 0.05;
/** One Command-plus or Command-minus. */
const KEY_FACTOR = 1.15;

/** The stored zoom as this window can show it: between GRID.CARD_ZOOM_MIN and the window's ceiling. */
export function clampCardZoom(zoom: number, ceiling: number): number {
  return Math.min(Math.max(zoom, GRID.CARD_ZOOM_MIN), Math.max(ceiling, GRID.CARD_ZOOM_MIN));
}

function snap(zoom: number, ceiling: number): number {
  return clampCardZoom(Math.round(clampCardZoom(zoom, ceiling) / ZOOM_STEP) * ZOOM_STEP, ceiling);
}

/** The zoom a pinch has reached: the zoom it started from times the fingers' scale. */
export function pinchedCardZoom(base: number, scale: number, ceiling: number): number {
  return snap(base * scale, ceiling);
}

/** One key press in or out from the current zoom. */
export function steppedCardZoom(current: number, direction: 1 | -1, ceiling: number): number {
  return snap(direction > 0 ? current * KEY_FACTOR : current / KEY_FACTOR, ceiling);
}

/** The saved sizes Settings offers: every one on TV, elsewhere those this window can show. */
export function cardSizeChoices(ceiling: number, isTV: boolean): CardSize[] {
  return CARD_SIZES.filter((size) => isTV || size <= ceiling + 1e-6);
}

/** The offered size the stepper highlights: the largest at or under the saved zoom, which a pinch may have left between steps. */
export function shownCardSize(saved: number, choices: readonly CardSize[]): CardSize {
  return choices.reduce((shown, size) => (size <= saved ? size : shown), choices[0]);
}
