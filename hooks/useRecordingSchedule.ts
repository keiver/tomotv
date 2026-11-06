import { timerPanelTarget } from "@/components/live-tv/timer-row";
import { t } from "@/services/i18n";
import { fetchLiveTvManagement, fetchSeriesTimers, fetchTimers } from "@/services/jellyfinApi";
import { reportRecordingTimers, runningTimers, stopRunningTimers } from "@/services/recordingStatus";
import { showToast } from "@/services/toast";
import type { JellyfinSeriesTimer, JellyfinTimer } from "@/types/jellyfin";
import { isActiveTimer } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";

export type ScheduledEntry = { kind: "heading"; key: string; title: string } | { kind: "timer"; key: string; timer: JellyfinTimer; series: boolean };

/** A series rule drawn as a row: its next airing is what the viewer recognises it by. */
function seriesAsTimer(rule: JellyfinSeriesTimer): JellyfinTimer {
  return {
    Id: rule.Id ?? rule.Name,
    Name: rule.Name,
    ChannelName: rule.RecordAnyChannel ? undefined : rule.ChannelName,
    ChannelId: rule.ChannelId,
    ProgramId: rule.ProgramId,
    SeriesTimerId: rule.Id ?? rule.Name,
    StartDate: rule.StartDate ?? new Date().toISOString(),
    EndDate: rule.EndDate ?? new Date().toISOString(),
  };
}

/**
 * The recording schedule: running, upcoming and series rules, read whenever the screen comes back on top or `reloadKey`
 * moves, and whether the account may manage them. Stop All ends every running timer; the files so far stay on the server.
 */
export function useRecordingSchedule(reloadKey: number) {
  const router = useRouter();
  const isScreenFocused = useIsFocused();
  const [schedule, setSchedule] = useState<{ timers: JellyfinTimer[]; series: JellyfinSeriesTimer[]; canManage: boolean; isLoading: boolean; error: string | null }>({
    timers: [],
    series: [],
    canManage: false,
    isLoading: true,
    error: null,
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [ownReload, setOwnReload] = useState(0);

  // The program panel changes the schedule, so it reloads whenever the screen comes back on top.
  useEffect(() => {
    if (!isScreenFocused) return;
    let cancelled = false;
    Promise.all([fetchTimers(), fetchSeriesTimers(), fetchLiveTvManagement()])
      .then(([timers, series, canManage]) => {
        reportRecordingTimers(timers);
        if (cancelled) return;
        setSchedule({ timers, series, canManage, isLoading: false, error: null });
        setNowMs(Date.now());
      })
      .catch((err) => {
        logger.warn("Schedule load failed", err, { screen: "Recordings" });
        if (!cancelled) setSchedule((current) => ({ ...current, isLoading: false, error: err instanceof Error ? err.message : String(err) }));
      });
    return () => {
      cancelled = true;
    };
  }, [isScreenFocused, reloadKey, ownReload]);
  const reload = useCallback(() => setOwnReload((n) => n + 1), []);

  const running = useMemo(() => runningTimers(schedule.timers, nowMs), [schedule.timers, nowMs]);
  const entries = useMemo<ScheduledEntry[]>(() => {
    const list: ScheduledEntry[] = [];
    const runningIds = new Set(running.map((timer) => timer.Id));
    const upcoming = schedule.timers.filter((timer) => isActiveTimer(timer) && !runningIds.has(timer.Id)).sort((a, b) => Date.parse(a.StartDate) - Date.parse(b.StartDate));
    if (running.length > 0) {
      list.push({ kind: "heading", key: "running", title: t("liveTv.recordingNow") });
      for (const timer of running) list.push({ kind: "timer", key: timer.Id, timer, series: false });
    }
    if (upcoming.length > 0) {
      list.push({ kind: "heading", key: "upcoming", title: t("liveTv.upcoming") });
      for (const timer of upcoming) list.push({ kind: "timer", key: timer.Id, timer, series: false });
    }
    if (schedule.series.length > 0) {
      list.push({ kind: "heading", key: "series", title: t("liveTv.seriesRules") });
      for (const rule of schedule.series) list.push({ kind: "timer", key: `series-${rule.Id ?? rule.Name}`, timer: seriesAsTimer(rule), series: true });
    }
    return list;
  }, [schedule, running]);

  const onTimerPress = useCallback(
    (timer: JellyfinTimer, series: boolean) => {
      const target = timerPanelTarget(timer, series);
      if (target) router.push({ pathname: "/video-info", params: target });
    },
    [router],
  );

  const [stopping, setStopping] = useState(false);
  const stopAll = useCallback(async () => {
    setStopping(true);
    try {
      const failed = await stopRunningTimers(running);
      if (failed.length > 0) logger.warn("Stop all recordings left timers running", { screen: "Recordings", failed });
      showToast(failed.length > 0 ? t("liveTv.recordingFailed") : t("liveTv.recordingsStopped"), failed.length > 0 ? "error" : "success");
    } finally {
      setStopping(false);
      reload();
    }
  }, [running, reload]);
  const confirmStopAll = useCallback(() => {
    Alert.alert(t("liveTv.stopAllRecordings"), t("liveTv.stopAllRecordingsConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("liveTv.stopAllRecordings"), style: "destructive", onPress: () => void stopAll() },
    ]);
  }, [stopAll]);

  return { entries, running, nowMs, canManage: schedule.canManage, isLoading: schedule.isLoading, error: schedule.error, reload, onTimerPress, stopping, confirmStopAll };
}
