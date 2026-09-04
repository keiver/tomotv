/**
 * Session cache of in-session resume-position changes, the played-state delta map's twin:
 * a write that moves or clears an item's resume point records the ticks the server now
 * holds, so browse cards repaint their progress bar without a refetch.
 */
const resumeOverrides = new Map<string, number>();

export function getResumeOverrides(): Map<string, number> {
  return resumeOverrides;
}

/** Record the resume ticks the server holds after a write (0 once cleared). */
export function markResumePosition(id: string, positionTicks: number): void {
  resumeOverrides.set(id, positionTicks);
}

/** Drop everything (e.g. after auth changes) so no stale override leaks across users. */
export function clearResumeCache(): void {
  resumeOverrides.clear();
}
