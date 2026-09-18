import { PlaybackErrorType } from "@/utils/errorClassification";
import type { PlaybackMode } from "./machine";

export interface ErrorRecoveryInput {
  mode: PlaybackMode;
  errorType: PlaybackErrorType;
  /** Live playhead at the moment of the error (currentTimeRef). */
  currentTimeSec: number;
  hasTriedRemuxRestart: boolean;
  hasTriedTranscoding: boolean;
  hasTriedSeekRecovery: boolean;
  hasTriedCredentialRefresh: boolean;
  /** The file is on this device. The server rung leads nowhere a download has to go. */
  heldOnDisk: boolean;
  /** This item has already given up its subtitles once; the rung is spent. */
  hasDroppedSubtitles: boolean;
}

export interface ErrorRecoveryDecision {
  /** A localRemux failure heading to the server spends the engine rung up front. */
  latchTranscodeUpFront: boolean;
  /** The auto-retry-effect eligibility, as the reducer expects it. */
  willRetryWithTranscode: boolean;
  /** Playhead to resume from in the next session; null leaves resume semantics alone. */
  carryPositionSec: number | null;
  /** The loopback session is dead, stop it before the next lane spins up. */
  stopRemuxSession: boolean;
  /** Retry this held file without its subtitles, which is direct play off the disk. */
  dropSubtitles: boolean;
  /** The server fallback owes the viewer playback, not fidelity: enter at the floor preset. */
  stallFallback: boolean;
  action: { kind: "refreshCredentials" } | { kind: "restartRemux" } | { kind: "transcodeSeekRecovery" } | { kind: "reportError" };
}

/**
 * The retry ladder: direct → engine → server, with one engine restart for a mid-playback
 * starvation (STALLED, CoreMedia -12889) before the server rung.
 */
export function planErrorRecovery(input: ErrorRecoveryInput): ErrorRecoveryDecision {
  const midPlayback = input.currentTimeSec > 1;
  const restartRemux = input.mode === "localRemux" && input.errorType === PlaybackErrorType.STALLED && midPlayback && !input.hasTriedRemuxRestart;
  // A held file's engine failure spends its subtitles rather than the transcode rung: the film
  // comes back as direct play off the disk, which is the whole reason it was downloaded.
  const dropSubtitles = input.mode === "localRemux" && input.heldOnDisk && !input.hasDroppedSubtitles && !restartRemux;
  // Reads "a retry is coming", which is what carries the playhead into it. The reducer decides
  // the retry itself; narrowing this only ever cost the resume position.
  const willRetryWithTranscode = (input.mode === "direct" || input.mode === "localRemux") && !input.hasTriedTranscoding;
  // Spent up front so the retry's lane pick cannot loop back into the engine, except when the
  // engine restart rung is taking this error, which must leave the ladder intact. Never for a
  // held file, whose ladder is engine then its own disk.
  const latchTranscodeUpFront = input.mode === "localRemux" && willRetryWithTranscode && !restartRemux && !input.heldOnDisk;

  const action: ErrorRecoveryDecision["action"] =
    input.errorType === PlaybackErrorType.UNAUTHORIZED && !input.hasTriedCredentialRefresh
      ? { kind: "refreshCredentials" }
      : restartRemux
        ? { kind: "restartRemux" }
        : input.mode === "transcode" && midPlayback && !input.hasTriedSeekRecovery
          ? { kind: "transcodeSeekRecovery" }
          : { kind: "reportError" };

  return {
    latchTranscodeUpFront,
    willRetryWithTranscode,
    // Any mid-playback rung change resumes at the playhead. The credential-refresh path keeps
    // its own resume semantics.
    carryPositionSec: action.kind === "refreshCredentials" ? null : midPlayback && (restartRemux || action.kind === "transcodeSeekRecovery" || willRetryWithTranscode) ? input.currentTimeSec : null,
    stopRemuxSession: input.mode === "localRemux" && (restartRemux || latchTranscodeUpFront || dropSubtitles),
    dropSubtitles,
    stallFallback: input.mode === "localRemux" && input.errorType === PlaybackErrorType.STALLED && !restartRemux,
    action,
  };
}

export interface LiveErrorInput {
  mode: PlaybackMode;
  errorType: PlaybackErrorType;
  /** This play has already reopened the channel once. */
  hasReopened: boolean;
  /** Which rung the channel is on. */
  lane: "engine" | "server";
}

export interface LiveErrorDecision {
  /** Open the channel afresh on the engine: a dropped tuner stream only comes back that way. */
  reopen: boolean;
  /** Spend the engine rung and take the server's transcode. */
  toServer: boolean;
  /** Either rung: a retry is coming, so the reducer must not treat this as terminal. */
  retry: boolean;
}

/** The live ladder: one fresh engine open, then the server's transcode, then the error. */
export function planLiveErrorRecovery(input: LiveErrorInput): LiveErrorDecision {
  const engineLane = input.mode === "localRemux";
  // A 401 fails every rung the same way; a reopen would only spend two cold opens on it.
  const retriable = input.errorType !== PlaybackErrorType.UNAUTHORIZED;
  const reopen = retriable && engineLane && !input.hasReopened;
  const toServer = retriable && engineLane && !reopen && input.lane === "engine";
  return { reopen, toServer, retry: reopen || toServer };
}
