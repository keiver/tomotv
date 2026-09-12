import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { LibraryGrid } from "@/components/library-grid";
import { GuideCanvas } from "@/components/live-tv/guide-canvas";
import { SegmentBar, type LiveTvSegment } from "@/components/live-tv/segment-bar";
import { TimerRow } from "@/components/live-tv/timer-row";
import { LoadingRow } from "@/components/loading-row";
import { gridEdgePadding } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { useFolderContents } from "@/hooks/useFolderContents";
import { useGuide } from "@/hooks/useGuide";
import { useItemLongPress } from "@/hooks/useItemLongPress";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { t } from "@/services/i18n";
import { fetchRecordings, fetchSeriesTimers, fetchTimers } from "@/services/jellyfinApi";
import type { JellyfinItem, JellyfinProgram, JellyfinSeriesTimer, JellyfinTimer } from "@/types/jellyfin";
import { NO_GUIDE_PREFIX } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, findNodeHandle, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const SEGMENT_KEYS = new Set<string>(["guide", "channels", "recordings", "scheduled"]);

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

/**
 * The Live TV screen: the guide, the channel grid, finished recordings and the schedule, behind
 * one segment row. A pushed route inside the library stack, so Menu pops it natively.
 */
export default function LiveTvScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const isScreenFocused = useIsFocused();
  const { showGlobalLoader } = useLoadingActions();
  const params = useLocalSearchParams<{ viewId?: string; name?: string; segment?: string }>();
  const [segment, setSegment] = useState<LiveTvSegment>(() => (SEGMENT_KEYS.has(params.segment ?? "") ? (params.segment as LiveTvSegment) : "guide"));
  const [segmentHandle, setSegmentHandle] = useState<number | undefined>(undefined);
  const handleSelectedRef = useCallback((node: View | null) => {
    if (!IS_TV) return;
    const handle = node ? findNodeHandle(node) : null;
    setSegmentHandle(handle ?? undefined);
  }, []);

  const guide = useGuide();
  const openItem = useOpenShelfItem();
  const onItemLongPress = useItemLongPress();

  const tune = useCallback(
    (channelId: string, channelName: string) => {
      showGlobalLoader();
      router.push({ pathname: "/player", params: { videoId: channelId, videoName: channelName } });
    },
    [router, showGlobalLoader],
  );
  const openProgram = useCallback(
    (program: JellyfinProgram, channel: JellyfinItem) => {
      if (!program.Id || program.Id.startsWith(NO_GUIDE_PREFIX)) return;
      router.push({ pathname: "/program-info", params: { programId: program.Id, channelId: channel.Id, channelName: channel.Name } });
    },
    [router],
  );
  const handleProgramPress = useCallback(
    (program: JellyfinProgram, channel: JellyfinItem) => {
      const startMs = Date.parse(program.StartDate ?? "");
      const endMs = Date.parse(program.EndDate ?? "");
      if (startMs <= guide.nowMs && guide.nowMs < endMs) tune(channel.Id, channel.Name);
      else openProgram(program, channel);
    },
    [guide.nowMs, tune, openProgram],
  );

  // Channels: the same paged channel list the folder route used to host.
  const channels = useFolderContents(segment === "channels" ? (params.viewId ?? null) : null, "livetv");
  const handleChannelPress = useCallback((item: JellyfinItem) => tune(item.Id, item.Name), [tune]);

  // Recordings and the schedule reload every time their segment shows and whenever the screen
  // comes back on top: the program panel changes both.
  // Both start loading and only a retry sets that again; a later show refreshes behind what is there.
  const [recordings, setRecordings] = useState<{ items: JellyfinItem[]; isLoading: boolean; error: string | null }>({ items: [], isLoading: true, error: null });
  const [schedule, setSchedule] = useState<{ timers: JellyfinTimer[]; series: JellyfinSeriesTimer[]; isLoading: boolean; error: string | null }>({
    timers: [],
    series: [],
    isLoading: true,
    error: null,
  });
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!isScreenFocused) return;
    let cancelled = false;
    if (segment === "recordings") {
      fetchRecordings()
        .then(({ items }) => !cancelled && setRecordings({ items, isLoading: false, error: null }))
        .catch((err) => {
          logger.warn("Recordings load failed", err, { screen: "LiveTv" });
          if (!cancelled) setRecordings((current) => ({ ...current, isLoading: false, error: err instanceof Error ? err.message : String(err) }));
        });
    } else if (segment === "scheduled") {
      Promise.all([fetchTimers(), fetchSeriesTimers()])
        .then(([timers, series]) => !cancelled && setSchedule({ timers, series, isLoading: false, error: null }))
        .catch((err) => {
          logger.warn("Schedule load failed", err, { screen: "LiveTv" });
          if (!cancelled) setSchedule((current) => ({ ...current, isLoading: false, error: err instanceof Error ? err.message : String(err) }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [segment, isScreenFocused, reloadKey]);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  // A flat list of episodes from many series: the card names the series, its badge the episode.
  const recordingCards = useMemo(() => recordings.items.map((item) => (item.SeriesName ? { ...item, Name: item.SeriesName } : item)), [recordings.items]);
  const recordingById = useCallback((card: JellyfinItem) => recordings.items.find((item) => item.Id === card.Id) ?? card, [recordings.items]);
  const handleRecordingPress = useCallback((card: JellyfinItem) => openItem(recordingById(card)), [openItem, recordingById]);
  const handleRecordingLongPress = useCallback((card: JellyfinItem) => onItemLongPress(recordingById(card)), [onItemLongPress, recordingById]);

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

  const edgeLeft = gridEdgePadding(insets.left, IS_TV);
  const edgeRight = gridEdgePadding(insets.right, IS_TV);
  // Phone: the transparent native header floats over the content, so the row starts under it.
  const topClearance = IS_TV ? 40 + insets.top : headerHeight + 8;
  const screenOptions = useMemo(() => (IS_TV ? {} : { title: params.name ?? t("liveTv.title") }), [params.name]);

  const body = (() => {
    if (segment === "guide") return <GuideCanvas guide={guide} segmentHandle={segmentHandle} onProgramPress={handleProgramPress} onProgramLongPress={openProgram} />;
    if (segment === "channels") {
      return (
        <LibraryGrid
          items={channels.items}
          isLoading={channels.isLoading}
          isLoadingMore={channels.isLoadingMore}
          hasMoreResults={channels.hasMoreResults}
          error={channels.error}
          onItemPress={handleChannelPress}
          onLoadMore={channels.loadMore}
          onRetry={channels.refresh}
        />
      );
    }
    if (segment === "recordings") {
      if (!recordings.isLoading && !recordings.error && recordings.items.length === 0) {
        return (
          <View style={styles.center}>
            <Ionicons name="recording-outline" size={64} color={COLORS.TEXT_SECONDARY} />
            <Text style={styles.emptyText}>{t("liveTv.noRecordings")}</Text>
          </View>
        );
      }
      return (
        <LibraryGrid
          items={recordingCards}
          isLoading={recordings.isLoading}
          isLoadingMore={false}
          hasMoreResults={false}
          error={recordings.error}
          onItemPress={handleRecordingPress}
          onItemLongPress={handleRecordingLongPress}
          onLoadMore={() => {}}
          onRetry={reload}
        />
      );
    }
    if (schedule.isLoading) {
      return (
        <View style={styles.center}>
          <LoadingRow label={t("liveTv.scheduled")} />
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
        </View>
      );
    }
    return (
      <FlatList
        data={scheduled}
        keyExtractor={(entry) => entry.key}
        renderItem={({ item }) =>
          item.kind === "heading" ? (
            <Text style={styles.heading}>{item.title}</Text>
          ) : (
            <View style={styles.timerWrap}>
              <TimerRow timer={item.timer} nowMs={guide.nowMs} onPress={handleTimerPress} />
            </View>
          )
        }
        contentContainerStyle={styles.scheduleContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={!IS_TV}
      />
    );
  })();

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <View style={styles.container}>
        <AmbientBackground />
        <View style={[styles.header, { paddingTop: topClearance, paddingLeft: edgeLeft, paddingRight: edgeRight }]}>
          <SegmentBar selected={segment} onSelect={setSegment} onSelectedRef={handleSelectedRef} />
        </View>
        <View style={[styles.body, segment === "guide" && { paddingLeft: edgeLeft, paddingRight: edgeRight }]}>{body}</View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    marginLeft: IS_TV ? 16 : 12,
  },
  body: {
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
  heading: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 24 : 15,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: IS_TV ? 28 : 18,
    marginBottom: IS_TV ? 12 : 8,
  },
  timerWrap: {
    marginBottom: IS_TV ? 14 : 8,
  },
  scheduleContent: {
    paddingHorizontal: IS_TV ? 48 : 16,
    paddingBottom: 40,
  },
});
