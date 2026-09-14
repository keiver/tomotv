import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { TimerRow } from "@/components/live-tv/timer-row";
import { LoadingRow } from "@/components/loading-row";
import { settingsStyles } from "@/components/settings/styles";
import { TVFocusHolder } from "@/components/tv-focus-holder";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { fetchSeriesTimers, fetchTimers } from "@/services/jellyfinApi";
import type { JellyfinSeriesTimer, JellyfinTimer } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

type ScheduledEntry = { kind: "heading"; key: string; title: string } | { kind: "timer"; key: string; timer: JellyfinTimer };

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

/** The guide's recording schedule: running, upcoming and series rules. A root route beside Recordings. */
export default function ScheduleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const isScreenFocused = useIsFocused();
  const [schedule, setSchedule] = useState<{ timers: JellyfinTimer[]; series: JellyfinSeriesTimer[]; isLoading: boolean; error: string | null }>({
    timers: [],
    series: [],
    isLoading: true,
    error: null,
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [reloadKey, setReloadKey] = useState(0);
  // On TV a FlatList renders inside an unstyled focus-guide View, so flex never reaches it and
  // it collapses to 1pt. The column measures the room and the list grows to its rows, capped there.
  const [listHeight, setListHeight] = useState(0);

  // Reloads whenever the screen comes back on top: the program panel changes the schedule.
  useEffect(() => {
    if (!isScreenFocused) return;
    let cancelled = false;
    Promise.all([fetchTimers(), fetchSeriesTimers()])
      .then(([timers, series]) => {
        if (cancelled) return;
        setSchedule({ timers, series, isLoading: false, error: null });
        setNowMs(Date.now());
      })
      .catch((err) => {
        logger.warn("Schedule load failed", err, { screen: "Schedule" });
        if (!cancelled) setSchedule((current) => ({ ...current, isLoading: false, error: err instanceof Error ? err.message : String(err) }));
      });
    return () => {
      cancelled = true;
    };
  }, [isScreenFocused, reloadKey]);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  const scheduled = useMemo<ScheduledEntry[]>(() => {
    const entries: ScheduledEntry[] = [];
    const live = schedule.timers.filter((timer) => timer.Status !== "Cancelled");
    const running = live.filter((timer) => timer.Status === "InProgress");
    const upcoming = live.filter((timer) => timer.Status !== "InProgress").sort((a, b) => Date.parse(a.StartDate) - Date.parse(b.StartDate));
    if (running.length > 0) {
      entries.push({ kind: "heading", key: "running", title: t("liveTv.recordingNow") });
      for (const timer of running) entries.push({ kind: "timer", key: timer.Id, timer });
    }
    if (upcoming.length > 0) {
      entries.push({ kind: "heading", key: "upcoming", title: t("liveTv.upcoming") });
      for (const timer of upcoming) entries.push({ kind: "timer", key: timer.Id, timer });
    }
    if (schedule.series.length > 0) {
      entries.push({ kind: "heading", key: "series", title: t("liveTv.seriesRules") });
      for (const rule of schedule.series) entries.push({ kind: "timer", key: `series-${rule.Id ?? rule.Name}`, timer: seriesAsTimer(rule) });
    }
    return entries;
  }, [schedule]);

  const handleTimerPress = useCallback(
    (timer: JellyfinTimer) => {
      if (!timer.ProgramId) return;
      router.push({ pathname: "/program-info", params: { programId: timer.ProgramId, channelId: timer.ChannelId ?? "", channelName: timer.ChannelName ?? "" } });
    },
    [router],
  );

  const body = (() => {
    if (schedule.isLoading) {
      return (
        <View style={styles.center}>
          <LoadingRow label={t("liveTv.scheduled")} />
          <TVFocusHolder preferred={isScreenFocused} />
        </View>
      );
    }
    if (schedule.error) {
      return (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
          <Text style={styles.emptyText}>{schedule.error}</Text>
          <FocusableButton title={t("common.retry")} variant="primary" onPress={reload} icon={<Ionicons name="refresh-outline" size={IS_TV ? 24 : 20} color={COLORS.ON_ACCENT} />} />
        </View>
      );
    }
    if (scheduled.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons name="calendar-outline" size={64} color={COLORS.TEXT_SECONDARY} />
          <Text style={styles.emptyText}>{t("liveTv.noTimers")}</Text>
          <TVFocusHolder preferred={isScreenFocused} />
        </View>
      );
    }
    // The Diagnostics log's card: it takes the height under the bar and scrolls inside.
    return (
      <View style={[styles.page, { paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}>
        <View style={[settingsStyles.contentContainer, styles.column]} onLayout={(event) => setListHeight(event.nativeEvent.layout.height)}>
          <View style={[settingsStyles.section, styles.card]}>
            <FlatList
              data={scheduled}
              keyExtractor={(entry) => entry.key}
              renderItem={({ item, index }) =>
                item.kind === "heading" ? (
                  <Text style={[settingsStyles.sectionNote, styles.groupLabel]}>{item.title}</Text>
                ) : (
                  <TimerRow timer={item.timer} nowMs={nowMs} onPress={handleTimerPress} isLast={index === scheduled.length - 1} />
                )
              }
              style={{ maxHeight: listHeight }}
              showsVerticalScrollIndicator={!IS_TV}
              removeClippedSubviews={!IS_TV}
            />
          </View>
        </View>
      </View>
    );
  })();

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <View style={[styles.container, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12 }]}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    gap: 18,
  },
  emptyText: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 24 : 18,
    textAlign: "center",
  },
  page: {
    flex: 1,
    alignItems: "center",
  },
  column: {
    flex: 1,
  },
  card: {
    marginBottom: 0,
  },
  // The group's name as a band inside the card, a step up from a footnote so it reads as a heading.
  groupLabel: {
    fontSize: IS_TV ? 22 : 13,
    fontWeight: "600",
    color: COLORS.TEXT_SECONDARY,
  },
});
