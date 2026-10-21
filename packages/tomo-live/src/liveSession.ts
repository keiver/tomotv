/**
 * A live session watched for its whole life, not only its start: the engine's in-session reopens
 * and the failure that ends it, with what the app should do about that failure.
 */
import { subscribeEngineFailure, subscribeEngineLive, type EngineLiveEvent } from "@keiver/tomo-engine";

import { isPermanentLiveFailure, liveReopenCount, planLiveRecovery, type LiveRecoveryDecision } from "./liveRecovery";

export interface LiveSessionWatch {
  /** The engine lost the input and is opening it again in place; the player rides its buffer meanwhile. */
  onReopening?: (event: EngineLiveEvent) => void;
  /** The input is back in the same session. */
  onReopened?: (event: EngineLiveEvent) => void;
  /**
   * The session ended. `decision` says whether to start the channel again (after `delayMs`) or to
   * stop: a channel is never handed anywhere else.
   */
  onEnded?: (message: string, decision: LiveRecoveryDecision) => void;
}

/** Drops counted across the sessions of one channel play, reset by a stretch of good playback. */
export class LiveDropCounter {
  private attempts = 0;
  private lastDropAt: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** The attempt this drop is, counting from zero after LIVE_RECOVERY_RESET_MS of play without one. */
  drop(): number {
    const now = this.now();
    this.attempts = this.lastDropAt === null ? 0 : liveReopenCount(this.attempts + 1, now - this.lastDropAt);
    this.lastDropAt = now;
    return this.attempts;
  }

  reset(): void {
    this.attempts = 0;
    this.lastDropAt = null;
  }
}

/** Watches one session until the returned function runs. `drops` carries the count across the channel's sessions. */
export function watchLiveSession(token: string, drops: LiveDropCounter, watch: LiveSessionWatch): () => void {
  const stopLive = subscribeEngineLive(token, (event) => {
    if (event.event === "reopening") watch.onReopening?.(event);
    else watch.onReopened?.(event);
  });
  const stopFailure = subscribeEngineFailure(token, (failure) => {
    watch.onEnded?.(failure.message, planLiveRecovery({ attempts: drops.drop(), permanent: isPermanentLiveFailure(failure.message) }));
  });
  return () => {
    stopLive();
    stopFailure();
  };
}
