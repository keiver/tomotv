import { t } from "@/services/i18n";
import { cancelSeriesTimer, cancelTimer, createSeriesTimer, createTimer, fetchSeriesTimers, fetchTimerDefaults, fetchTimers } from "@/services/jellyfinApi";
import { getLiveTvPreferences } from "@/services/liveTvPreferences";
import { showToast } from "@/services/toast";
import type { JellyfinProgram, JellyfinSeriesTimer, JellyfinTimer } from "@/types/jellyfin";
import { activeRecordTimer, durationLabel, isActiveTimer, isAiring, programTimes } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useState } from "react";

export type RecordBusy = "record" | "series" | "cancel" | "cancelSeries" | null;

/** The series rule a stand-in timer names: set, but with no id the server knows. */
const STAND_IN_SERIES_ID = "stand-in";

/** A program to record, or (no programId) a channel that records a manual timer for the settings length. */
export interface RecordTarget {
  programId?: string;
  channelId: string;
  channelName: string;
  program?: Pick<JellyfinProgram, "StartDate" | "EndDate"> | null;
  /** A known timer (a Schedule row): read by id while it is live, so a future manual timer is found. */
  timerId?: string;
}

/** The timer covering the target (undefined until read) and the writes that start or end it. */
export function useRecordActions(target: RecordTarget | null) {
  const programId = target?.programId;
  const channelId = target?.channelId ?? "";
  const channelName = target?.channelName ?? "";
  const program = target?.program ?? null;
  const timerId = target?.timerId;
  const [timer, setTimer] = useState<JellyfinTimer | null | undefined>(undefined);
  const [seriesTimerId, setSeriesTimerId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState<RecordBusy>(null);
  // The first read has answered, a failure included, so a caller can wait on it.
  const [settled, setSettled] = useState(false);
  const enabled = !!target;

  const programStart = program?.StartDate;
  const programEnd = program?.EndDate;
  const readState = useCallback(async () => {
    const [timers, rules] = await Promise.all([fetchTimers(), fetchSeriesTimers()]);
    const pinned = timerId ? timers.find((candidate) => candidate.Id === timerId && isActiveTimer(candidate)) : undefined;
    return {
      timer: pinned ?? activeRecordTimer(timers, { programId, channelId, program: { StartDate: programStart, EndDate: programEnd } }, Date.now()),
      seriesTimerId: programSeriesTimerId(timers, rules, programId),
    };
  }, [timerId, programId, channelId, programStart, programEnd]);
  const loadTimer = useCallback(async () => {
    const state = await readState();
    setTimer(state.timer);
    setSeriesTimerId(state.seriesTimerId);
  }, [readState]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    readState()
      .then((state) => {
        if (cancelled) return;
        setTimer(state.timer);
        setSeriesTimerId(state.seriesTimerId);
        setSettled(true);
      })
      .catch((err) => {
        logger.warn("Timer state read failed", err, { hook: "useRecordActions" });
        if (!cancelled) setSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, readState]);

  /** A write, then a re-read; a write that landed stands even when the re-read fails, as `landed` (and `landedSeries` when given). */
  const run = useCallback(
    async (kind: Exclude<RecordBusy, null>, action: () => Promise<void>, doneToast: string, landed: JellyfinTimer | null, landedSeries?: string | null) => {
      setBusy(kind);
      try {
        await action();
      } catch (err) {
        logger.error("Recording action failed", err, { hook: "useRecordActions", kind });
        showToast(t("liveTv.recordingFailed"), "error");
        setBusy(null);
        return;
      }
      showToast(doneToast, "success");
      try {
        await loadTimer();
      } catch (err) {
        logger.warn("Timer state read failed", err, { hook: "useRecordActions" });
        setTimer(landed);
        if (landedSeries !== undefined) setSeriesTimerId(landedSeries);
      } finally {
        setBusy(null);
      }
    },
    [loadTimer],
  );

  /** A stand-in left by a failed re-read has no ids to cancel: read the real timer instead. */
  const rereadStandIn = useCallback(async () => {
    setBusy("cancel");
    try {
      await loadTimer();
    } catch (err) {
      logger.warn("Timer state read failed", err, { hook: "useRecordActions" });
      showToast(t("liveTv.recordingFailed"), "error");
    } finally {
      setBusy(null);
    }
  }, [loadTimer]);

  const standIn = useCallback(
    (endMs: number, airing: boolean, seriesTimerId?: string): JellyfinTimer => ({
      Id: "",
      Name: channelName,
      ChannelId: channelId,
      ProgramId: programId,
      StartDate: new Date(Date.now()).toISOString(),
      EndDate: new Date(endMs).toISOString(),
      Status: airing ? "InProgress" : "New",
      SeriesTimerId: seriesTimerId,
    }),
    [channelName, channelId, programId],
  );

  const record = useCallback(() => {
    // A program records to its end; the toast names the running length, a future program is scheduled.
    if (programId) {
      const airing = !!program && isAiring(program, Date.now());
      const remainingMs = airing && program ? programTimes(program).endMs - Date.now() : 0;
      const doneToast = remainingMs > 0 ? t("liveTv.recordingStartedFor").replace("{duration}", durationLabel(remainingMs)) : t("liveTv.recordingScheduled");
      const endMs = program ? programTimes(program).endMs : Date.now();
      return run("record", async () => createTimer(await fetchTimerDefaults(programId)), doneToast, standIn(endMs, airing));
    }
    if (!channelId) return;
    const recordingMs = getLiveTvPreferences().recordingMinutes * 60_000;
    // The timer's name becomes the recording folder; Jellyfin's scanner ignores "**/.*".
    const timerName = channelName.replace(/^[.\s]+/, "") || channelId;
    return run(
      "record",
      async () => {
        const defaults = await fetchTimerDefaults();
        await createTimer({ ...defaults, ChannelId: channelId, Name: timerName, StartDate: new Date().toISOString(), EndDate: new Date(Date.now() + recordingMs).toISOString() });
      },
      t("liveTv.recordingStartedFor").replace("{duration}", durationLabel(recordingMs)),
      standIn(Date.now() + recordingMs, true),
    );
  }, [run, standIn, programId, program, channelId, channelName]);
  const recordSeries = useCallback(() => {
    const airing = !!program && isAiring(program, Date.now());
    const endMs = program ? programTimes(program).endMs : Date.now();
    return run("series", async () => createSeriesTimer(await fetchTimerDefaults(programId)), t("liveTv.recordingScheduled"), standIn(endMs, airing, STAND_IN_SERIES_ID), STAND_IN_SERIES_ID);
  }, [run, standIn, programId, program]);
  const cancel = useCallback(() => {
    if (timer && !timer.Id) return rereadStandIn();
    return run("cancel", async () => (timer ? cancelTimer(timer.Id) : undefined), t(timer?.Status === "InProgress" ? "liveTv.recordingStopped" : "liveTv.recordingCanceled"), null);
  }, [run, rereadStandIn, timer]);
  const cancelSeries = useCallback(() => {
    if (seriesTimerId === STAND_IN_SERIES_ID || (timer && !timer.Id)) return rereadStandIn();
    // The rule goes; this airing's own timer stays until the re-read says otherwise.
    const landed = timer ? { ...timer, SeriesTimerId: undefined } : null;
    return run("cancelSeries", async () => (seriesTimerId ? cancelSeriesTimer(seriesTimerId) : undefined), t("liveTv.recordingCanceled"), landed, null);
  }, [run, rereadStandIn, timer, seriesTimerId]);

  return { timer, seriesTimerId, busy, settled, record, recordSeries, cancel, cancelSeries };
}

/** The live rule covering a program: linked from its timer in any status (a cancelled airing keeps the link), else the rule's own program. */
export function programSeriesTimerId(timers: JellyfinTimer[], rules: JellyfinSeriesTimer[], programId?: string): string | null {
  if (!programId) return null;
  const linked = timers.find((candidate) => candidate.ProgramId === programId && candidate.SeriesTimerId)?.SeriesTimerId;
  const rule = rules.find((candidate) => (linked ? candidate.Id === linked : candidate.ProgramId === programId));
  return rule?.Id ?? null;
}
