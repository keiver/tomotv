import { useEffect, useState, useMemo, useRef, useCallback, useReducer } from "react";
import type { VideoRef, OnLoadData, OnProgressData, OnVideoErrorData, AudioTrack, TextTrack } from "react-native-video";
import { InteractionManager } from "react-native";
import {
  fetchVideoDetails,
  needsTranscoding,
  isAudioOnly,
  getSubtitleTracks,
  getBurnInSubtitleStream,
  getBurnInSubtitlesSetting,
  getVideoStreamUrl,
  getTranscodingStreamUrl,
  isDemoMode,
  connectToDemoServer,
  refreshConfig,
  getConfig,
  generatePlaySessionId,
  JELLYFIN_TIME,
} from "@/services/jellyfinApi";
import { usePlaybackReporter } from "./usePlaybackReporter";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { prepareMultiAudioPlayback, shouldUseMultiAudio, isMultiAudioAvailable, getAudioTracks } from "@/services/multiAudioLoader";

/**
 * Error types for video playback classification
 * Using specific patterns instead of loose string matching
 */
export enum PlaybackErrorType {
  NOT_FOUND = "NOT_FOUND",
  UNAUTHORIZED = "UNAUTHORIZED",
  NETWORK = "NETWORK",
  TIMEOUT = "TIMEOUT",
  CORRUPT = "CORRUPT",
  DECODE = "DECODE",
  UNKNOWN = "UNKNOWN",
}

// Patterns for classifying errors - order matters (more specific first)
const ERROR_PATTERNS: { type: PlaybackErrorType; patterns: RegExp[] }[] = [
  {
    type: PlaybackErrorType.NOT_FOUND,
    patterns: [/not found/i, /404/i, /item.*not.*exist/i],
  },
  {
    type: PlaybackErrorType.UNAUTHORIZED,
    patterns: [
      /unauthorized/i,
      /401/i,
      /not authorized/i,
      /authentication.*fail/i,
      /invalid.*credentials/i,
      /error -1013/i, // NSURLErrorResourceUnavailable (often indicates 401/403)
    ],
  },
  {
    type: PlaybackErrorType.TIMEOUT,
    patterns: [/timed?\s*out/i, /timeout/i, /etimedout/i],
  },
  {
    type: PlaybackErrorType.CORRUPT,
    patterns: [/HostFunction/i, /corrupted/i, /invalid.*format/i, /invalid.*data/i],
  },
  {
    type: PlaybackErrorType.DECODE,
    patterns: [/decode/i, /codec.*not.*supported/i, /unable.*play/i],
  },
  {
    type: PlaybackErrorType.NETWORK,
    patterns: [/network\s*(error|fail|issue)/i, /fetch\s*(error|fail)/i, /connection\s*(refused|reset|closed)/i, /econnreset/i, /econnrefused/i, /unable.*connect/i],
  },
];

/**
 * Classifies an error into a specific type using pattern matching
 * More reliable than loose includes() checks
 */
export function classifyPlaybackError(error: unknown): PlaybackErrorType {
  if (!error) return PlaybackErrorType.UNKNOWN;

  // Native AVPlayer: CoreMediaErrorDomain -12971 = failed to parse segment
  if (typeof error === "object" && error !== null && "code" in error && "domain" in error) {
    const native = error as { code: number; domain: string };
    if (native.code === -12971 && native.domain === "CoreMediaErrorDomain") return PlaybackErrorType.DECODE;
  }

  // Extract error message, preferring localizedDescription for native AVPlayer errors
  let errorMessage: string;
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;
    errorMessage = String(obj.localizedDescription ?? obj.message ?? "");
  } else {
    errorMessage = String(error);
  }

  for (const { type, patterns } of ERROR_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(errorMessage))) {
      return type;
    }
  }

  return PlaybackErrorType.UNKNOWN;
}

/**
 * Gets a user-friendly error message based on error type
 */
export function getPlaybackErrorMessage(errorType: PlaybackErrorType): string {
  switch (errorType) {
    case PlaybackErrorType.NOT_FOUND:
      return "Video not found on server";
    case PlaybackErrorType.UNAUTHORIZED:
      return "Authentication failed. Your session may have expired.";
    case PlaybackErrorType.NETWORK:
      return "Unable to connect to Jellyfin server";
    case PlaybackErrorType.TIMEOUT:
      return "Connection timed out. Please check your network";
    case PlaybackErrorType.CORRUPT:
      return "This video file appears to be corrupted or in an unsupported format";
    case PlaybackErrorType.DECODE:
      return "Unable to decode video. Try a different quality setting";
    case PlaybackErrorType.UNKNOWN:
    default:
      return "Failed to load video";
  }
}

export type PlaybackMode = "direct" | "transcode";

/**
 * Video player state machine
 * State transitions:
 * IDLE → FETCHING_METADATA → CREATING_STREAM → INITIALIZING_PLAYER → READY → PLAYING
 *                                                                           ↓
 *                                                                        ERROR
 */
export type VideoPlayerState =
  | { type: "IDLE" }
  | { type: "FETCHING_METADATA" }
  | { type: "CREATING_STREAM"; mode: PlaybackMode; details: JellyfinVideoItem; hasSubtitles: boolean }
  | { type: "INITIALIZING_PLAYER"; mode: PlaybackMode; streamUrl: string }
  | { type: "READY"; mode: PlaybackMode }
  | { type: "PLAYING"; mode: PlaybackMode }
  | { type: "ERROR"; error: string; canRetryWithTranscode: boolean };

export interface PlaybackError {
  message: string;
}

export type VideoPlayerAction =
  | { type: "FETCH_METADATA" }
  | { type: "METADATA_FETCHED"; details: JellyfinVideoItem; mode: PlaybackMode; hasSubtitles: boolean }
  | { type: "STREAM_CREATED"; streamUrl: string }
  | { type: "PLAYER_READY" }
  | { type: "PLAYER_PLAYING" }
  | { type: "PLAYER_ERROR"; error: PlaybackError; mode: PlaybackMode; hasTriedTranscode: boolean }
  | { type: "RETRY" }
  | { type: "RETRY_WITH_TRANSCODE" };

export interface VideoPlaybackConfig {
  videoId: string;
  onPlaybackEnd?: () => void;
}

export interface VideoPlaybackResult {
  // Player ref for Video component
  videoRef: React.RefObject<VideoRef | null>;

  // Source URI for Video component
  sourceUri: string | null;

  // Paused state for Video component
  paused: boolean;

  // Video component event callbacks
  videoCallbacks: {
    onLoad: (data: OnLoadData) => void;
    onProgress: (data: OnProgressData) => void;
    onError: (error: OnVideoErrorData) => void;
    onEnd: () => void;
    onAudioTracks: (data: { audioTracks: AudioTrack[] }) => void;
    onTextTracks: (data: { textTracks: TextTrack[] }) => void;
  };

  // State machine state
  state: VideoPlayerState;

  // Video details
  videoDetails: JellyfinVideoItem | null;

  // Media type
  isAudioOnly: boolean;

  // UI helpers
  isLoading: boolean;
  showLoadingOverlay: boolean;

  // Playback control
  play: () => void;
  pause: () => void;

  // Actions
  retry: () => void;
}

/**
 * State machine reducer for video playback
 */
export function videoPlayerReducer(state: VideoPlayerState, action: VideoPlayerAction): VideoPlayerState {
  logger.debug("State machine transition", {
    service: "VideoStateMachine",
    from: state.type,
    to: action.type,
  });

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
        mode: state.mode,
        streamUrl: action.streamUrl,
      };

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
      const canRetry = action.mode === "direct" && !action.hasTriedTranscode;
      const errorMsg = action.error?.message || "Failed to load video";
      return {
        type: "ERROR",
        error: errorMsg,
        canRetryWithTranscode: canRetry,
      };
    }

    case "RETRY":
      return { type: "IDLE" };

    case "RETRY_WITH_TRANSCODE":
      return { type: "FETCHING_METADATA" };

    default:
      return state;
  }
}

/**
 * Custom hook to manage video playback logic using a state machine
 * Handles codec checking, transcoding decisions, and player lifecycle
 */
export function useVideoPlayback(config: VideoPlaybackConfig): VideoPlaybackResult {
  const { videoId, onPlaybackEnd } = config;

  // State machine
  const [state, dispatch] = useReducer(videoPlayerReducer, { type: "IDLE" });

  // Persistent data across states
  const [videoDetails, setVideoDetails] = useState<JellyfinVideoItem | null>(null);
  const [hasTriedTranscoding, setHasTriedTranscoding] = useState(false);
  const [hasTriedCredentialRefresh, setHasTriedCredentialRefresh] = useState(false);
  const [hasTriedSeekRecovery, setHasTriedSeekRecovery] = useState(false);
  const hasTriedResumeFallbackRef = useRef(false);

  // Request ID to prevent race conditions when videoId changes
  // Incremented on each videoId change, async operations check before updating state
  const requestIdRef = useRef(0);

  // === Refs for synchronous access in event handlers ===
  // Note: These refs cannot be consolidated into state because event handlers
  // need synchronous access to avoid race conditions and stale closures.

  // Lifecycle & autoplay control
  const autoPlayTriggeredRef = useRef(false);
  const isMountedRef = useRef(true);
  const autoPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stablePlaybackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seek recovery: store ticks to resume transcoding from after a seek crash
  const startTimeTicksRef = useRef<number | null>(null);

  // Server session reporting: one PlaySessionId per stream (rotated in the
  // CREATING_STREAM effect), MediaSourceId from fetched details. The reset
  // callback is held in a ref because the reporter hook is initialized after
  // the callbacks/effects that need to close a session.
  const playSessionIdRef = useRef<string>(generatePlaySessionId());
  const mediaSourceIdRef = useRef<string | null>(null);
  const resetPlaybackSessionRef = useRef<(() => void) | null>(null);
  // Played flag as it stood BEFORE this session, captured on the first metadata fetch
  // only: mid-session re-fetches (audio switch, transcode retries) can return state the
  // server's resume gates already polluted during this same session. The reporter's
  // UserData writes restore this value so a partial play never flips a real watched flag.
  const wasPlayedAtStartRef = useRef<boolean | null>(null);

  // Resume fallback: store position (seconds) when StartTimeTicks is used from server resume data
  // If the StartTimeTicks URL fails, we can retry with client-side seek instead
  const resumePositionForFallbackRef = useRef<number | null>(null);

  // Status tracking (for debouncing rapid status changes)
  const isSeekingRef = useRef(false);
  const lastStatusChangeRef = useRef<number>(0);
  const hasStablePlaybackRef = useRef(false); // Ref for sync access in handlers

  // Playback mode & callbacks (avoid stale closures in event listeners)
  const currentModeRef = useRef<PlaybackMode>("direct");
  const onPlaybackEndRef = useRef(onPlaybackEnd);
  onPlaybackEndRef.current = onPlaybackEnd;

  // Track stable playback for UI (state triggers re-renders, ref is for sync checks)
  const [hasStablePlayback, setHasStablePlayback] = useState(false);

  /**
   * Step 1: Fetch video metadata and determine playback mode
   */
  const fetchMetadata = useCallback(async () => {
    // Capture current request ID to check for stale responses
    const currentRequestId = requestIdRef.current;

    logger.debug("Fetching video details", { service: "useVideoPlayback", videoId, requestId: currentRequestId });

    try {
      const details = await fetchVideoDetails(videoId);

      // Check if this response is stale (videoId changed while fetching)
      if (requestIdRef.current !== currentRequestId) {
        logger.debug("Ignoring stale metadata response", {
          service: "useVideoPlayback",
          expectedRequestId: requestIdRef.current,
          actualRequestId: currentRequestId,
        });
        return;
      }

      if (!details) {
        throw new Error("Video not found or unavailable");
      }

      setVideoDetails(details);
      mediaSourceIdRef.current = details.MediaSources?.[0]?.Id ?? null;
      if (wasPlayedAtStartRef.current === null) {
        wasPlayedAtStartRef.current = details.UserData?.Played ?? false;
      }

      // Check if this is an audio-only file
      const audioOnly = isAudioOnly(details);
      if (audioOnly) {
        logger.debug("Audio-only file detected - will use direct play", { service: "useVideoPlayback" });
      }

      // Check codec compatibility (skip for audio-only files)
      const requiresTranscoding = audioOnly ? false : needsTranscoding(details);

      // Check for external subtitles
      const subtitles = getSubtitleTracks(details);
      const hasExternalSubs = subtitles.length > 0;

      // Check for subtitles that require server-side burn-in (image subs always; forced text subs)
      const burnInStream = audioOnly || !(await getBurnInSubtitlesSetting()) ? null : getBurnInSubtitleStream(details);
      burnInSubtitleIndexRef.current = burnInStream?.Index ?? null;

      // Determine playback mode - force transcode on retry
      let selectedMode: PlaybackMode = "direct";

      if (requiresTranscoding || hasExternalSubs || burnInStream !== null || hasTriedTranscoding) {
        selectedMode = "transcode";

        if (requiresTranscoding) {
          logger.info("Codec not supported, using transcoding", { service: "useVideoPlayback" });
        }
        if (hasExternalSubs) {
          logger.info("Found external subtitles, using HLS with subtitle tracks", {
            service: "useVideoPlayback",
            subtitleCount: subtitles.length,
          });
        }
        if (burnInStream !== null) {
          logger.info("Burning in subtitle during transcoding", {
            service: "useVideoPlayback",
            subtitleStreamIndex: burnInStream.Index,
            codec: burnInStream.Codec,
          });
        }
        if (hasTriedTranscoding) {
          logger.info("Retrying with transcoding", { service: "useVideoPlayback" });
        }
      } else {
        logger.info("Using direct play", { service: "useVideoPlayback" });
      }

      // Server-side resume position from item UserData (populated because
      // fetchVideoDetails requests EnableUserData=true) — only if no other seek is pending
      if (seekToPositionAfterLoadRef.current === null && startTimeTicksRef.current === null) {
        const resumeTicks = details.UserData?.PlaybackPositionTicks;
        if (resumeTicks && resumeTicks > 0) {
          const resumePosition = resumeTicks / JELLYFIN_TIME.TICKS_PER_SECOND;
          if (selectedMode === "transcode") {
            // Server-side offset — transcode starts from resume point directly
            startTimeTicksRef.current = resumeTicks;
            // Store position for fallback: if StartTimeTicks URL fails,
            // we can retry with client-side seek instead
            resumePositionForFallbackRef.current = resumePosition;
            logger.info("Resuming transcoded video from server position", {
              service: "useVideoPlayback",
              position: resumePosition,
              startTimeTicks: resumeTicks,
            });
          } else {
            // Client-side seek — player seeks after load
            seekToPositionAfterLoadRef.current = resumePosition;
            logger.info("Resuming direct play video from server position", {
              service: "useVideoPlayback",
              position: resumePosition,
            });
          }
        }
      }

      // Update mode ref before dispatch (for event listener closures)
      currentModeRef.current = selectedMode;

      dispatch({
        type: "METADATA_FETCHED",
        details,
        mode: selectedMode,
        hasSubtitles: hasExternalSubs || burnInStream !== null,
      });

      if (selectedMode === "transcode") {
        setHasTriedTranscoding(true);
      }
    } catch (err) {
      logger.error("Error fetching metadata", err, { service: "useVideoPlayback", videoId });

      // Classify error and provide user-friendly message
      const errorType = classifyPlaybackError(err);
      const errorMessage = getPlaybackErrorMessage(errorType);

      dispatch({
        type: "PLAYER_ERROR",
        error: { message: errorMessage },
        mode: "direct",
        hasTriedTranscode: hasTriedTranscoding,
      });
    }
  }, [videoId, hasTriedTranscoding]);

  /**
   * Handle audio track switch by restarting video with new audioStreamIndex
   */
  const handleAudioTrackSwitch = useCallback(
    (newTrackIndex: number) => {
      if (!videoId || !videoDetails) {
        logger.error("❌ Cannot switch audio track: missing video info", {
          service: "useVideoPlayback",
        });
        return;
      }

      // Save current playback position for auto-seek after restart
      const currentPosition = currentTimeRef.current;
      seekToPositionAfterLoadRef.current = currentPosition;

      logger.info("🔄 Starting audio track switch via restart", {
        service: "useVideoPlayback",
        jellyfinStreamIndex: newTrackIndex,
        savedPosition: currentPosition,
      });

      // Pause current playback
      setPaused(true);

      // Reset playing state refs so onProgress will detect playback start after restart
      isPlayingRef.current = false;
      hasStablePlaybackRef.current = false;
      setHasStablePlayback(false);

      // Force restart by transitioning through states
      dispatch({ type: "RETRY_WITH_TRANSCODE" });

      // Store selected audio track for URL generation
      selectedAudioTrackIndexRef.current = newTrackIndex;
    },
    [videoId, videoDetails],
  );

  /**
   * Store streamUrl in state to keep it stable across state transitions
   */
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  /**
   * Step 2: Generate stream URL when in CREATING_STREAM state
   */
  useEffect(() => {
    if (state.type !== "CREATING_STREAM") return;

    const { mode, details } = state;
    // Capture current request ID to check for stale responses
    const currentRequestId = requestIdRef.current;

    const generateStreamUrl = async () => {
      try {
        // New stream = new server session: report Stopped for any in-flight session
        // (no-op if playback never started) and mint a fresh PlaySessionId before
        // building the URL that carries it. Central choke point for every path that
        // recreates the stream (initial load, audio switch, seek recovery, retries).
        resetPlaybackSessionRef.current?.();
        playSessionIdRef.current = generatePlaySessionId();

        let url: string;

        if (mode === "transcode") {
          // Check if we have a specific audio track selected (from user switching)
          const hasSelectedAudioTrack = selectedAudioTrackIndexRef.current !== null;

          // Check if we should use multi-audio custom protocol
          // Skip multi-audio if user has explicitly selected a track (we need to restart with AudioStreamIndex)
          const useMultiAudio = !hasSelectedAudioTrack && isMultiAudioAvailable() && shouldUseMultiAudio(details);

          if (useMultiAudio) {
            // Use multi-audio loader for seamless track switching
            logger.info("🎵 Using multi-audio custom protocol (seamless switching enabled)", {
              service: "useVideoPlayback",
              audioTrackCount: getAudioTracks(details).length,
            });

            // Base transcoding URL for the multi-audio custom protocol. It MUST match what 1.6.0
            // sent (which switches audio correctly): no PlaySessionId and no burn-in params.
            //  - playSessionId: the native module appends its OWN unique PlaySessionId per audio
            //    track (MultiAudioResourceLoader.swift) to force a separate transcode session per
            //    track — that's what makes seamless switching work. A fixed PlaySessionId in the
            //    base URL overrides the per-track ones and collapses every track into one session
            //    (this is what regressed after server-side resume added PlaySessionId here).
            //  - burn-in: SubtitleMethod=Encode ties the transcode to one audio track; keep it off
            //    the shared multi-audio base URL so subtitles can never affect audio switching.
            const seekTicks = startTimeTicksRef.current ?? undefined;
            const baseUrl = await getTranscodingStreamUrl(videoId, details, undefined, seekTicks, undefined, undefined);
            startTimeTicksRef.current = null; // Clear after use

            // Then prepare multi-audio playback with custom protocol
            const cachedConfig = await getConfig();

            url = await prepareMultiAudioPlayback(videoId, details, baseUrl, cachedConfig.apiKey);

            // SET REF: We're using multi-audio mode
            isUsingMultiAudioRef.current = true;
          } else {
            // Regular transcoding
            // Pass selected audio track index if available
            const audioStreamIndex = selectedAudioTrackIndexRef.current ?? undefined;
            const seekTicks = startTimeTicksRef.current ?? undefined;
            url = await getTranscodingStreamUrl(videoId, details, audioStreamIndex, seekTicks, burnInSubtitleIndexRef.current ?? undefined, playSessionIdRef.current);
            startTimeTicksRef.current = null; // Clear after use

            // CLEAR REF: Not using multi-audio
            isUsingMultiAudioRef.current = false;

            if (hasSelectedAudioTrack) {
              logger.info("🎯 Using single-track Jellyfin URL after restart", {
                service: "useVideoPlayback",
                audioStreamIndex,
              });
            }
          }
        } else {
          // Direct play
          url = getVideoStreamUrl(videoId, details);

          // CLEAR REF: Direct play doesn't use multi-audio
          isUsingMultiAudioRef.current = false;
        }

        // Check if this response is stale (videoId changed while fetching)
        if (requestIdRef.current !== currentRequestId) {
          logger.debug("Ignoring stale stream URL response", { service: "useVideoPlayback" });
          return;
        }

        logger.info("Stream URL generated", {
          service: "useVideoPlayback",
          mode: mode.toUpperCase(),
          streamType: url.includes(".m3u8") ? "HLS" : "Direct",
          isMultiAudio: url.includes("jellyfin-multi://"),
        });

        if (!url) {
          throw new Error("Failed to generate stream URL");
        }

        setStreamUrl(url);
        dispatch({ type: "STREAM_CREATED", streamUrl: url });

        // Log available tracks when using HLS transcoding
        if (mode === "transcode" && details) {
          const subtitles = getSubtitleTracks(details);
          const audioTracks = getAudioTracks(details);

          // Build mapping from react-native-video track index to Jellyfin stream index
          // This is needed because react-native-video uses sequential indices (0, 1, 2...)
          // but Jellyfin uses actual stream indices (1, 8, etc.)
          // CRITICAL: Use the SAME sorted array that was sent to Swift via prepareMultiAudioPlayback()
          if (details.MediaStreams && audioTracks.length > 0) {
            audioTrackMappingRef.current = audioTracks.map((track) => track.Index);
            logger.debug("Built audio track mapping", {
              service: "useVideoPlayback",
              mapping: audioTrackMappingRef.current,
              tracks: audioTracks.map((t) => `${t.Language || "und"} (stream ${t.Index})`).join(", "),
            });
          }

          if (subtitles.length > 0 || audioTracks.length > 0) {
            logger.debug("Available tracks in HLS stream", {
              service: "useVideoPlayback",
              subtitleCount: subtitles.length,
              audioTrackCount: audioTracks.length,
              subtitleLanguages: subtitles.map((s) => s.language).join(", "),
              audioLanguages: audioTracks.map((a) => a.Language).join(", "),
            });
          }
        }
      } catch (error) {
        // Check for stale response before dispatching error
        if (requestIdRef.current !== currentRequestId) {
          return;
        }

        logger.error("Error generating stream URL", error, { service: "useVideoPlayback" });

        dispatch({
          type: "PLAYER_ERROR",
          error: {
            message: "Failed to create video stream. Please check your settings.",
          },
          mode,
          hasTriedTranscode: hasTriedTranscoding,
        });
      }
    };

    generateStreamUrl();
  }, [state, videoId, hasTriedTranscoding]);

  /**
   * Step 3: Create video ref for Video component
   */
  const videoRef = useRef<VideoRef>(null);

  /**
   * Step 4: Playback state management
   * Store state that we need for control and callbacks
   */
  const [paused, setPaused] = useState(true); // Start paused, will auto-play on load
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const isPlayingRef = useRef(false);

  // Audio track state (for tracking selected track)
  const selectedAudioTrackIndexRef = useRef<number | null>(null);

  // Image-based subtitle stream index to burn in during transcoding (PGS/DVDSUB)
  const burnInSubtitleIndexRef = useRef<number | null>(null);

  // Store mapping from react-native-video track index to Jellyfin stream index
  const audioTrackMappingRef = useRef<number[]>([]);

  // Position to seek to after video restart (for audio track switching)
  const seekToPositionAfterLoadRef = useRef<number | null>(null);

  // Track if currently using multi-audio mode
  const isUsingMultiAudioRef = useRef<boolean>(false);

  // Track last logged state for deduplication
  const lastLoggedAudioTracksRef = useRef<string>("");
  const lastLoggedTextTracksRef = useRef<string>("");

  // Server playback reporting (Sessions/Playing*) — decoupled from playback state machine
  const { markStarted, markEnded, reportPauseChange, resetSession } = usePlaybackReporter({
    videoId,
    videoRef,
    durationRef,
    mediaSourceIdRef,
    playSessionIdRef,
    isPlayingRef,
    currentModeRef,
    audioStreamIndexRef: selectedAudioTrackIndexRef,
    wasPlayedAtStartRef,
  });
  resetPlaybackSessionRef.current = resetSession;

  /**
   * Step 5: Video event callbacks (replacing player.addListener calls)
   */

  // Callback: Video loaded and ready
  const onLoad = useCallback(
    (data: OnLoadData) => {
      if (!isMountedRef.current) return;

      durationRef.current = data.duration;

      logger.debug("Player loaded and ready", {
        service: "useVideoPlayback",
        duration: data.duration,
      });

      // Auto-seek to saved position if this is a restart (audio track switch)
      const seekPosition = seekToPositionAfterLoadRef.current;
      if (seekPosition !== null && seekPosition > 0) {
        logger.info("⏩ Auto-seeking to saved position", {
          service: "useVideoPlayback",
          position: seekPosition,
        });

        // Small delay to ensure player is ready for seek
        setTimeout(() => {
          videoRef.current?.seek(seekPosition);
          seekToPositionAfterLoadRef.current = null; // Clear after use

          // ✅ FIX: Resume playback after seek
          setPaused(false);
          markStarted(seekPosition * JELLYFIN_TIME.TICKS_PER_SECOND);

          // ✅ FIX: Reset audio track ref to re-enable multi-audio mode
          // This allows the user to switch tracks again after the restart
          selectedAudioTrackIndexRef.current = null;

          logger.info("✅ Auto-seek complete — resumed playback", {
            service: "useVideoPlayback",
            position: seekPosition,
          });
        }, 100);
      }

      // Ensure state update happens on main thread via InteractionManager
      InteractionManager.runAfterInteractions(() => {
        if (!isMountedRef.current) return;
        dispatch({ type: "PLAYER_READY" });
      });

      // Auto-play on first load
      if (!autoPlayTriggeredRef.current && isMountedRef.current) {
        logger.debug("Scheduling auto-play", { service: "useVideoPlayback" });

        // Clear any existing timer
        if (autoPlayTimerRef.current) {
          clearTimeout(autoPlayTimerRef.current);
        }

        // Use InteractionManager to ensure play() is called after interactions complete
        autoPlayTimerRef.current = setTimeout(() => {
          if (!isMountedRef.current) {
            logger.debug("Component unmounted, skipping auto-play", { service: "useVideoPlayback" });
            return;
          }

          InteractionManager.runAfterInteractions(() => {
            if (!isMountedRef.current) return;

            try {
              logger.debug("Auto-playing video", { service: "useVideoPlayback" });
              setPaused(false);
              // Report Playing at the current position (0 for a fresh start; transcode
              // resume streams start their own timeline at the offset). Idempotent if
              // the resume-seek path already registered the session.
              markStarted(Math.round(currentTimeRef.current * JELLYFIN_TIME.TICKS_PER_SECOND));
              // Only mark as triggered after successful play
              autoPlayTriggeredRef.current = true;
            } catch (error) {
              logger.error("Error auto-playing", error, { service: "useVideoPlayback" });
              // Dispatch error on main thread
              InteractionManager.runAfterInteractions(() => {
                if (!isMountedRef.current) return;
                dispatch({
                  type: "PLAYER_ERROR",
                  error: {
                    message: "Failed to start video playback. The video file may be corrupted or incompatible.",
                  },
                  mode: currentModeRef.current,
                  hasTriedTranscode: hasTriedTranscoding,
                });
              });
            }
          });

          autoPlayTimerRef.current = null;
        }, 100);
      }
    },
    [hasTriedTranscoding, markStarted],
  );

  // Callback: Video progress update
  const onProgress = useCallback(
    (data: OnProgressData) => {
      if (!isMountedRef.current) return;

      currentTimeRef.current = data.currentTime;

      // Update playing state
      const nowPlaying = !paused;
      const wasPlaying = isPlayingRef.current;

      if (nowPlaying !== wasPlaying) {
        isPlayingRef.current = nowPlaying;

        if (nowPlaying) {
          // Video started playing
          if (!hasStablePlaybackRef.current) {
            InteractionManager.runAfterInteractions(() => {
              if (!isMountedRef.current) return;
              dispatch({ type: "PLAYER_PLAYING" });
            });

            // Start stable playback detection after video starts playing
            if (stablePlaybackTimerRef.current) {
              clearTimeout(stablePlaybackTimerRef.current);
            }

            stablePlaybackTimerRef.current = setTimeout(() => {
              if (isMountedRef.current && isPlayingRef.current) {
                logger.debug("Stable playback detected, hiding spinner", { service: "useVideoPlayback" });
                hasStablePlaybackRef.current = true;
                InteractionManager.runAfterInteractions(() => {
                  if (!isMountedRef.current) return;
                  setHasStablePlayback(true);
                });
                stablePlaybackTimerRef.current = null;
              }
            }, 500);
          }
        } else {
          // Video paused or stopped, clear the stable playback timer
          if (stablePlaybackTimerRef.current && !hasStablePlaybackRef.current) {
            clearTimeout(stablePlaybackTimerRef.current);
            stablePlaybackTimerRef.current = null;
          }
        }
      }
    },
    [paused, hasTriedTranscoding],
  );

  // Callback: Video playback ended
  const onEnd = useCallback(() => {
    if (!isMountedRef.current) return;

    logger.info("Video playback ended, triggering callback", { service: "useVideoPlayback" });

    // Mark video as ended — clears saved progress
    markEnded();

    InteractionManager.runAfterInteractions(() => {
      if (!isMountedRef.current) return;
      onPlaybackEndRef.current?.();
    });
  }, []);

  // Callback: Video error
  const onError = useCallback(
    (error: OnVideoErrorData) => {
      if (!isMountedRef.current) return;

      const currentMode = currentModeRef.current;
      const willRetryWithTranscode = currentMode === "direct" && !hasTriedTranscoding;

      // Classify error first to determine if it's a 401
      const errorType = classifyPlaybackError(error.error);
      // Extract error message from react-native-video error object
      const originalMessage = error.error?.localizedDescription || error.error?.errorString || String(error.error || "");

      logger.debug("Error classified", {
        service: "useVideoPlayback",
        errorType,
        willRetryWithTranscode,
        hasTriedCredentialRefresh,
      });

      // Check if this is a 401 error in demo mode - try refreshing credentials
      const is401Error = errorType === PlaybackErrorType.UNAUTHORIZED;

      if (is401Error && !hasTriedCredentialRefresh) {
        logger.info("Authentication error detected, attempting to refresh demo credentials", {
          service: "useVideoPlayback",
          error: originalMessage,
        });

        // Try to refresh demo credentials and retry playback
        (async () => {
          try {
            const inDemoMode = await isDemoMode();
            if (inDemoMode) {
              logger.info("Reconnecting to demo server for fresh credentials", {
                service: "useVideoPlayback",
              });

              // Pass false to preserve folder navigation and library state
              await connectToDemoServer(false);
              await refreshConfig();

              logger.info("Demo credentials refreshed, retrying playback", {
                service: "useVideoPlayback",
              });

              // Mark that we tried credential refresh
              setHasTriedCredentialRefresh(true);

              // Retry playback by resetting state
              InteractionManager.runAfterInteractions(() => {
                if (!isMountedRef.current) return;
                dispatch({ type: "RETRY" });
              });

              return;
            }
          } catch (error) {
            logger.error("Failed to refresh demo credentials", error, {
              service: "useVideoPlayback",
            });
          }

          // If not in demo mode or refresh failed, show the error
          const errorMessage = getPlaybackErrorMessage(errorType);
          InteractionManager.runAfterInteractions(() => {
            if (!isMountedRef.current) return;
            dispatch({
              type: "PLAYER_ERROR",
              error: { message: errorMessage },
              mode: currentMode,
              hasTriedTranscode: hasTriedTranscoding,
            });
          });
        })();

        return;
      }

      // Seek recovery: when a transcode stream crashes mid-playback (e.g. seek to non-keyframe),
      // restart the transcode session from the last known position using StartTimeTicks.
      // Limited to 1 attempt to prevent loops.
      if (currentMode === "transcode" && currentTimeRef.current > 1 && !hasTriedSeekRecovery) {
        const lastPositionSec = currentTimeRef.current;
        const ticks = lastPositionSec * JELLYFIN_TIME.TICKS_PER_SECOND;

        logger.info("Seek crash detected during transcode, attempting recovery", {
          service: "useVideoPlayback",
          lastPositionSec,
          startTimeTicks: ticks,
        });

        setHasTriedSeekRecovery(true);
        startTimeTicksRef.current = ticks;

        // Reset playback state for the recovery attempt
        autoPlayTriggeredRef.current = false;
        isPlayingRef.current = false;
        hasStablePlaybackRef.current = false;
        setHasStablePlayback(false);

        // Clear stream URL to unmount Video component
        setStreamUrl(null);

        // Do NOT set seekToPositionAfterLoadRef — the HLS stream already starts at the offset

        InteractionManager.runAfterInteractions(() => {
          if (!isMountedRef.current) return;
          dispatch({ type: "RETRY_WITH_TRANSCODE" });
        });

        return;
      }

      // Resume fallback: when a transcoded stream with StartTimeTicks fails on initial load
      // (e.g. Jellyfin returns NSURLErrorResourceUnavailable -1008), retry without StartTimeTicks
      // and use client-side seek instead. Only fires when the player never started (currentTime ≈ 0).
      if (currentMode === "transcode" && resumePositionForFallbackRef.current !== null && !hasTriedResumeFallbackRef.current) {
        const resumePosition = resumePositionForFallbackRef.current;

        logger.info("StartTimeTicks resume failed, retrying with client-side seek", {
          service: "useVideoPlayback",
          resumePosition,
        });

        hasTriedResumeFallbackRef.current = true;
        resumePositionForFallbackRef.current = null;
        seekToPositionAfterLoadRef.current = resumePosition;
        selectedAudioTrackIndexRef.current = null;

        // Reset playback state for the retry
        autoPlayTriggeredRef.current = false;
        isPlayingRef.current = false;
        hasStablePlaybackRef.current = false;
        setHasStablePlayback(false);

        // Clear stream URL to unmount Video component
        setStreamUrl(null);

        InteractionManager.runAfterInteractions(() => {
          if (!isMountedRef.current) return;
          dispatch({ type: "RETRY_WITH_TRANSCODE" });
        });

        return;
      }

      // Log at INFO level if we'll auto-retry, ERROR level if this is a real failure
      if (willRetryWithTranscode) {
        logger.info("Direct play failed, will retry with transcoding", error, { service: "useVideoPlayback" });
      } else {
        logger.error("Playback error", error, { service: "useVideoPlayback" });
      }

      const errorMessage = getPlaybackErrorMessage(errorType);

      // Ensure error dispatch happens on main thread
      InteractionManager.runAfterInteractions(() => {
        if (!isMountedRef.current) return;
        dispatch({
          type: "PLAYER_ERROR",
          error: { message: errorMessage },
          mode: currentMode,
          hasTriedTranscode: hasTriedTranscoding,
        });
      });
    },
    [hasTriedTranscoding, hasTriedCredentialRefresh, hasTriedSeekRecovery],
  );

  // Callback: Audio tracks discovered from HLS manifest
  const onAudioTracks = useCallback(
    (data: { audioTracks: AudioTrack[] }) => {
      if (!isMountedRef.current) return;

      // Deduplicate logs - only log when data actually changes
      const trackSignature = JSON.stringify({
        count: data.audioTracks.length,
        selected: data.audioTracks.find((t) => t.selected)?.index ?? -1,
      });

      if (trackSignature !== lastLoggedAudioTracksRef.current) {
        lastLoggedAudioTracksRef.current = trackSignature;
        logger.debug("🎵 Audio tracks", {
          service: "useVideoPlayback",
          count: data.audioTracks.length,
          selected: data.audioTracks.find((t) => t.selected)?.index,
        });
      }

      // Skip change detection if we're in single-track mode after restart
      // This prevents infinite restart loop when Jellyfin returns a manifest with only the selected track
      if (data.audioTracks.length === 1 && selectedAudioTrackIndexRef.current !== null) {
        return;
      }

      // Detect audio track change
      const selectedTrack = data.audioTracks.find((t) => t.selected);
      if (selectedTrack) {
        const newIndex = selectedTrack.index;
        const previousIndex = selectedAudioTrackIndexRef.current;

        // Only trigger restart if:
        // 1. We have a previous index (not first load)
        // 2. Index actually changed
        // 3. Video has achieved stable playback (prevents auto-selection from triggering restart)
        // 4. NOT using multi-audio mode (multi-audio supports seamless switching)
        const isUsingMultiAudio = isUsingMultiAudioRef.current;

        if (previousIndex !== null && previousIndex !== newIndex && hasStablePlaybackRef.current && !isUsingMultiAudio) {
          // Map react-native-video track index to Jellyfin stream index
          const jellyfinStreamIndex = audioTrackMappingRef.current[newIndex];

          if (jellyfinStreamIndex !== undefined) {
            logger.info("🔄 Audio track changed by user - triggering restart", {
              service: "useVideoPlayback",
              previousIndex,
              newIndex,
              jellyfinStreamIndex,
              newLanguage: selectedTrack.language,
              newTitle: selectedTrack.title,
            });

            // Trigger audio track switch with restart (using Jellyfin stream index)
            handleAudioTrackSwitch(jellyfinStreamIndex);

            // CRITICAL: Return early to prevent updating selectedAudioTrackIndexRef
            // The ref now holds the Jellyfin stream index and must not be overwritten
            return;
          } else {
            logger.warn("⚠️ Could not map audio track index to Jellyfin stream index", {
              service: "useVideoPlayback",
              trackIndex: newIndex,
              mappingSize: audioTrackMappingRef.current.length,
            });
          }
        } else if (isUsingMultiAudio && previousIndex !== null && previousIndex !== newIndex) {
          // In multi-audio mode, track switch is seamless - just log it
          logger.info("🎵 Audio track switched seamlessly (no restart needed)", {
            service: "useVideoPlayback",
            previousIndex,
            newIndex,
            newLanguage: selectedTrack.language,
            newTitle: selectedTrack.title,
          });
        }

        // Only update the ref if we're in multi-audio mode (not during restart)
        // During restart, selectedAudioTrackIndexRef holds the Jellyfin stream index
        if (selectedAudioTrackIndexRef.current === null || data.audioTracks.length > 1) {
          selectedAudioTrackIndexRef.current = newIndex;
          logger.debug("🔹 Updated audio track ref", {
            service: "useVideoPlayback",
            newIndex,
            isMultiAudio: data.audioTracks.length > 1,
          });
        }
      }
    },
    [handleAudioTrackSwitch],
  );

  // Callback: Text tracks (subtitles) discovered
  const onTextTracks = useCallback((data: { textTracks: TextTrack[] }) => {
    if (!isMountedRef.current) return;

    // Deduplicate logs
    const trackSignature = `${data.textTracks.length}`;
    if (trackSignature !== lastLoggedTextTracksRef.current) {
      lastLoggedTextTracksRef.current = trackSignature;
      logger.debug("📝 Subtitles", {
        service: "useVideoPlayback",
        count: data.textTracks.length,
      });
    }
  }, []);

  /**
   * Setup and cleanup on mount/unmount
   */
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      // Clear timers
      if (autoPlayTimerRef.current) {
        clearTimeout(autoPlayTimerRef.current);
        autoPlayTimerRef.current = null;
      }
      if (stablePlaybackTimerRef.current) {
        clearTimeout(stablePlaybackTimerRef.current);
        stablePlaybackTimerRef.current = null;
      }

      // Stop playback on unmount
      setPaused(true);
    };
  }, [videoId]);

  /**
   * Reset state when video ID changes
   */
  useEffect(() => {
    // Increment request ID to invalidate any in-flight async operations
    requestIdRef.current += 1;

    // Clear any pending timers
    if (autoPlayTimerRef.current) {
      clearTimeout(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
    if (stablePlaybackTimerRef.current) {
      clearTimeout(stablePlaybackTimerRef.current);
      stablePlaybackTimerRef.current = null;
    }

    dispatch({ type: "RETRY" });
    setVideoDetails(null);
    setStreamUrl(null);
    setHasTriedTranscoding(false);
    setHasTriedCredentialRefresh(false);
    setHasTriedSeekRecovery(false);
    hasTriedResumeFallbackRef.current = false;
    resumePositionForFallbackRef.current = null;
    setHasStablePlayback(false);
    hasStablePlaybackRef.current = false;
    autoPlayTriggeredRef.current = false;
    isSeekingRef.current = false;
    lastStatusChangeRef.current = 0;
    currentModeRef.current = "direct";
    seekToPositionAfterLoadRef.current = null;
    startTimeTicksRef.current = null;
    mediaSourceIdRef.current = null; // PlaySessionId rotates in the CREATING_STREAM effect
    wasPlayedAtStartRef.current = null; // re-captured on the new video's first metadata fetch
    selectedAudioTrackIndexRef.current = null;
    burnInSubtitleIndexRef.current = null;
    audioTrackMappingRef.current = [];
    isUsingMultiAudioRef.current = false;
  }, [videoId]);

  /**
   * Start metadata fetch when in IDLE or FETCHING_METADATA state
   */
  useEffect(() => {
    if (state.type === "IDLE") {
      dispatch({ type: "FETCH_METADATA" });
    } else if (state.type === "FETCHING_METADATA") {
      fetchMetadata();
    }
  }, [state.type, fetchMetadata]);

  /**
   * Handle retry with transcoding when direct play fails
   */
  useEffect(() => {
    if (state.type !== "ERROR" || !state.canRetryWithTranscode || !isMountedRef.current) return;

    // Don't auto-retry if error message suggests file is corrupted
    const isCorruptedFile = state.error.includes("corrupted") || state.error.includes("HostFunction") || state.error.includes("invalid");

    if (isCorruptedFile) {
      logger.warn("File appears corrupted, skipping auto-retry with transcoding", { service: "useVideoPlayback" });
      // Don't auto-retry, let user manually retry or go back
      return;
    }

    // Note: Already logged in player error handler above
    setHasTriedTranscoding(true);
    autoPlayTriggeredRef.current = false;
    isPlayingRef.current = false;

    // Clear streamUrl to unmount Video component during retry
    // This prevents the old URL from firing additional errors
    setStreamUrl(null);

    // Auto-retry with transcoding
    const retryTimer = setTimeout(() => {
      if (isMountedRef.current) {
        dispatch({ type: "RETRY_WITH_TRANSCODE" });
      }
    }, 500);

    return () => clearTimeout(retryTimer);
  }, [state]);

  /**
   * Playback control functions
   */
  const play = useCallback(() => {
    setPaused(false);
    reportPauseChange(false);
  }, [reportPauseChange]);

  const pause = useCallback(() => {
    setPaused(true);
    reportPauseChange(true);
  }, [reportPauseChange]);

  /**
   * Retry playback from the beginning
   */
  const retry = useCallback(() => {
    // Clear any pending timers
    if (autoPlayTimerRef.current) {
      clearTimeout(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
    if (stablePlaybackTimerRef.current) {
      clearTimeout(stablePlaybackTimerRef.current);
      stablePlaybackTimerRef.current = null;
    }

    setHasTriedTranscoding(false);
    setHasTriedSeekRecovery(false);
    hasTriedResumeFallbackRef.current = false;
    resumePositionForFallbackRef.current = null;
    startTimeTicksRef.current = null;
    setHasStablePlayback(false);
    hasStablePlaybackRef.current = false;
    autoPlayTriggeredRef.current = false;
    isPlayingRef.current = false;
    dispatch({ type: "RETRY" });
  }, []);

  /**
   * Compute UI state from state machine
   */
  // Check if current video is audio-only
  const isAudioOnlyFile = videoDetails ? isAudioOnly(videoDetails) : false;

  const isLoading =
    state.type === "FETCHING_METADATA" || state.type === "CREATING_STREAM" || state.type === "INITIALIZING_PLAYER" || state.type === "READY" || (state.type === "PLAYING" && !hasStablePlayback);

  const showLoadingOverlay = isLoading;

  /**
   * Video callbacks object for Video component props
   */
  const videoCallbacks = useMemo(
    () => ({
      onLoad,
      onProgress,
      onError,
      onEnd,
      onAudioTracks,
      onTextTracks,
    }),
    [onLoad, onProgress, onError, onEnd, onAudioTracks, onTextTracks],
  );

  return {
    videoRef,
    sourceUri: streamUrl,
    paused,
    videoCallbacks,
    state,
    videoDetails,
    isAudioOnly: isAudioOnlyFile,
    isLoading,
    showLoadingOverlay,
    play,
    pause,
    retry,
  };
}
