/**
 * The engine session's startup measurement and link steering. Type-only imports from the
 * engine service, so every decision here is testable without the native module.
 */
import type { ThroughputSample } from "@/services/localRemux";
import { LINK_CAP_HYSTERESIS, LINK_CAP_SHARE, LINK_CLIMB_MARGIN } from "./constants";

/** One session's throughput samples and the subscription feeding them. */
export type ThroughputWatch = { samples: ThroughputSample[]; unsubscribe: (() => void) | null; handedOver: boolean };

/** Ends the subscription and the samples. `handedOver` belongs to the item, not the watch. */
export function dropThroughputWatch(watch: ThroughputWatch): void {
  watch.unsubscribe?.();
  watch.unsubscribe = null;
  watch.samples = [];
}

/** How the pre-flight ended: the first segment's sample, the engine's failure, or null at the deadline. */
export type PreflightOutcome = ThroughputSample | { failed: string } | null;

/** The server answered the engine's read with a 404: the transcode lane reads the same path. */
export class EngineInputMissingError extends Error {}

export interface PreflightGate {
  /** Hand the gate an outcome. False once the gate is closed. */
  settle: (outcome: PreflightOutcome) => boolean;
  /** Wait for the next outcome, or null at the deadline. */
  next: (ms: number) => Promise<PreflightOutcome>;
  close: () => void;
}

/**
 * Settled by the first sample or failure, null at each deadline. An outcome that lands
 * between two waits is held for the next one.
 */
export function createPreflightGate(): PreflightGate {
  let open = true;
  let waiting: ((outcome: PreflightOutcome) => void) | null = null;
  const early: PreflightOutcome[] = [];

  return {
    settle(outcome) {
      if (!open) return false;
      if (waiting) {
        const resolveFirst = waiting;
        waiting = null;
        resolveFirst(outcome);
      } else {
        early.push(outcome);
      }
      return true;
    },
    next(ms) {
      return new Promise<PreflightOutcome>((resolve) => {
        if (early.length > 0) {
          resolve(early.shift() ?? null);
          return;
        }
        const deadline = setTimeout(() => {
          waiting = null;
          resolve(null);
        }, ms);
        waiting = (outcome) => {
          clearTimeout(deadline);
          resolve(outcome);
        };
      });
    },
    close() {
      open = false;
    },
  };
}

export interface EngineProgressReading {
  alive: boolean;
  bytesRead: number;
  elapsedSeconds: number;
  readSeconds: number;
}

/**
 * A deadline that finds the session alive and still pulling bytes at the link's pace is the
 * link's deadline, not the engine's.
 */
export function stillPullingInput<T extends EngineProgressReading>(progress: T | null | undefined, bytesSeen: number, readBoundShare: number): progress is T {
  return progress != null && progress.alive && progress.bytesRead > bytesSeen && progress.elapsedSeconds > 0 && progress.readSeconds / progress.elapsedSeconds >= readBoundShare;
}

/**
 * The ceiling AVPlayer picks its variant under. Never below the smallest variant the master
 * lists: a cap under all of them leaves AVPlayer nothing it may play and it wanders between
 * every one without showing a frame (drill S5 at 0.6 Mb/s). Null when the move is too small
 * to be worth re-evaluating the variant for.
 */
export function nextLinkCap(input: { bps: number; currentCap: number; floorBps: number }): number | null {
  const cap = Math.max(Math.round(input.bps * LINK_CAP_SHARE), input.floorBps);
  if (input.currentCap > 0 && Math.abs(cap - input.currentCap) < input.currentCap * LINK_CAP_HYSTERESIS) return null;
  return cap;
}

/**
 * Whether the link has room for the chapter grabber, which decodes keyframes off the source beside
 * the stream: only a link that carries the copy with the master's own margin. A session with a
 * ladder that has not heard from the link yet has no room to claim.
 */
export function linkAffordsChapterFrames(bps: number | null, sourceBps: number): boolean {
  return bps !== null && sourceBps > 0 && bps >= sourceBps * LINK_CLIMB_MARGIN;
}

export interface ClimbInput {
  bps: number;
  /** The source's own rate; 0 means nothing to climb back to. */
  sourceBps: number;
  /** The master already lists the copy, so AVPlayer climbs to it itself. */
  copyListed: boolean | null | undefined;
  /** A hold is already running. */
  armed: boolean;
  nowMs: number;
  /** Earliest a rebuild may follow the last one. */
  cooldownUntilMs: number;
}

/**
 * A master written for a link below the source carries no copy variant, so a recovered link
 * is climbed by rebuilding the session at the playhead once the recovery has held.
 */
export function planLinkClimb(input: ClimbInput): "arm" | "cancel" | "hold" {
  if (input.sourceBps <= 0 || input.copyListed !== false) return "hold";
  if (input.bps < input.sourceBps * LINK_CLIMB_MARGIN) return "cancel";
  if (input.armed || input.nowMs < input.cooldownUntilMs) return "hold";
  return "arm";
}

export interface KeptForInput {
  belowRealtime: boolean;
  live: boolean;
  /** A live channel the server offers a transcode for has somewhere else to go. */
  liveHasServerRung: boolean;
  /** A Slipstream rung is declared, so the primary is never the startup gate. */
  tierDeclared: boolean;
  /** The segment was slow because the input arrived slowly, not because the device is slow. */
  readBound: boolean;
}

/**
 * Why a below-realtime engine is KEPT instead of routed to the server. Anything below
 * realtime with none of these reasons is the device's fault and hands over.
 */
export function keptForReason(input: KeptForInput): "tier" | "live" | "link" | null {
  if (!input.belowRealtime) return null;
  if (input.live) return input.liveHasServerRung ? null : "live";
  if (input.tierDeclared) return "tier";
  if (input.readBound) return "link";
  return null;
}
