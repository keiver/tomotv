export const MINUTE_MS = 60_000;
export const TICK_MINUTES = 30;
/** Programs loaded per fetch, and how far the window grows when the canvas nears its end. */
export const GUIDE_SPAN_MINUTES = 360;

/** The window opens on the half hour the current time falls in. */
export function guideWindowStart(nowMs: number): number {
  const tick = TICK_MINUTES * MINUTE_MS;
  // Floored in local time: a 45-minute offset floored in UTC opens on :15 or :45.
  const offset = -new Date(nowMs).getTimezoneOffset() * MINUTE_MS;
  return Math.floor((nowMs + offset) / tick) * tick - offset;
}
