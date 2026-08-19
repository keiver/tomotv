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
// A clock sample within this many seconds of a pending auto-seek target counts as
// the seek having landed (poll's self-clearing backup when onSeek was missed).
const PENDING_SEEK_SLACK_SECONDS = 5;

/**
 * Identity and lifecycle of ONE reporting session, snapshotted at markStarted.
 * Reports must never read the live refs for identity: a same-instance videoId
 * change (queue advance via router.replace) repoints them at the NEXT video
 * during render, BEFORE the previous session's effect cleanup fires — a report
 * built from the live refs there pairs the old session's position with the new
 * item's id and corrupts the new item's server playstate.
 * `closed` flips exactly once; a closed session accepts no further writes.
 */
interface ReporterSession {
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  /** UserData.Played at session start — restored verbatim by every persist. */
  playedAtStart: boolean;
  closed: boolean;
}

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
  /**
   * Target of an in-flight auto-seek (null when none). While set, the player clock
   * still reads the pre-seek position (~0 on a resume), so the poll must not sample
   * it — one tick would overwrite the seeded resume position and a back-out in that
   * window would send Stopped(~0), making the server wipe the resume point and
   * auto-mark the item played. Cleared by onSeek; the poll self-clears as a backup
   * once the clock reaches the target.
   */
  pendingSeekTargetRef: React.RefObject<number | null>;
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
 * A failed ping never affects playback.
 *
 * Resume state is owned by TomoTV, not the Sessions pipeline: the server routes every
 * Sessions report through UpdatePlayState gates (verified in 10.11 source) that discard
 * positions for items shorter than its configured minimum runtime and mis-mark them
 * Played. So each position-bearing report is followed by a verbatim UserData write
 * (updateUserItemData, no server gates) that persists the position whenever it's within
 * TomoTV's resume window (>= 2s and < 95% of duration) and restores the Played flag the
 * item had when the session started.
 *
 * WRITE ORDERING: every server write goes through one serialized chain, and a session
 * closes exactly once — the closing Stopped+persist is enqueued after any in-flight
 * mid-session write, and once a session is closed no further write for it passes its
 * gate. Both rules exist because they failed in the wild: a back-out's Stopped at
 * 2767.75s was overwritten by a stale 8s-poll persist at 2728.58s that landed later,
 * and the back-out's own final persist was lost entirely (hence the single retry on
 * the closing persist). Server resume state must end at the last on-screen position.
 *
 * Lifecycle:
 * - markStarted(ticks): snapshots the session identity, POSTs Playing.
 * - 8-second polling loop: samples videoRef.getCurrentPosition(), POSTs Progress while
 *   the position advances (skips paused/buffering ticks and < 5s deltas), then persists
 *   the resume position.
 * - reportPauseChange(paused): immediate Progress with IsPaused + persist, on play/pause.
 * - markEnded(): closes the session with Stopped at full duration, NO persist — the
 *   server marks the item played past its completion threshold and drops it from the
 *   resume list; the library checkmark repaints immediately.
 * - resetSession(): closes the in-flight session before a mid-item player remount
 *   (audio-track switch, seek recovery); caller regenerates PlaySessionId.
 * - Cleanup on unmount/videoId change: closes the session at the best-known position —
 *   the live onProgress clock, else the markStarted seed (covers backing out of the
 *   player and queue advances).
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
  pendingSeekTargetRef,
}: UsePlaybackReporterConfig): UsePlaybackReporterResult {
  const lastReportedPositionRef = useRef(0);
  const lastSampledPositionRef = useRef(0);
  const sessionRef = useRef<ReporterSession | null>(null);

  // Live videoId, used ONLY to snapshot new sessions (never for report bodies).
  // Synced in an effect rather than during render: markStarted is the only reader
  // and it runs from player callbacks, always after the commit.
  const videoIdRef = useRef(videoId);
  useEffect(() => {
    videoIdRef.current = videoId;
  }, [videoId]);

  // Serialized server-write chain. null = idle: the next write starts immediately
  // (synchronously issues its first request); while busy, writes queue in program
  // order so a stale mid-session persist can never land after the session-closing
  // Stopped. The chain spans sessions on purpose — an old session's final writes
  // always reach the server before the next session's Playing.
  const writeChainRef = useRef<Promise<void> | null>(null);
  const enqueueWrite = useCallback((task: () => Promise<void>) => {
    const prev = writeChainRef.current;
    const run = (prev ? prev.then(task) : task()).catch(() => {
      // Individual report functions already swallow and log their own failures;
      // this guard only keeps an unexpected throw from wedging the chain.
    });
    writeChainRef.current = run;
    void run.then(() => {
      if (writeChainRef.current === run) writeChainRef.current = null;
    });
  }, []);

  // Best-known playback position for event-driven reports: the live onProgress clock
  // when it has ticked, else the last poll sample (which markStarted seeds with the
  // resume position, so even an instant back-out reports the position it started at).
  const bestPosition = useCallback(() => {
    // Mid-seek the live clock still reads the pre-seek position — the seeded sample
    // (the seek target) is the truthful position for any report in that window.
    if (pendingSeekTargetRef.current !== null) return lastSampledPositionRef.current;
    const live = positionSecondsRef.current;
    return live > 0 ? live : lastSampledPositionRef.current;
  }, [positionSecondsRef, pendingSeekTargetRef]);

  // Identity comes from the session snapshot; PlayMethod/AudioStreamIndex stay live
  // (stream metadata of the playing pipeline, harmless on a stale final report).
  const buildBody = useCallback(
    (session: ReporterSession, positionSeconds: number, isPaused: boolean): PlaybackReportBody => ({
      ItemId: session.itemId,
      MediaSourceId: session.mediaSourceId,
      PlaySessionId: session.playSessionId,
      PositionTicks: Math.round(positionSeconds * JELLYFIN_TIME.TICKS_PER_SECOND),
      IsPaused: isPaused,
      PlayMethod: currentModeRef.current === "transcode" ? "Transcode" : "DirectStream",
      AudioStreamIndex: audioStreamIndexRef.current ?? undefined,
      CanSeek: true,
    }),
    [currentModeRef, audioStreamIndexRef],
  );

  /**
   * Persist the resume position through the gate-free UserData endpoint when it falls
   * inside TomoTV's resume window. Played is restored to its session-start value: this
   * un-marks the bogus Played the server's gates set on short items mid-play, while
   * preserving a legitimately-watched flag during a partial rewatch.
   * Returns false only when the write was attempted and failed (drives the close retry).
   */
  const persistResumePosition = useCallback(
    async (session: ReporterSession, positionSeconds: number): Promise<boolean> => {
      const duration = durationRef.current;
      if (duration <= 0) return true;
      if (positionSeconds < MIN_PERSIST_POSITION_SECONDS || positionSeconds / duration >= COMPLETION_THRESHOLD) return true;

      const ok = await updateUserItemData(session.itemId, {
        PlaybackPositionTicks: Math.round(positionSeconds * JELLYFIN_TIME.TICKS_PER_SECOND),
        Played: session.playedAtStart,
      });
      return ok !== false;
    },
    [durationRef],
  );

  /**
   * Close the in-flight session exactly once. Flipping `closed` synchronously
   * disqualifies every queued or in-flight non-final write at its next gate; the
   * closing Stopped+persist then joins the same chain, so it lands after anything
   * already in flight. The closing persist retries once — losing it leaves the
   * server's resume state at whatever stale write landed last.
   */
  const closeSession = useCallback(
    (finalPosition: number) => {
      const session = sessionRef.current;
      if (!session || session.closed) return;
      session.closed = true;
      sessionRef.current = null;

      enqueueWrite(async () => {
        await reportPlaybackStopped(buildBody(session, finalPosition, false));
        const persisted = await persistResumePosition(session, finalPosition);
        if (persisted === false) {
          await persistResumePosition(session, finalPosition);
        }
        // Past the completion threshold the persist above was a no-op and the server's
        // auto-mark stands — repaint the library checkmark to match, right now.
        // Reading the ref inside the task is deliberate: the duration is only known
        // after the player loaded, long after the enclosing effect ran.
        const duration = durationRef.current;
        if (duration > 0 && finalPosition / duration >= COMPLETION_THRESHOLD) {
          markItemPlayed(session.itemId, true);
        }
      });
    },
    [enqueueWrite, buildBody, persistResumePosition, durationRef],
  );

  // Reset position bookkeeping when videoId changes (the polling effect's cleanup
  // has already closed the previous session at this point — cleanups run before
  // effect bodies).
  useEffect(() => {
    lastReportedPositionRef.current = 0;
    lastSampledPositionRef.current = 0;
  }, [videoId]);

  // Polling loop
  useEffect(() => {
    const interval = setInterval(async () => {
      const session = sessionRef.current;
      if (!session) return;

      try {
        const position = await videoRef.current?.getCurrentPosition();
        if (position == null || position <= 0) return;
        if (session.closed) return;

        // In-flight auto-seek: the clock is pre-seek garbage until it lands near the
        // target — skip the sample (keeping the seeded resume position intact).
        // Self-clearing backup for a missed onSeek: once the clock reaches the
        // target, trust it again.
        const pendingSeekTarget = pendingSeekTargetRef.current;
        if (pendingSeekTarget !== null) {
          if (position < pendingSeekTarget - PENDING_SEEK_SLACK_SECONDS) return;
          pendingSeekTargetRef.current = null;
        }

        // Not advancing — player is paused or buffering (pause state was already
        // reported immediately via reportPauseChange)
        if (position === lastSampledPositionRef.current) return;
        lastSampledPositionRef.current = position;

        // Not enough change since last report — avoid noise
        if (Math.abs(position - lastReportedPositionRef.current) < MIN_REPORT_DELTA_SECONDS) return;

        lastReportedPositionRef.current = position;
        enqueueWrite(async () => {
          if (session.closed) return;
          // Sequential: the persist write must land after the Progress report it corrects
          await reportPlaybackProgress(buildBody(session, position, !isPlayingRef.current));
          // Closed while the Progress was in flight: the closing writes are already
          // queued behind us — a stale persist here would land AFTER them and clobber
          // the final position (this exact bug shipped: a poll persist from 8s before
          // the back-out overwrote the back-out's Stopped as the final server state).
          if (session.closed) return;
          await persistResumePosition(session, position);
        });
      } catch {
        // getCurrentPosition can throw if player is disposed — ignore silently
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);

      // Close on teardown (back out of the player, videoId change on a live screen)
      // unless markEnded/resetSession already closed the session. The position is the
      // live clock or the markStarted seed — a Stopped at 0 makes the server wipe the
      // item's resume point, and identity comes from the session snapshot because the
      // live refs already point at the NEXT video when this cleanup runs.
      closeSession(bestPosition());
    };
  }, [videoId, videoRef, buildBody, isPlayingRef, persistResumePosition, bestPosition, enqueueWrite, closeSession, pendingSeekTargetRef]);

  // Background/foreground: report pause state so the server session stays accurate
  // while tvOS suspends the app (no JS runs once fully suspended, so report early)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const session = sessionRef.current;
      if (!session) return;
      const position = bestPosition();
      if (nextAppState.match(/inactive|background/)) {
        enqueueWrite(async () => {
          if (session.closed) return;
          await reportPlaybackProgress(buildBody(session, position, true));
          if (session.closed) return;
          await persistResumePosition(session, position);
        });
      } else if (nextAppState === "active" && isPlayingRef.current) {
        enqueueWrite(async () => {
          if (session.closed) return;
          await reportPlaybackProgress(buildBody(session, position, false));
        });
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [buildBody, isPlayingRef, persistResumePosition, bestPosition, enqueueWrite]);

  const markStarted = useCallback(
    (positionTicks = 0) => {
      // Idempotent per session: the resume-seek path and the auto-play path can both
      // fire on the same load — only the first registers the session
      if (sessionRef.current) return;
      const session: ReporterSession = {
        itemId: videoIdRef.current,
        mediaSourceId: mediaSourceIdRef.current ?? videoIdRef.current,
        playSessionId: playSessionIdRef.current,
        playedAtStart: wasPlayedAtStartRef.current ?? false,
        closed: false,
      };
      sessionRef.current = session;
      // Seed the sampled position with the start position: every report before the
      // first poll tick (or onProgress tick) then carries the resume point instead
      // of 0, so a quick back-out can never zero the server-side resume state.
      const startSeconds = positionTicks / JELLYFIN_TIME.TICKS_PER_SECOND;
      lastSampledPositionRef.current = startSeconds;
      lastReportedPositionRef.current = startSeconds;
      // No closed-gate on Playing: the chain guarantees it precedes this session's
      // Stopped, and a Stopped without its Playing confuses the server's session model.
      enqueueWrite(async () => {
        await reportPlaybackStart({ ...buildBody(session, 0, false), PositionTicks: Math.round(positionTicks) });
      });
    },
    [buildBody, enqueueWrite, mediaSourceIdRef, playSessionIdRef, wasPlayedAtStartRef],
  );

  const reportPauseChange = useCallback(
    (paused: boolean) => {
      const session = sessionRef.current;
      if (!session) return;
      const position = bestPosition();
      enqueueWrite(async () => {
        if (session.closed) return;
        await reportPlaybackProgress(buildBody(session, position, paused));
        if (session.closed) return;
        await persistResumePosition(session, position);
      });
    },
    [buildBody, persistResumePosition, bestPosition, enqueueWrite],
  );

  const markEnded = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.closed) return;
    session.closed = true;
    sessionRef.current = null;
    // Report the full duration, not the last 8s sample — guarantees the position is
    // past the server's played threshold so the item is auto-marked played. No persist:
    // the server's Played marking is the correct final state for a finished item.
    const finalPosition = durationRef.current > 0 ? durationRef.current : lastSampledPositionRef.current;
    enqueueWrite(async () => {
      await reportPlaybackStopped(buildBody(session, finalPosition, false));
    });
    // Natural end is unambiguous completion — repaint the library checkmark immediately.
    markItemPlayed(session.itemId, true);
    logger.info("Video ended, Stopped reported", {
      service: "usePlaybackReporter",
      videoId: session.itemId.substring(0, 8),
    });
  }, [buildBody, durationRef, enqueueWrite]);

  const resetSession = useCallback(() => {
    // Close the in-flight session before a mid-item player remount (the caller
    // regenerates PlaySessionId for the new stream). Same rules as the unmount
    // cleanup: best-known position, snapshot identity, close-once.
    closeSession(bestPosition());
    lastReportedPositionRef.current = 0;
    lastSampledPositionRef.current = 0;
  }, [closeSession, bestPosition]);

  return { markStarted, markEnded, reportPauseChange, resetSession };
}
