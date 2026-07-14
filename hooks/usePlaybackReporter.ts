import { useEffect, useRef, useCallback } from "react";
import { AppState, AppStateStatus } from "react-native";
import type { VideoRef } from "react-native-video";
import { JELLYFIN_TIME, PlaybackReportBody, reportPlaybackProgress, reportPlaybackStart, reportPlaybackStopped } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";

const POLL_INTERVAL_MS = 8_000;
const MIN_REPORT_DELTA_SECONDS = 5;

interface UsePlaybackReporterConfig {
  videoId: string;
  videoRef: React.RefObject<VideoRef | null>;
  durationRef: React.RefObject<number>;
  mediaSourceIdRef: React.RefObject<string | null>;
  playSessionIdRef: React.RefObject<string>;
  isPlayingRef: React.RefObject<boolean>;
  currentModeRef: React.RefObject<"direct" | "transcode">;
  audioStreamIndexRef: React.RefObject<number | null>;
}

interface UsePlaybackReporterResult {
  markStarted: (positionTicks?: number) => void;
  markEnded: () => void;
  reportPauseChange: (paused: boolean) => void;
  resetSession: () => void;
}

/**
 * Reports playback to the Jellyfin server (POST /Sessions/Playing[/Progress|/Stopped])
 * so the server tracks resume positions, played state, and active sessions — the
 * standard Jellyfin client contract. Replaces the old local watch-progress file.
 * All reports are fire-and-forget; a failed ping never affects playback.
 *
 * Lifecycle:
 * - markStarted(ticks): call once auto-play begins — POSTs Playing.
 * - 8-second polling loop: samples videoRef.getCurrentPosition() and POSTs Progress
 *   while the position advances (skips paused/buffering ticks and < 5s deltas).
 * - reportPauseChange(paused): immediate Progress with IsPaused, on user play/pause.
 * - markEnded(): POSTs Stopped at full duration — the server marks the item played
 *   past its completion threshold and drops it from the resume list.
 * - resetSession(): Stopped for the in-flight session before a mid-item player
 *   remount (audio-track switch, seek recovery); caller regenerates PlaySessionId.
 * - Cleanup on unmount/videoId change: Stopped at the last sampled position (covers
 *   backing out of the player and queue advances, which remount the screen).
 * - AppState: backgrounding reports Progress with IsPaused=true; foregrounding
 *   reports resumed if the player is still playing.
 */
export function usePlaybackReporter({ videoId, videoRef, durationRef, mediaSourceIdRef, playSessionIdRef, isPlayingRef, currentModeRef, audioStreamIndexRef }: UsePlaybackReporterConfig): UsePlaybackReporterResult {
  const lastReportedPositionRef = useRef(0);
  const lastSampledPositionRef = useRef(0);
  const startedRef = useRef(false);
  const endedRef = useRef(false);

  // Stable ref for videoId — used in callbacks to avoid stale closures
  const videoIdRef = useRef(videoId);
  videoIdRef.current = videoId;

  const buildBody = useCallback(
    (positionSeconds: number, isPaused: boolean): PlaybackReportBody => ({
      ItemId: videoIdRef.current,
      MediaSourceId: mediaSourceIdRef.current ?? videoIdRef.current,
      PlaySessionId: playSessionIdRef.current,
      PositionTicks: Math.round(positionSeconds * JELLYFIN_TIME.TICKS_PER_SECOND),
      IsPaused: isPaused,
      PlayMethod: currentModeRef.current === "transcode" ? "Transcode" : "DirectStream",
      AudioStreamIndex: audioStreamIndexRef.current ?? undefined,
      CanSeek: true,
    }),
    [mediaSourceIdRef, playSessionIdRef, currentModeRef, audioStreamIndexRef],
  );

  // Reset state when videoId changes
  useEffect(() => {
    lastReportedPositionRef.current = 0;
    lastSampledPositionRef.current = 0;
    startedRef.current = false;
    endedRef.current = false;
  }, [videoId]);

  // Polling loop
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!startedRef.current || endedRef.current) return;

      try {
        const position = await videoRef.current?.getCurrentPosition();
        if (position == null || position <= 0) return;

        // Not advancing — player is paused or buffering (pause state was already
        // reported immediately via reportPauseChange)
        if (position === lastSampledPositionRef.current) return;
        lastSampledPositionRef.current = position;

        // Not enough change since last report — avoid noise
        if (Math.abs(position - lastReportedPositionRef.current) < MIN_REPORT_DELTA_SECONDS) return;

        void reportPlaybackProgress(buildBody(position, !isPlayingRef.current));
        lastReportedPositionRef.current = position;
      } catch {
        // getCurrentPosition can throw if player is disposed — ignore silently
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);

      // Report Stopped on cleanup (back out of the player, queue advance) unless the
      // video ended naturally or a resetSession already closed the session
      if (startedRef.current && !endedRef.current && lastSampledPositionRef.current > 0) {
        void reportPlaybackStopped(buildBody(lastSampledPositionRef.current, false));
      }
    };
  }, [videoId, videoRef, buildBody, isPlayingRef]);

  // Background/foreground: report pause state so the server session stays accurate
  // while tvOS suspends the app (no JS runs once fully suspended, so report early)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (!startedRef.current || endedRef.current) return;
      if (nextAppState.match(/inactive|background/)) {
        void reportPlaybackProgress(buildBody(lastSampledPositionRef.current, true));
      } else if (nextAppState === "active" && isPlayingRef.current) {
        void reportPlaybackProgress(buildBody(lastSampledPositionRef.current, false));
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [buildBody, isPlayingRef]);

  const markStarted = useCallback(
    (positionTicks = 0) => {
      // Idempotent per session: the resume-seek path and the auto-play path can both
      // fire on the same load — only the first should register the session
      if (startedRef.current && !endedRef.current) return;
      startedRef.current = true;
      endedRef.current = false;
      void reportPlaybackStart({ ...buildBody(0, false), PositionTicks: Math.round(positionTicks) });
    },
    [buildBody],
  );

  const reportPauseChange = useCallback(
    (paused: boolean) => {
      if (!startedRef.current || endedRef.current) return;
      void reportPlaybackProgress(buildBody(lastSampledPositionRef.current, paused));
    },
    [buildBody],
  );

  const markEnded = useCallback(() => {
    if (!startedRef.current || endedRef.current) return;
    endedRef.current = true;
    // Report the full duration, not the last 8s sample — guarantees the position is
    // past the server's played threshold so the item is auto-marked played
    const finalPosition = durationRef.current > 0 ? durationRef.current : lastSampledPositionRef.current;
    void reportPlaybackStopped(buildBody(finalPosition, false));
    logger.info("Video ended, Stopped reported", {
      service: "usePlaybackReporter",
      videoId: videoIdRef.current.substring(0, 8),
    });
  }, [buildBody, durationRef]);

  const resetSession = useCallback(() => {
    // Close the in-flight session before a mid-item player remount (the caller
    // regenerates PlaySessionId for the new stream). No-op if playback never started.
    if (startedRef.current && !endedRef.current && lastSampledPositionRef.current > 0) {
      void reportPlaybackStopped(buildBody(lastSampledPositionRef.current, false));
    }
    startedRef.current = false;
    endedRef.current = false;
    lastReportedPositionRef.current = 0;
    lastSampledPositionRef.current = 0;
  }, [buildBody]);

  return { markStarted, markEnded, reportPauseChange, resetSession };
}
