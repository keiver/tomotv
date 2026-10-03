import type { MediaSegmentWindow } from "@/services/jellyfinApi";

/** A landing this close to a window's end needs no seek. */
const END_SLACK_SECONDS = 0.5;
/** A progress step longer than this is a seek (AVKit's scrubber included), not playback. */
const MAX_PLAY_STEP_SECONDS = 2;

/**
 * Where to seek when playback runs from `previous` into one of `windows`, else null.
 * Only playing across a window's start counts, so a seek or a resume that lands inside one plays it.
 */
export function segmentSkipTarget(windows: readonly MediaSegmentWindow[] | undefined, previous: number, current: number): number | null {
  if (!windows || current <= previous || current - previous > MAX_PLAY_STEP_SECONDS) return null;
  const hit = windows.find((window) => previous < window.startSeconds && current >= window.startSeconds && current < window.endSeconds - END_SLACK_SECONDS);
  return hit ? hit.endSeconds : null;
}
