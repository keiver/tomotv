/** Waits before each reopen of a dropped channel, the last one repeating for as long as it stays down. */
export const LIVE_REOPEN_DELAYS_MS = [500, 1000, 2000, 4000, 5000];
/** Played this long without a drop, a channel's next drop counts as its first again. */
export const LIVE_RECOVERY_RESET_MS = 60_000;

export interface LiveRecoveryInput {
  /** Reopens since the channel last played LIVE_RECOVERY_RESET_MS without a drop (liveReopenCount). */
  attempts: number;
  /** The channel cannot play however often it is opened: refused credentials, DRM, gone from the origin. */
  permanent: boolean;
}

export type LiveRecoveryDecision = { reopen: true; delayMs: number } | { reopen: false };

/** A dropped live channel opens again, after a growing wait, for as long as the viewer stays on it. */
export function planLiveRecovery(input: LiveRecoveryInput): LiveRecoveryDecision {
  if (input.permanent) return { reopen: false };
  const step = Math.max(0, Math.min(Math.floor(input.attempts), LIVE_REOPEN_DELAYS_MS.length - 1));
  return { reopen: true, delayMs: LIVE_REOPEN_DELAYS_MS[step] };
}

/** The attempt count a new drop starts from: back to zero once the channel played a stretch without one. */
export function liveReopenCount(previous: number, playedMsSinceLastDrop: number): number {
  return playedMsSinceLastDrop >= LIVE_RECOVERY_RESET_MS ? 0 : previous;
}

/**
 * An engine failure that no reopen fixes: the engine itself gave the input up after repeated
 * permanent refusals, or the origin refused every path to the channel or carries DRM.
 */
export function isPermanentLiveFailure(message: string): boolean {
  return message.includes("live input gone:") || message.includes("origin refused") || message.includes("DRM protected");
}
