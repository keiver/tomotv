import { useEffect, useRef, useCallback } from "react";
import { AppState, AppStateStatus } from "react-native";
import type { VideoRef } from "react-native-video";
import { JELLYFIN_TIME, PlaybackReportBody, reportPlaybackProgress, reportPlaybackStart, reportPlaybackStopped, updateUserItemData } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";

const POLL_INTERVAL_MS = 8_000;
const MIN_REPORT_DELTA_SECONDS = 5;
// TomoTV's own resume policy (evolved from the old local watchProgressService):
// positions under 2s aren't worth resuming; past 95% the item counts as finished.
// Deliberately NOT mirrors of any Jellyfin server setting.
const MIN_PERSIST_POSITION_SECONDS = 2;
const COMPLETION_THRESHOLD = 0.95;

interface UsePlaybackReporterConfig {
  videoId: string;
  videoRef: React.RefObject<VideoRef | null>;
  durationRef: React.RefObject<number>;
  mediaSourceIdRef: React.RefObject<string | null>;
  playSessionIdRef: React.RefObject<string>;
  isPlayingRef: React.RefObject<boolean>;
  currentModeRef: React.RefObject<"direct" | "transcode">;
  audioStreamIndexRef: React.RefObject<number | null>;
  /** UserData.Played captured at session start (null until first metadata fetch). */
  wasPlayedAtStartRef: React.RefObject<boolean | null>;
}

interface UsePlaybackReporterResult {
  markStarted: (positionTicks?: number) => void;
  markEnded: () => void;
  reportPauseChange: (paused: boolean) => void;
  resetSession: () => void;
}

/**
 * Reports playback to the Jellyfin server (POST /Sessions/Playing[/Progress|/Stopped])
 * so the server tracks active sessions — the standard Jellyfin client contract.
 * All reports are fire-and-forget; a failed ping never affects playback.
 *
 * Resume state is owned by TomoTV, not the Sessions pipeline: the server routes every
 * Sessions report through UpdatePlayState gates (verified in 10.11 source) that discard
 * positions for items shorter than its configured minimum runtime and mis-mark them
 * Played. So each position-bearing report is followed by a verbatim UserData write
 * (updateUserItemData, no server gates) that persists the position whenever it's within
 * TomoTV's resume window (>= 2s and < 95% of duration) and restores the Played flag the
 * item had when the session started.
 *
 * Lifecycle:
 * - markStarted(ticks): call once auto-play begins — POSTs Playing.
 * - 8-second polling loop: samples videoRef.getCurrentPosition(), POSTs Progress while
 *   the position advances (skips paused/buffering ticks and < 5s deltas), then persists
 *   the resume position.
 * - reportPauseChange(paused): immediate Progress with IsPaused + persist, on play/pause.
 * - markEnded(): POSTs Stopped at full duration, NO persist — the server marks the item
 *   played past its completion threshold and drops it from the resume list.
 * - resetSession(): Stopped + persist for the in-flight session before a mid-item player
 *   remount (audio-track switch, seek recovery); caller regenerates PlaySessionId.
 * - Cleanup on unmount/videoId change: Stopped + persist at the last sampled position
 *   (covers backing out of the player and queue advances, which remount the screen).
 * - AppState: backgrounding reports Progress with IsPaused=true + persist; foregrounding
 *   reports resumed if the player is still playing.
 */
export function usePlaybackReporter({
  videoId,
  videoRef,
  durationRef,
  mediaSourceIdRef,
  playSessionIdRef,
  isPlayingRef,
  currentModeRef,
  audioStreamIndexRef,
  wasPlayedAtStartRef,
}: UsePlaybackReporterConfig): UsePlaybackReporterResult {
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

  /**
   * Persist the resume position through the gate-free UserData endpoint when it falls
   * inside TomoTV's resume window. Played is restored to its session-start value: this
   * un-marks the bogus Played the server's gates set on short items mid-play, while
   * preserving a legitimately-watched flag during a partial rewatch.
   */
  const persistResumePosition = useCallback(
    async (positionSeconds: number) => {
      const duration = durationRef.current;
      if (duration <= 0) return;
      if (positionSeconds < MIN_PERSIST_POSITION_SECONDS || positionSeconds / duration >= COMPLETION_THRESHOLD) return;

      await updateUserItemData(videoIdRef.current, {
        PlaybackPositionTicks: Math.round(positionSeconds * JELLYFIN_TIME.TICKS_PER_SECOND),
        Played: wasPlayedAtStartRef.current ?? false,
      });
    },
    [durationRef, wasPlayedAtStartRef],
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

        lastReportedPositionRef.current = position;
        // Sequential: the persist write must land after the Progress report it corrects
        await reportPlaybackProgress(buildBody(position, !isPlayingRef.current));
        await persistResumePosition(position);
      } catch {
        // getCurrentPosition can throw if player is disposed — ignore silently
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);

      // Report Stopped on cleanup (back out of the player, queue advance) unless the video ended
      // naturally or a resetSession already closed the session. Fires even at position 0 (backing
      // out before the first poll tick) so the server session is always closed; persist self-guards
      // the < 2s window, so a 0 here never overwrites an existing resume position.
      if (startedRef.current && !endedRef.current) {
        const position = lastSampledPositionRef.current;
        void (async () => {
          await reportPlaybackStopped(buildBody(position, false));
          await persistResumePosition(position);
        })();
      }
    };
  }, [videoId, videoRef, buildBody, isPlayingRef, persistResumePosition]);

  // Background/foreground: report pause state so the server session stays accurate
  // while tvOS suspends the app (no JS runs once fully suspended, so report early)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (!startedRef.current || endedRef.current) return;
      const position = lastSampledPositionRef.current;
      if (nextAppState.match(/inactive|background/)) {
        void (async () => {
          await reportPlaybackProgress(buildBody(position, true));
          await persistResumePosition(position);
        })();
      } else if (nextAppState === "active" && isPlayingRef.current) {
        void reportPlaybackProgress(buildBody(position, false));
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [buildBody, isPlayingRef, persistResumePosition]);

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
      const position = lastSampledPositionRef.current;
      void (async () => {
        await reportPlaybackProgress(buildBody(position, paused));
        await persistResumePosition(position);
      })();
    },
    [buildBody, persistResumePosition],
  );

  const markEnded = useCallback(() => {
    if (!startedRef.current || endedRef.current) return;
    endedRef.current = true;
    // Report the full duration, not the last 8s sample — guarantees the position is
    // past the server's played threshold so the item is auto-marked played. No persist:
    // the server's Played marking is the correct final state for a finished item.
    const finalPosition = durationRef.current > 0 ? durationRef.current : lastSampledPositionRef.current;
    void reportPlaybackStopped(buildBody(finalPosition, false));
    logger.info("Video ended, Stopped reported", {
      service: "usePlaybackReporter",
      videoId: videoIdRef.current.substring(0, 8),
    });
  }, [buildBody, durationRef]);

  const resetSession = useCallback(() => {
    // Close the in-flight session before a mid-item player remount (the caller regenerates
    // PlaySessionId for the new stream). Fires even at position 0 (remount before the first poll)
    // so the old session is always closed; persist self-guards the < 2s window.
    if (startedRef.current && !endedRef.current) {
      const position = lastSampledPositionRef.current;
      void (async () => {
        await reportPlaybackStopped(buildBody(position, false));
        await persistResumePosition(position);
      })();
    }
    startedRef.current = false;
    endedRef.current = false;
    lastReportedPositionRef.current = 0;
    lastSampledPositionRef.current = 0;
  }, [buildBody, persistResumePosition]);

  return { markStarted, markEnded, reportPauseChange, resetSession };
}
