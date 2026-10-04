import type { ServerTranscodeBlock } from "@/services/transcodePolicy";
import { PlaybackErrorType } from "@/utils/errorClassification";
import { IdentifiedError, PLAYBACK_ERROR_IDS } from "@/utils/errorIds";
import type { PlaybackMode, ServerOff } from "./machine";

/** No lane takes the item: it needs the server, and the server is off for it. */
export class ServerTranscodeOffError extends IdentifiedError {
  constructor(readonly by: ServerTranscodeBlock) {
    super(PLAYBACK_ERROR_IDS.NOLANE, "Server transcoding is off for this item");
  }
}

/** Failures a server transcode would not have answered: the server, the item or the account is the problem. */
const SERVER_WOULD_NOT_HELP: readonly PlaybackErrorType[] = [PlaybackErrorType.UNAUTHORIZED, PlaybackErrorType.NOT_FOUND, PlaybackErrorType.PROTECTED, PlaybackErrorType.NETWORK];

/** What the error screen says about the server lane: who turned it off, when it was the rung this failure skipped. */
export function serverOffForError(error: unknown, errorType: PlaybackErrorType, by: ServerTranscodeBlock | null, heldOnDisk: boolean): ServerOff | undefined {
  if (error instanceof ServerTranscodeOffError) return { by: error.by, needed: true };
  if (!by || heldOnDisk || SERVER_WOULD_NOT_HELP.includes(errorType)) return undefined;
  return { by, needed: false };
}

/** Automatic retries stop after this long unless 30s of playback lands in between. */
export const AUTOMATIC_RETRY_BUDGET_MS = 120_000;

export function automaticRetryDelay(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** Math.min(Math.max(0, attempt), 6));
}

export function shouldAutomaticallyRetry(input: { live: boolean; heldOnDisk: boolean; errorType: PlaybackErrorType; ladderSpent: boolean; retryingForMs: number }): boolean {
  if (input.live || input.heldOnDisk || input.retryingForMs >= AUTOMATIC_RETRY_BUDGET_MS) return false;
  switch (input.errorType) {
    case PlaybackErrorType.UNAUTHORIZED:
    case PlaybackErrorType.NOT_FOUND:
    case PlaybackErrorType.PROTECTED:
      return false;
    // A corrupt-looking message can still be one lane's fault, until every lane has said it.
    case PlaybackErrorType.CORRUPT:
    case PlaybackErrorType.DECODE:
      return !input.ladderSpent;
    default:
      return true;
  }
}

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
  networkGateway?: boolean;
  serverTranscodingAllowed?: boolean;
  /** The engine already took its one fresh session for this item. */
  hasRetriedGateway?: boolean;
}

/** Failures of the link, which a later attempt can outlast. */
const LINK_FAILURES: readonly PlaybackErrorType[] = [PlaybackErrorType.STALLED, PlaybackErrorType.NETWORK, PlaybackErrorType.TIMEOUT];

/** With the server ruled out the engine is the last rung: one fresh session, then the error, unless the link failed. */
export function engineSpentWithoutServer(input: { errorType: PlaybackErrorType; serverTranscodingAllowed?: boolean; hasRetriedGateway?: boolean }): boolean {
  return input.serverTranscodingAllowed === false && input.hasRetriedGateway === true && !LINK_FAILURES.includes(input.errorType);
}

export interface ErrorRecoveryDecision {
  retryGateway: boolean;
  /** Nothing is left to try: the error is final. */
  engineSpent: boolean;
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
  const engineSpent = input.networkGateway === true && !input.hasTriedTranscoding && engineSpentWithoutServer(input);
  const retryGateway = input.networkGateway === true && !input.hasTriedTranscoding && !engineSpent && (input.serverTranscodingAllowed === false || LINK_FAILURES.includes(input.errorType));
  const restartRemux = input.mode === "localRemux" && input.errorType === PlaybackErrorType.STALLED && midPlayback && !input.hasTriedRemuxRestart;
  // A held file's engine failure spends its subtitles rather than the transcode rung: the film
  // comes back as direct play off the disk, which is the whole reason it was downloaded.
  const dropSubtitles = input.mode === "localRemux" && input.heldOnDisk && !input.hasDroppedSubtitles && !restartRemux;
  // Reads "a retry is coming", which is what carries the playhead into it. The reducer decides
  // the retry itself; narrowing this only ever cost the resume position.
  const willRetryWithTranscode = (input.mode === "direct" || input.mode === "localRemux") && !input.hasTriedTranscoding && !engineSpent;
  // Spent up front so the retry's lane pick cannot loop back into the engine, except when the
  // engine restart rung is taking this error, which must leave the ladder intact. Never for a
  // held file, whose ladder is engine then its own disk.
  const latchTranscodeUpFront = input.mode === "localRemux" && willRetryWithTranscode && !restartRemux && !input.heldOnDisk && !retryGateway;

  const action: ErrorRecoveryDecision["action"] =
    input.errorType === PlaybackErrorType.UNAUTHORIZED && !input.hasTriedCredentialRefresh
      ? { kind: "refreshCredentials" }
      : retryGateway
        ? { kind: "reportError" }
        : restartRemux
          ? { kind: "restartRemux" }
          : input.mode === "transcode" && midPlayback && !input.hasTriedSeekRecovery
            ? { kind: "transcodeSeekRecovery" }
            : { kind: "reportError" };

  return {
    retryGateway,
    engineSpent,
    latchTranscodeUpFront,
    willRetryWithTranscode,
    // Any mid-playback rung change resumes at the playhead. The credential-refresh path keeps
    // its own resume semantics.
    carryPositionSec: action.kind === "refreshCredentials" ? null : midPlayback && (restartRemux || action.kind === "transcodeSeekRecovery" || willRetryWithTranscode) ? input.currentTimeSec : null,
    stopRemuxSession: input.mode === "localRemux" && (retryGateway || restartRemux || latchTranscodeUpFront || dropSubtitles),
    dropSubtitles,
    stallFallback: input.mode === "localRemux" && input.errorType === PlaybackErrorType.STALLED && !restartRemux && !retryGateway,
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
  /** False when the device or the server rules the server rung out. */
  serverTranscodingAllowed?: boolean;
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
  const toServer = retriable && engineLane && !reopen && input.lane === "engine" && input.serverTranscodingAllowed !== false;
  return { reopen, toServer, retry: reopen || toServer };
}
