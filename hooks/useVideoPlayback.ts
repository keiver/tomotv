import { useEffect, useState, useMemo, useRef, useCallback, useReducer } from "react";
import type { VideoRef, OnLoadData, OnProgressData, OnVideoErrorData, AudioTrack, TextTrack } from "react-native-video";
import { InteractionManager } from "react-native";
import {
  fetchVideoDetails,
  needsTranscoding,
  isAudioOnly,
  getTextSubtitleStreams,
  getBurnInSubtitleStream,
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
import { audioPlayerManager } from "@/services/audioPlayerManager";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { prepareMultiAudioPlayback, shouldUseMultiAudio, isMultiAudioAvailable, getAudioTracks } from "@/services/multiAudioLoader";
import { canRemuxLocally, localRemuxToken, startLocalRemux, stopLocalRemux } from "@/services/localRemux";
import { setPlaybackProbeEnabled, probeEmit, probeProgress } from "@/services/playbackProbe";
import { PlaybackErrorType, classifyPlaybackError, getPlaybackErrorMessage } from "@/utils/errorClassification";

// Classification moved to utils/errorClassification.ts so non-player code
// (library, search) can share it; re-exported to keep existing call sites.
export { PlaybackErrorType, classifyPlaybackError, getPlaybackErrorMessage };

// "localRemux": the file is rewrapped on-device and served over loopback HLS
// (services/localRemux.ts). Like direct play it carries the original video
// bits and uses client-side seeking; unlike it, the container is repackaged so
// AVPlayer will accept it.
export type PlaybackMode = "direct" | "transcode" | "localRemux";

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
  /**
   * Resume state the launching screen already displayed (Continue Watching row).
   * Trusted over the details refetch: the item endpoint can answer with
   * stale/contradictory UserData, wiping a real resume point (2026-08-05).
   */
  startPositionTicks?: number;
  playedAtStart?: boolean;
  onPlaybackEnd?: () => void;
  /** Regression-suite deep links pass probe=1; records playback events for the driver (dev-only). */
  probe?: boolean;
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
    onSeek: () => void;
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
  seekBy: (offsetSeconds: number) => void;

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
      // Both direct play and a local remux fall back to the server transcode once;
      // onError marks a failed localRemux as spent so the retry can't loop on it.
      const canRetry = (action.mode === "direct" || action.mode === "localRemux") && !action.hasTriedTranscode;
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
  const { videoId, startPositionTicks, playedAtStart, onPlaybackEnd, probe } = config;

  // State machine
  const [state, dispatch] = useReducer(videoPlayerReducer, { type: "IDLE" });

  // Arm before the state machine's first FETCH_METADATA effect fires (the actual
  // fetch happens one render pass later, so any first-pass effect is early enough).
  useEffect(() => {
    setPlaybackProbeEnabled(probe === true, videoId);
  }, [probe, videoId]);

  // Persistent data across states
  const [videoDetails, setVideoDetails] = useState<JellyfinVideoItem | null>(null);
  const [hasTriedTranscoding, setHasTriedTranscoding] = useState(false);
  const [hasTriedCredentialRefresh, setHasTriedCredentialRefresh] = useState(false);
  const [hasTriedSeekRecovery, setHasTriedSeekRecovery] = useState(false);

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
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Status tracking (for debouncing rapid status changes)
  const isSeekingRef = useRef(false);
  const lastStatusChangeRef = useRef<number>(0);
  const hasStablePlaybackRef = useRef(false); // Ref for sync access in handlers

  // Playback mode & callbacks (avoid stale closures in event listeners)
  const currentModeRef = useRef<PlaybackMode>("direct");
  const onPlaybackEndRef = useRef(onPlaybackEnd);
  useEffect(() => {
    onPlaybackEndRef.current = onPlaybackEnd;
  }, [onPlaybackEnd]);

  // Track stable playback for UI (state triggers re-renders, ref is for sync checks)
  const [hasStablePlayback, setHasStablePlayback] = useState(false);

  /**
   * Playback state that callbacks below mutate. Declared ahead of every
   * callback that touches it: a ref referenced before its useRef line is
   * opaque to the React Compiler, which then flags each write as mutating a
   * frozen value and bails out of memoizing the hook.
   */
  const [paused, setPaused] = useState(true); // Start paused, will auto-play on load
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const isPlayingRef = useRef(false);

  // Ref mirror of `paused` for native callbacks that fire outside the render cycle
  const pausedRef = useRef(true);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Audio track state (for tracking selected track)
  const selectedAudioTrackIndexRef = useRef<number | null>(null);

  // Jellyfin stream index of the audio actually playing. selectedAudioTrackIndexRef
  // can't serve this role: after load it holds the PLAYER-side sequential index
  // (0, 1, …) for change detection, which is not a Jellyfin stream index. This one
  // feeds the server reports (AudioStreamIndex) and, on localRemux rebuilds, the
  // preferred-track ordering — so error-recovery restarts keep the user's track.
  const audioStreamIndexForReportingRef = useRef<number | null>(null);

  // Image-based subtitle stream index to burn in during transcoding (PGS/DVDSUB)
  const burnInSubtitleIndexRef = useRef<number | null>(null);

  // Store mapping from react-native-video track index to Jellyfin stream index
  const audioTrackMappingRef = useRef<number[]>([]);

  // Position to seek to after video restart (for audio track switching)
  const seekToPositionAfterLoadRef = useRef<number | null>(null);

  // Target of an in-flight auto-seek. While set, the reporter must not sample the
  // player clock: during the seek's buffering the clock still reads ~0, and one poll
  // tick reporting it would overwrite the seeded resume position (a back-out in that
  // window would then send Stopped(~0) and the server would wipe the resume point).
  const pendingSeekTargetRef = useRef<number | null>(null);

  // Track if currently using multi-audio mode
  const isUsingMultiAudioRef = useRef<boolean>(false);

  // Token of the on-device remux session THIS player instance started. Per
  // instance on purpose: two players are briefly mounted at once during a
  // screen transition, so shared state here makes one player's teardown kill
  // the other's session.
  const localRemuxTokenRef = useRef<string | null>(null);

  // Track last logged state for deduplication
  const lastLoggedAudioTracksRef = useRef<string>("");
  const lastLoggedTextTracksRef = useRef<string>("");

  /**
   * Step 1: Fetch video metadata and determine playback mode
   */
  const fetchMetadata = useCallback(async () => {
    // Capture current request ID to check for stale responses
    const currentRequestId = requestIdRef.current;

    logger.debug("Fetching video details", { service: "useVideoPlayback", videoId, requestId: currentRequestId });

    // One player at a time: starting any video ends background music. No-op
    // when the audio queue is idle (covers mid-item restarts too).
    void audioPlayerManager.stop();

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
        wasPlayedAtStartRef.current = playedAtStart ?? details.UserData?.Played ?? false;
      }

      // Check if this is an audio-only file
      const audioOnly = isAudioOnly(details);
      if (audioOnly) {
        logger.debug("Audio-only file detected - will use direct play", { service: "useVideoPlayback" });
      }

      // Check codec compatibility (skip for audio-only files)
      const requiresTranscoding = audioOnly ? false : needsTranscoding(details);

      // Text subtitles (external sidecars AND embedded streams). Their presence
      // is a reason to leave direct play: AVPlayer needs them offered as HLS
      // renditions, which only the remux/transcode paths build.
      const textSubtitles = getTextSubtitleStreams(details);
      const hasTextSubs = textSubtitles.length > 0;

      // Subtitles that require server-side burn-in: image-based only (AVPlayer has
      // no bitmap renderer). Text tracks, forced or not, ride as HLS renditions.
      const burnInStream = audioOnly ? null : getBurnInSubtitleStream(details);
      burnInSubtitleIndexRef.current = burnInStream?.Index ?? null;

      // Determine playback mode - force transcode on retry
      let selectedMode: PlaybackMode = "direct";

      // A file that cannot direct-play, whose video AVPlayer can actually
      // decode, is rewrapped on-device instead: original quality, native
      // controls, no server transcode session. Burn-in files are excluded
      // inside canRemuxLocally() so their server path is untouched; multi-audio
      // files are NOT excluded — each extra track becomes its own HLS audio
      // rendition. Skipped entirely once a transcode retry is in play.
      //
      // The gate must mirror EVERY reason the branch below leaves direct play,
      // or a file gets pushed to the server for a reason the engine could have
      // handled. hasTextSubs was missed originally, which sent every H.264 MP4
      // with a sidecar .srt to SubtitleMethod=Hls — where Jellyfin stamps
      // X-TIMESTAMP-MAP=MPEGTS:900000 (10s) on WebVTT that fMP4 segments
      // starting at 0 do not match, displacing every cue by 10 seconds.
      const canRemux = !audioOnly && (requiresTranscoding || hasTextSubs) && !hasTriedTranscoding && (await canRemuxLocally(details, burnInStream !== null));

      if (canRemux) {
        selectedMode = "localRemux";
        logger.info("Codec supported in another container, remuxing on device", {
          service: "useVideoPlayback",
          codec: details.MediaStreams?.find((stream) => stream.Type === "Video")?.Codec,
          container: details.MediaSources?.[0]?.Container,
        });
      } else if (requiresTranscoding || hasTextSubs || burnInStream !== null || hasTriedTranscoding) {
        selectedMode = "transcode";

        if (requiresTranscoding) {
          logger.info("Codec not supported, using transcoding", { service: "useVideoPlayback" });
        }
        if (hasTextSubs) {
          // Fallback only: the remux engine could not take this file. The server
          // session switches to MPEG-TS segments (getTranscodingStreamUrl) so
          // Jellyfin's WebVTT renditions and their 10s X-TIMESTAMP-MAP stay
          // aligned; fMP4 would run the cues 10 seconds late.
          logger.warn("Text subtitles on the server HLS path (TS segments)", {
            service: "useVideoPlayback",
            subtitleCount: textSubtitles.length,
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

      // Resume position: the caller-provided ticks (what the launching screen
      // displayed) win over the refetched UserData — only if no other seek is pending
      if (seekToPositionAfterLoadRef.current === null && startPositionTicks && startPositionTicks > 0) {
        const resumePosition = startPositionTicks / JELLYFIN_TIME.TICKS_PER_SECOND;
        seekToPositionAfterLoadRef.current = resumePosition;
        logger.info("Resuming from caller-provided position", {
          service: "useVideoPlayback",
          position: resumePosition,
          mode: selectedMode,
        });
      }

      // Server-side resume position from item UserData (populated because
      // fetchVideoDetails requests EnableUserData=true) — only if no other seek is pending
      if (seekToPositionAfterLoadRef.current === null) {
        const resumeTicks = details.UserData?.PlaybackPositionTicks;
        if (resumeTicks && resumeTicks > 0) {
          const resumePosition = resumeTicks / JELLYFIN_TIME.TICKS_PER_SECOND;
          // Client-side seek for every mode. StartTimeTicks is deliberately not
          // used: with fMP4 segments (required for HEVC stream copy) Jellyfin
          // answers the EXT-X-MAP init segment with HTTP 400 whenever
          // StartTimeTicks is set, so every resumed transcode would fail its
          // first load and only recover on retry. Seeking client-side costs the
          // server nothing extra — the VOD playlist lists the whole file, so
          // AVPlayer just requests the segment at the resume point.
          seekToPositionAfterLoadRef.current = resumePosition;
          logger.info("Resuming video from server position", {
            service: "useVideoPlayback",
            position: resumePosition,
            mode: selectedMode,
          });
        }
      }

      // Update mode ref before dispatch (for event listener closures)
      currentModeRef.current = selectedMode;

      probeEmit("mode", { mode: selectedMode, requiresTranscoding, hasTextSubs, burnIn: burnInStream !== null });

      dispatch({
        type: "METADATA_FETCHED",
        details,
        mode: selectedMode,
        hasSubtitles: hasTextSubs || burnInStream !== null,
      });

      if (selectedMode === "transcode") {
        setHasTriedTranscoding(true);
      }
    } catch (err) {
      logger.error("Error fetching metadata", err, { service: "useVideoPlayback", videoId });

      // Classify error and provide user-friendly message
      const errorType = classifyPlaybackError(err);
      const errorMessage = getPlaybackErrorMessage(errorType);

      probeEmit("error", { mode: "metadata", message: String(err), willRetry: false });

      // Terminal, whatever hasTriedTranscoding says. The transcode retry exists for a stream
      // that failed to PLAY; here nothing was fetched, so it re-runs this identical request and
      // fails identically, costing a second round trip and a spinner in front of the error. The
      // flag also keeps the auto-retry effect from setting hasTriedTranscoding, so the Retry
      // button still gets a clean direct-play attempt rather than a forced server transcode.
      dispatch({
        type: "PLAYER_ERROR",
        error: { message: errorMessage },
        mode: "direct",
        hasTriedTranscode: true,
      });
    }
  }, [videoId, startPositionTicks, playedAtStart, hasTriedTranscoding]);

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

      // Store selected audio track for URL generation and server reporting
      selectedAudioTrackIndexRef.current = newTrackIndex;
      audioStreamIndexForReportingRef.current = newTrackIndex;
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
            const baseUrl = await getTranscodingStreamUrl(videoId, details, undefined, undefined, undefined, undefined);

            // Then prepare multi-audio playback with custom protocol
            const cachedConfig = await getConfig();

            url = await prepareMultiAudioPlayback(videoId, details, baseUrl, cachedConfig.apiKey);

            // SET REF: We're using multi-audio mode
            isUsingMultiAudioRef.current = true;
          } else {
            // Regular transcoding
            // Pass selected audio track index if available
            const audioStreamIndex = selectedAudioTrackIndexRef.current ?? undefined;
            url = await getTranscodingStreamUrl(videoId, details, audioStreamIndex, undefined, burnInSubtitleIndexRef.current ?? undefined, playSessionIdRef.current);

            // CLEAR REF: Not using multi-audio
            isUsingMultiAudioRef.current = false;

            if (hasSelectedAudioTrack) {
              logger.info("🎯 Using single-track Jellyfin URL after restart", {
                service: "useVideoPlayback",
                audioStreamIndex,
              });
            }
          }
        } else if (mode === "localRemux") {
          // Rewrap on device and play the loopback HLS URL. A failure here is
          // not fatal: fall through to the server transcode the file would
          // have used anyway.
          isUsingMultiAudioRef.current = false;
          try {
            // The playing track's Jellyfin index must reach the remux engine:
            // it orders the HLS renditions so that track is DEFAULT=YES. In-
            // playback switches are seamless (AVPlayer swaps renditions, no
            // rebuild) — this matters for rebuilds (error recovery, seek
            // recovery), which would otherwise revert to Jellyfin's default.
            url = await startLocalRemux(details, audioStreamIndexForReportingRef.current ?? undefined);
            // This player instance owns that session. Kept in a ref so unmount
            // tears down ITS session, never one a newer player has started.
            localRemuxTokenRef.current = localRemuxToken(url);
          } catch (remuxError) {
            logger.warn("Local remux failed, falling back to server transcode", remuxError, {
              service: "useVideoPlayback",
              videoId,
            });
            probeEmit("fallback", { from: "localRemux", to: "transcode", reason: String(remuxError) });
            currentModeRef.current = "transcode";
            setHasTriedTranscoding(true);
            url = await getTranscodingStreamUrl(videoId, details, undefined, undefined, undefined, playSessionIdRef.current);
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
          // Distinct facts: how many tracks are being served, and whether the
          // server-side custom-protocol path is the one serving them. Reporting
          // only the latter as "isMultiAudio" read as false for local remux
          // even when it was serving several tracks.
          audioTrackCount: details ? getAudioTracks(details).length : 0,
          multiAudioProtocol: url.includes("jellyfin-multi://"),
        });

        if (!url) {
          throw new Error("Failed to generate stream URL");
        }

        setStreamUrl(url);
        probeEmit("stream", { mode: currentModeRef.current, url });
        dispatch({ type: "STREAM_CREATED", streamUrl: url });

        // Both HLS paths expose several audio tracks to the player, so both need
        // the index mapping below. Local remux was previously excluded, leaving
        // the mapping empty: switching audio then warned and reported no
        // AudioStreamIndex to the server, so its session view showed the wrong
        // track.
        if ((mode === "transcode" || mode === "localRemux") && details) {
          const subtitles = getTextSubtitleStreams(details);
          const audioTracks = getAudioTracks(details);

          // Build mapping from react-native-video track index to Jellyfin stream index
          // This is needed because react-native-video uses sequential indices (0, 1, 2...)
          // but Jellyfin uses actual stream indices (1, 8, etc.)
          // CRITICAL: the order must match what was handed to the native side —
          // prepareMultiAudioPlayback() for transcode, startLocalRemux() for
          // local remux. Both sort default-first (what getAudioTracks returns),
          // except a local remux carrying a playing-track preference, which
          // moves that track to position 0 — mirror that here or the next
          // switch would map to the wrong stream.
          if (details.MediaStreams && audioTracks.length > 0) {
            const preferredAudioIndex = mode === "localRemux" ? audioStreamIndexForReportingRef.current : null;
            const orderedTracks = preferredAudioIndex === null ? audioTracks : [...audioTracks].sort((a, b) => Number(b.Index === preferredAudioIndex) - Number(a.Index === preferredAudioIndex));
            audioTrackMappingRef.current = orderedTracks.map((track) => track.Index);
            // First report of a fresh session: the DEFAULT track (position 0)
            // is what plays until the user switches.
            if (audioStreamIndexForReportingRef.current === null) {
              audioStreamIndexForReportingRef.current = audioTrackMappingRef.current[0] ?? null;
            }
            logger.debug("Built audio track mapping", {
              service: "useVideoPlayback",
              mapping: audioTrackMappingRef.current,
              tracks: orderedTracks.map((t) => `${t.Language || "und"} (stream ${t.Index})`).join(", "),
            });
          }

          if (subtitles.length > 0 || audioTracks.length > 0) {
            logger.debug("Available tracks in HLS stream", {
              service: "useVideoPlayback",
              subtitleCount: subtitles.length,
              audioTrackCount: audioTracks.length,
              subtitleLanguages: subtitles.map((s) => s.Language || "und").join(", "),
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

  // Server playback reporting (Sessions/Playing*) — decoupled from playback state machine
  const { markStarted, markEnded, reportPauseChange, resetSession } = usePlaybackReporter({
    videoId,
    videoRef,
    durationRef,
    mediaSourceIdRef,
    playSessionIdRef,
    isPlayingRef,
    currentModeRef,
    audioStreamIndexRef: audioStreamIndexForReportingRef,
    wasPlayedAtStartRef,
    positionSecondsRef: currentTimeRef,
    pendingSeekTargetRef,
  });
  // Synced post-commit; safe because every reader (stream-rotation effect,
  // unmount cleanup) runs at least one commit after mount, and CREATING_STREAM
  // is never the first committed state.
  useEffect(() => {
    resetPlaybackSessionRef.current = resetSession;
  }, [resetSession]);

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

        // Small delay to ensure player is ready for seek. Tracked + mount-guarded like
        // autoPlayTimerRef: an orphaned firing after unmount would markStarted() and POST
        // a Playing report the cleanup's Stopped already closed out.
        if (seekTimerRef.current) {
          clearTimeout(seekTimerRef.current);
        }
        seekTimerRef.current = setTimeout(() => {
          seekTimerRef.current = null;
          if (!isMountedRef.current) return;
          pendingSeekTargetRef.current = seekPosition; // Mute reporter sampling until the seek settles
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
      probeProgress(data.currentTime);

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
    [paused],
  );

  // Callback: Video playback ended
  const onEnd = useCallback(() => {
    if (!isMountedRef.current) return;

    logger.info("Video playback ended, triggering callback", { service: "useVideoPlayback" });

    probeEmit("ended");

    // Mark video as ended — clears saved progress
    markEnded();

    InteractionManager.runAfterInteractions(() => {
      if (!isMountedRef.current) return;
      onPlaybackEndRef.current?.();
    });
  }, [markEnded]);

  // Callback: Video error
  const onError = useCallback(
    (error: OnVideoErrorData) => {
      if (!isMountedRef.current) return;

      const currentMode = currentModeRef.current;
      // Extract error message from react-native-video error object
      const originalMessage = error.error?.localizedDescription || error.error?.errorString || String(error.error || "");
      // A local remux that fails mid-playback (bad fragment, stalled pipeline)
      // retries on the server exactly like a failed direct play does.
      const willRetryWithTranscode = (currentMode === "direct" || currentMode === "localRemux") && !hasTriedTranscoding;

      // Mark the fallback as spent up front for a failed local remux.
      // Otherwise the retry re-evaluates the same file, still picks localRemux
      // (nothing has recorded that it failed), and loops on the same error
      // instead of reaching the server.
      if (currentMode === "localRemux" && willRetryWithTranscode) {
        logger.warn("Local remux errored mid-playback, retrying on the server", {
          service: "useVideoPlayback",
          message: originalMessage,
        });
        setHasTriedTranscoding(true);
      }

      // Classify error first to determine if it's a 401
      const errorType = classifyPlaybackError(error.error);

      probeEmit("error", { mode: currentMode, message: originalMessage, willRetry: willRetryWithTranscode });

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

        logger.info("Seek crash detected during transcode, attempting recovery", {
          service: "useVideoPlayback",
          lastPositionSec,
        });

        setHasTriedSeekRecovery(true);
        // Client-side seek after reload, for the same reason as resume above:
        // StartTimeTicks + fMP4 makes Jellyfin reject the init segment.
        seekToPositionAfterLoadRef.current = lastPositionSec;

        // Reset playback state for the recovery attempt
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
        // 4. NOT a seamless mode: the multi-audio protocol and local remux both
        //    serve every track as an HLS rendition, so AVPlayer has ALREADY
        //    switched by the time this fires — restarting would only add a
        //    spinner (and, for local remux, rebuild the stream for nothing).
        //    Only the plain Jellyfin transcode (one audio track per manifest)
        //    needs the restart with AudioStreamIndex.
        const isUsingMultiAudio = isUsingMultiAudioRef.current;
        const isSeamlessMode = isUsingMultiAudio || currentModeRef.current === "localRemux";

        if (previousIndex !== null && previousIndex !== newIndex && hasStablePlaybackRef.current && !isSeamlessMode) {
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
        } else if (isSeamlessMode && previousIndex !== null && previousIndex !== newIndex) {
          // Seamless switch: AVPlayer already swapped renditions. Record the
          // Jellyfin index so server reports (and any later localRemux rebuild)
          // carry the track that is actually playing.
          const jellyfinStreamIndex = audioTrackMappingRef.current[newIndex];
          if (jellyfinStreamIndex !== undefined) {
            audioStreamIndexForReportingRef.current = jellyfinStreamIndex;
          }
          logger.info("🎵 Audio track switched seamlessly (no restart needed)", {
            service: "useVideoPlayback",
            previousIndex,
            newIndex,
            jellyfinStreamIndex,
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
      if (seekTimerRef.current) {
        clearTimeout(seekTimerRef.current);
        seekTimerRef.current = null;
      }

      // Stop playback on unmount
      setPaused(true);

      // Tear down THIS player's remux session so its pipeline thread and cached
      // segments don't outlive the screen. The token is per-instance: during a
      // screen transition two players are briefly mounted at once, and passing
      // anything shared here would stop the incoming player's session instead.
      stopLocalRemux(localRemuxTokenRef.current);
      localRemuxTokenRef.current = null;
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
    if (seekTimerRef.current) {
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
    }

    dispatch({ type: "RETRY" });
    // Queue advance (videoId swap without remount) must wipe the old item's
    // state in the same commit, or the new video's first render leaks the
    // previous stream URL and details. Deliberate synchronous cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVideoDetails(null);
    setStreamUrl(null);
    setHasTriedTranscoding(false);
    setHasTriedCredentialRefresh(false);
    setHasTriedSeekRecovery(false);
    setHasStablePlayback(false);
    hasStablePlaybackRef.current = false;
    autoPlayTriggeredRef.current = false;
    isSeekingRef.current = false;
    lastStatusChangeRef.current = 0;
    // The reporter reads this as its live position source — without the reset a queue
    // advance would stamp the new video's first reports with the previous video's clock.
    currentTimeRef.current = 0;
    currentModeRef.current = "direct";
    seekToPositionAfterLoadRef.current = null;
    pendingSeekTargetRef.current = null;
    mediaSourceIdRef.current = null; // PlaySessionId rotates in the CREATING_STREAM effect
    wasPlayedAtStartRef.current = null; // re-captured on the new video's first metadata fetch
    selectedAudioTrackIndexRef.current = null;
    audioStreamIndexForReportingRef.current = null;
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
      // The machine's driver: entering a state triggers its async work, whose
      // completion dispatches the next state. The cascade is the design.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // Must land in this commit: setStreamUrl(null) below unmounts the Video
    // component immediately so the failed URL cannot fire further errors.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Relative seek for remote-driven skips (tvOS audio-only: AVKit's audio presentation
  // exposes no focusable UI, so left/right remote events must seek from JS).
  const seekBy = useCallback((offsetSeconds: number) => {
    const duration = durationRef.current;
    if (duration <= 0) return; // not loaded yet
    const target = Math.max(0, Math.min(duration - 1, currentTimeRef.current + offsetSeconds));
    // Optimistic update so rapid presses accumulate instead of seeking from a stale position
    currentTimeRef.current = target;
    videoRef.current?.seek(target);
  }, []);

  // With controls={true}, react-native-video's programmatic seek pauses the player
  // internally, mis-latches that pause as user intent (_paused), and re-applies it when
  // the seek completes — permanently stalling playback. onSeek fires after that re-apply
  // in the same native completion (RCTVideo.swift setSeek), so reasserting our intent
  // here always lands last. A seek issued while genuinely paused stays paused.
  const onSeek = useCallback(() => {
    // Seek completed — the player clock is trustworthy again for the reporter.
    pendingSeekTargetRef.current = null;
    if (!pausedRef.current) {
      videoRef.current?.resume();
    }
  }, []);

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
      onSeek,
      onAudioTracks,
      onTextTracks,
    }),
    [onLoad, onProgress, onError, onEnd, onSeek, onAudioTracks, onTextTracks],
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
    seekBy,
    retry,
  };
}
