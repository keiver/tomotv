import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";

/**
 * "localRemux": the file is rewrapped on-device and served over loopback HLS
 * (services/localRemux.ts). Carries the original bits like direct play, in a
 * container AVPlayer accepts.
 */
export type PlaybackMode = "direct" | "transcode" | "localRemux";
export type PlaybackTransport = "direct" | "server" | "gateway";

/**
 * IDLE → FETCHING_METADATA → CREATING_STREAM → INITIALIZING_PLAYER → READY → PLAYING
 *                                                                        ↓ ERROR
 */
export type VideoPlayerState =
  | { type: "IDLE" }
  | { type: "FETCHING_METADATA" }
  | { type: "CREATING_STREAM"; mode: PlaybackMode; details: JellyfinVideoItem; hasSubtitles: boolean }
  | { type: "INITIALIZING_PLAYER"; mode: PlaybackMode; streamUrl: string }
  | { type: "READY"; mode: PlaybackMode }
  | { type: "PLAYING"; mode: PlaybackMode }
  | { type: "ERROR"; error: string; canRetryWithTranscode: boolean; autoRetry?: boolean; retryGateway?: boolean };

export interface PlaybackError {
  message: string;
}

export type VideoPlayerAction =
  | { type: "FETCH_METADATA" }
  | { type: "METADATA_FETCHED"; details: JellyfinVideoItem; mode: PlaybackMode; hasSubtitles: boolean }
  | { type: "STREAM_CREATED"; streamUrl: string; mode?: PlaybackMode }
  | { type: "PROCESSING_CHANGED"; mode: PlaybackMode }
  | { type: "PLAYER_READY" }
  | { type: "PLAYER_PLAYING" }
  | { type: "PLAYER_ERROR"; error: PlaybackError; mode: PlaybackMode; hasTriedTranscode: boolean; autoRetry?: boolean; retryGateway?: boolean }
  | { type: "RETRY" }
  | { type: "RETRY_WITH_TRANSCODE" };

export function videoPlayerReducer(state: VideoPlayerState, action: VideoPlayerAction): VideoPlayerState {
  const next = reduce(state, action);
  // `to` is the state the action produced: the guards below reject several actions.
  logger.debug("State machine transition", {
    service: "VideoStateMachine",
    on: action.type,
    from: state.type,
    to: next.type,
  });
  return next;
}

function reduce(state: VideoPlayerState, action: VideoPlayerAction): VideoPlayerState {
  switch (action.type) {
    case "FETCH_METADATA":
      return { type: "FETCHING_METADATA" };

    case "METADATA_FETCHED":
      return {
        type: "CREATING_STREAM",
        mode: action.mode,
        details: action.details,
        hasSubtitles: action.hasSubtitles,
      };

    case "STREAM_CREATED":
      if (state.type !== "CREATING_STREAM") return state;
      return {
        type: "INITIALIZING_PLAYER",
        mode: action.mode ?? state.mode,
        streamUrl: action.streamUrl,
      };

    case "PROCESSING_CHANGED":
      if (state.type !== "INITIALIZING_PLAYER" && state.type !== "READY" && state.type !== "PLAYING") return state;
      return state.mode === action.mode ? state : { ...state, mode: action.mode };

    case "PLAYER_READY":
      if (state.type !== "INITIALIZING_PLAYER") return state;
      return {
        type: "READY",
        mode: state.mode,
      };

    case "PLAYER_PLAYING":
      if (state.type !== "READY" && state.type !== "PLAYING") return state;
      return {
        type: "PLAYING",
        mode: state.mode,
      };

    case "PLAYER_ERROR": {
      // Both direct play and a local remux fall back to the server transcode once;
      // onError marks a failed localRemux as spent so the retry can't loop on it.
      const canRetry = action.autoRetry ?? ((action.mode === "direct" || action.mode === "localRemux") && !action.hasTriedTranscode);
      const errorMsg = action.error?.message || "Failed to load video";
      return {
        type: "ERROR",
        error: errorMsg,
        canRetryWithTranscode: canRetry,
        ...(action.autoRetry !== undefined ? { autoRetry: action.autoRetry } : {}),
        ...(action.retryGateway ? { retryGateway: true } : {}),
      };
    }

    case "RETRY":
      // Same reference when already idle: a fresh object re-renders the hook for a
      // transition that did not happen.
      return state.type === "IDLE" ? state : { type: "IDLE" };

    case "RETRY_WITH_TRANSCODE":
      return { type: "FETCHING_METADATA" };

    default:
      return state;
  }
}
