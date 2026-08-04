import { useEffect, useRef, useCallback } from "react";
import { AppState, AppStateStatus } from "react-native";
import type { VideoRef } from "react-native-video";
import { JELLYFIN_TIME, markItemPlayed, PlaybackReportBody, reportPlaybackProgress, reportPlaybackStart, reportPlaybackStopped, updateUserItemData } from "@/services/jellyfinApi";
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
  currentModeRef: React.RefObject<"direct" | "transcode" | "localRemux">;
  audioStreamIndexRef: React.RefObject<number | null>;
  /** UserData.Played captured at session start (null until first metadata fetch). */
  wasPlayedAtStartRef: React.RefObject<boolean | null>;
  /**
   * Live player clock (seconds), updated by the player's onProgress. Event-driven
   * reports (pause, backgrounding, back-out Stopped) read this instead of waiting on
   * the 8-second poll — a session shorter than the first poll tick used to report
   * position 0, and a Stopped at 0 makes the server WIPE the item's resume point.
   */
  positionSecondsRef: React.RefObject<number>;
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
 * - Cleanup on unmount/videoId change: Stopped + persist at the best-known position — the
 *   live onProgress clock, else the markStarted seed (covers backing out of the player and
 *   queue advances, which remount the screen).
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
  positionSecondsRef,
}: UsePlaybackReporterConfig): UsePlaybackReporterResult {
  const lastReportedPositionRef = useRef(0);
  const lastSampledPositionRef = useRef(0);
  const startedRef = useRef(false);
  const endedRef = useRef(false);

  // Stable ref for videoId — used in callbacks to avoid stale closures
  const videoIdRef = useRef(videoId);
  videoIdRef.current = videoId;

  // Best-known playback position for event-driven reports: the live onProgress clock
  // when it has ticked, else the last poll sample (which markStarted seeds with the
  // resume position, so even an instant back-out reports the position it started at).
  const bestPosition = useCallback(() => {
    const live = positionSecondsRef.current;
    return live > 0 ? live : lastSampledPositionRef.current;
  }, [positionSecondsRef]);

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
      // naturally or a resetSession already closed the session. The server APPLIES the Stopped
      // report's PositionTicks to the item's playstate — a Stopped at 0 wipes an existing resume
      // point and drops the item from Continue Watching (this exact bug shipped once: a resumed
      // session backed out before the first 8s poll tick reported 0 and lost its 67s position).
      // bestPosition() carries the live clock or the markStarted seed; a genuine 0 only happens
      // when playback started from scratch and never ticked, where there is nothing to lose.
      if (startedRef.current && !endedRef.current) {
        const position = bestPosition();
        void (async () => {
          await reportPlaybackStopped(buildBody(position, false));
          await persistResumePosition(position);
          // Past the completion threshold the persist above was a no-op and the server's
          // auto-mark stands — repaint the library checkmark to match, right now.
          // Reading the ref at teardown is deliberate: the duration is only known
          // after the player loaded, long after this effect ran.
          // eslint-disable-next-line react-hooks/exhaustive-deps
          const duration = durationRef.current;
          if (duration > 0 && position / duration >= COMPLETION_THRESHOLD) {
            markItemPlayed(videoIdRef.current, true);
          }
        })();
      }
    };
  }, [videoId, videoRef, buildBody, isPlayingRef, persistResumePosition, bestPosition, durationRef]);

  // Background/foreground: report pause state so the server session stays accurate
  // while tvOS suspends the app (no JS runs once fully suspended, so report early)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (!startedRef.current || endedRef.current) return;
      const position = bestPosition();
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
  }, [buildBody, isPlayingRef, persistResumePosition, bestPosition]);

  const markStarted = useCallback(
    (positionTicks = 0) => {
      // Idempotent per session: the resume-seek path and the auto-play path can both
      // fire on the same load — only the first should register the session
      if (startedRef.current && !endedRef.current) return;
      startedRef.current = true;
      endedRef.current = false;
      // Seed the sampled position with the start position: every report before the
      // first poll tick (or onProgress tick) then carries the resume point instead
      // of 0, so a quick back-out can never zero the server-side resume state.
      const startSeconds = positionTicks / JELLYFIN_TIME.TICKS_PER_SECOND;
      lastSampledPositionRef.current = startSeconds;
      lastReportedPositionRef.current = startSeconds;
      void reportPlaybackStart({ ...buildBody(0, false), PositionTicks: Math.round(positionTicks) });
    },
    [buildBody],
  );

  const reportPauseChange = useCallback(
    (paused: boolean) => {
      if (!startedRef.current || endedRef.current) return;
      const position = bestPosition();
      void (async () => {
        await reportPlaybackProgress(buildBody(position, paused));
        await persistResumePosition(position);
      })();
    },
    [buildBody, persistResumePosition, bestPosition],
  );

  const markEnded = useCallback(() => {
    if (!startedRef.current || endedRef.current) return;
    endedRef.current = true;
    // Report the full duration, not the last 8s sample — guarantees the position is
    // past the server's played threshold so the item is auto-marked played. No persist:
    // the server's Played marking is the correct final state for a finished item.
    const finalPosition = durationRef.current > 0 ? durationRef.current : lastSampledPositionRef.current;
    void reportPlaybackStopped(buildBody(finalPosition, false));
    // Natural end is unambiguous completion — repaint the library checkmark immediately.
    markItemPlayed(videoIdRef.current, true);
    logger.info("Video ended, Stopped reported", {
      service: "usePlaybackReporter",
      videoId: videoIdRef.current.substring(0, 8),
    });
  }, [buildBody, durationRef]);

  const resetSession = useCallback(() => {
    // Close the in-flight session before a mid-item player remount (the caller regenerates
    // PlaySessionId for the new stream). Same Stopped-position rule as the unmount cleanup:
    // the server applies it to playstate, so it must carry the best-known position.
    if (startedRef.current && !endedRef.current) {
      const position = bestPosition();
      void (async () => {
        await reportPlaybackStopped(buildBody(position, false));
        await persistResumePosition(position);
        // Same completion rule as the unmount cleanup above.
        const duration = durationRef.current;
        if (duration > 0 && position / duration >= COMPLETION_THRESHOLD) {
          markItemPlayed(videoIdRef.current, true);
        }
      })();
    }
    startedRef.current = false;
    endedRef.current = false;
    lastReportedPositionRef.current = 0;
    lastSampledPositionRef.current = 0;
  }, [buildBody, persistResumePosition, bestPosition, durationRef]);

  return { markStarted, markEnded, reportPauseChange, resetSession };
}
