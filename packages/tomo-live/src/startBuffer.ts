import { LIVE_BUFFER_SECONDS } from "@keiver/tomo-engine";

/** The start buffers a channel steps through, in seconds: one step up per poor start. */
export const LIVE_START_STEPS = [LIVE_BUFFER_SECONDS, 6, 15] as const;
/** A stall this soon after the picture came up is a poor start; a play this long without one is a clean start. */
export const LIVE_POOR_START_WINDOW_MS = 60_000;

const stepFor = new Map<string, number>();

/** Seconds of output the channel's next session builds before the player is answered. */
export function liveStartBufferSeconds(channelId: string): number {
  return LIVE_START_STEPS[stepFor.get(channelId) ?? 0];
}

/**
 * A stall `playedMs` after the picture came up. Inside the window it steps the channel up and returns the
 * seconds to hold the picture for, the gap to the next step; null when it is no poor start or the top step is reached.
 */
export function noteLiveStall(channelId: string, playedMs: number): number | null {
  if (playedMs > LIVE_POOR_START_WINDOW_MS) return null;
  const step = stepFor.get(channelId) ?? 0;
  if (step >= LIVE_START_STEPS.length - 1) return null;
  stepFor.set(channelId, step + 1);
  return LIVE_START_STEPS[step + 1] - LIVE_START_STEPS[step];
}

/** A clean start steps the channel back down one. */
export function noteLiveCleanStart(channelId: string): void {
  const step = stepFor.get(channelId) ?? 0;
  if (step <= 1) stepFor.delete(channelId);
  else stepFor.set(channelId, step - 1);
}

export function resetLiveStartBuffersForTests(): void {
  stepFor.clear();
}
