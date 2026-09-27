import { t } from "@/services/i18n";
import { cancelSeriesTimer, cancelTimer, createSeriesTimer, createTimer, fetchTimerDefaults, fetchTimers } from "@/services/jellyfinApi";
import { getLiveTvPreferences } from "@/services/liveTvPreferences";
import { showToast } from "@/services/toast";
import type { JellyfinProgram, JellyfinTimer } from "@/types/jellyfin";
import { activeRecordTimer, durationLabel, isAiring, programTimes } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useState } from "react";

export type RecordBusy = "record" | "series" | "cancel" | "cancelSeries" | null;

/** A program to record, or (no programId) a channel that records a manual timer for the settings length. */
export interface RecordTarget {
  programId?: string;
  channelId: string;
  channelName: string;
  program?: Pick<JellyfinProgram, "StartDate" | "EndDate"> | null;
}

/** The timer covering the target (undefined until read) and the writes that start or end it. */
export function useRecordActions(target: RecordTarget | null) {
  const programId = target?.programId;
  const channelId = target?.channelId ?? "";
  const channelName = target?.channelName ?? "";
  const program = target?.program ?? null;
  const [timer, setTimer] = useState<JellyfinTimer | null | undefined>(undefined);
  const [busy, setBusy] = useState<RecordBusy>(null);
  const enabled = !!target;

  const loadTimer = useCallback(async () => {
    const timers = await fetchTimers();
    setTimer(activeRecordTimer(timers, { programId, channelId }, Date.now()));
  }, [programId, channelId]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchTimers()
      .then((timers) => {
        if (!cancelled) setTimer(activeRecordTimer(timers, { programId, channelId }, Date.now()));
      })
      .catch((err) => logger.warn("Timer state read failed", err, { hook: "useRecordActions" }));
    return () => {
      cancelled = true;
    };
  }, [enabled, programId, channelId]);

  const run = useCallback(
    async (kind: Exclude<RecordBusy, null>, action: () => Promise<void>, doneToast: string) => {
      setBusy(kind);
      try {
        await action();
        await loadTimer();
        showToast(doneToast, "success");
      } catch (err) {
        logger.error("Recording action failed", err, { hook: "useRecordActions", kind });
        showToast(t("liveTv.recordingFailed"), "error");
      } finally {
        setBusy(null);
      }
    },
    [loadTimer],
  );

  const record = useCallback(() => {
    // A program records to its end; the toast names the running length, a future program is scheduled.
    if (programId) {
      const remainingMs = program && isAiring(program, Date.now()) ? programTimes(program).endMs - Date.now() : 0;
      const doneToast = remainingMs > 0 ? t("liveTv.recordingStartedFor").replace("{duration}", durationLabel(remainingMs)) : t("liveTv.recordingScheduled");
      return run("record", async () => createTimer(await fetchTimerDefaults(programId)), doneToast);
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
    );
  }, [run, programId, program, channelId, channelName]);
  const recordSeries = useCallback(() => run("series", async () => createSeriesTimer(await fetchTimerDefaults(programId)), t("liveTv.recordingScheduled")), [run, programId]);
  const cancel = useCallback(
    () => run("cancel", async () => (timer ? cancelTimer(timer.Id) : undefined), t(timer?.Status === "InProgress" ? "liveTv.recordingStopped" : "liveTv.recordingCanceled")),
    [run, timer],
  );
  const cancelSeries = useCallback(() => run("cancelSeries", async () => (timer?.SeriesTimerId ? cancelSeriesTimer(timer.SeriesTimerId) : undefined), t("liveTv.recordingCanceled")), [run, timer]);

  return { timer, busy, record, recordSeries, cancel, cancelSeries };
}
