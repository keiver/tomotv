import { FocusableButton } from "@/components/FocusableButton";
import { GuideChannelColumn } from "@/components/live-tv/guide-channel-column";
import { GuideRow, rowCells, type FocusTargets } from "@/components/live-tv/guide-row";
import { GuideTimeRuler } from "@/components/live-tv/guide-time-ruler";
import { LoadingRow } from "@/components/loading-row";
import { COLORS } from "@/constants/colors";
import type { GuideRow as GuideRowData, GuideState } from "@/hooks/useGuide";
import { t } from "@/services/i18n";
import type { JellyfinItem, JellyfinProgram } from "@/types/jellyfin";
import { cellAtEdge, cellGeometry, formatDayLabel, guideMetrics, isAiring, MINUTE_MS, programTimes } from "@/utils/guide";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, Platform, StyleSheet, Text, View } from "react-native";
import Animated, { runOnJS, scrollTo, useAnimatedRef, useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";

const IS_TV = Platform.isTV;
const METRICS = guideMetrics(IS_TV);

interface GuideCanvasProps {
  guide: GuideState;
  /** Native node of the segment bar's selected pill: the top row's Up target. */
  segmentHandle?: number;
  onProgramPress: (program: JellyfinProgram, channel: JellyfinItem) => void;
  onProgramLongPress: (program: JellyfinProgram, channel: JellyfinItem) => void;
}

/**
 * The guide: a horizontal scroll view holding the ruler and a virtualized list of channel rows,
 * with the channel column beside it kept level from the list's own scroll handler. Cells are the
 * only focusables inside; the focus engine scrolls both axes to reveal the one it lands on.
 */
export function GuideCanvas({ guide, segmentHandle, onProgramPress, onProgramLongPress }: GuideCanvasProps) {
  const { rows, windowStartMs, windowEndMs, nowMs, timersByProgramId, isLoading, error, retry, extendWindow, loadMoreRows } = guide;
  const spanPx = ((windowEndMs - windowStartMs) / MINUTE_MS) * METRICS.pxPerMinute;
  const isScreenFocused = useIsFocused();

  const scrollX = useSharedValue(0);
  const columnRef = useAnimatedRef<Animated.FlatList<JellyfinItem>>();
  const [viewportWidth, setViewportWidth] = useState(0);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const handleCanvasLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
    setCanvasHeight(event.nativeEvent.layout.height);
  }, []);

  // Within a viewport of the loaded edge: grow the window before the viewer reaches it.
  const horizontalHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
      if (viewportWidth > 0 && event.contentOffset.x + 2 * viewportWidth > spanPx) runOnJS(extendWindow)();
    },
  });
  const verticalHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollTo(columnRef, 0, event.contentOffset.y, false);
    },
  });

  // One-shot latch (home-shelves pattern): the first row's airing cell claims focus on mount
  // while the screen is on top; once any cell reports focus the claim retires for good.
  const [focusLatched, setFocusLatched] = useState(false);

  // Up and Down from a cell land on the neighbouring row's cell under its visible left edge,
  // named by handle: left to geometry, the focus engine picks the wide cell's far end.
  const handles = useRef(new Map<string, number>()).current;
  const handleCellHandle = useCallback(
    (programId: string, handle: number | undefined) => {
      if (handle === undefined) handles.delete(programId);
      else handles.set(programId, handle);
    },
    [handles],
  );
  const [focusTargets, setFocusTargets] = useState<{ rowIndex: number; targets: FocusTargets } | undefined>(undefined);
  const neighbourHandle = useCallback(
    (row: GuideRowData | undefined, edgeMs: number) => {
      if (!row) return undefined;
      const target = cellAtEdge(rowCells(row.channel, row.programs, windowStartMs, windowEndMs, METRICS), edgeMs);
      return target?.Id ? handles.get(target.Id) : undefined;
    },
    [handles, windowStartMs, windowEndMs],
  );
  const handleCellFocus = useCallback(
    (program: JellyfinProgram, channel: JellyfinItem) => {
      if (!IS_TV || !program.Id) return;
      setFocusLatched(true);
      const rowIndex = rows.findIndex((row) => row.channel.Id === channel.Id);
      const { startMs, endMs } = programTimes(program);
      const left = cellGeometry(startMs, endMs, windowStartMs, windowEndMs, METRICS)?.left ?? 0;
      const edgeMs = windowStartMs + (Math.max(left, scrollX.value) / METRICS.pxPerMinute) * MINUTE_MS;
      setFocusTargets({
        rowIndex,
        targets: { programId: program.Id, up: neighbourHandle(rows[rowIndex - 1], edgeMs), down: neighbourHandle(rows[rowIndex + 1], edgeMs) },
      });
    },
    [rows, windowStartMs, windowEndMs, scrollX, neighbourHandle],
  );
  const focusProgramId = useMemo(() => {
    if (!IS_TV || focusLatched || !isScreenFocused) return undefined;
    const first = rows[0];
    if (!first) return undefined;
    return (first.programs.find((program) => isAiring(program, nowMs)) ?? first.programs[0])?.Id;
  }, [rows, nowMs, focusLatched, isScreenFocused]);

  const channels = useMemo(() => rows.map((row) => row.channel), [rows]);
  const dayLabel = formatDayLabel(windowStartMs, nowMs, { today: t("liveTv.today"), tomorrow: t("liveTv.tomorrow") });

  const renderRow = useCallback(
    ({ item, index }: { item: GuideRowData; index: number }) => (
      <GuideRow
        channel={item.channel}
        programs={item.programs}
        windowStartMs={windowStartMs}
        windowEndMs={windowEndMs}
        metrics={METRICS}
        spanPx={spanPx}
        nowMs={nowMs}
        timersByProgramId={timersByProgramId}
        scrollX={scrollX}
        nextFocusUp={index === 0 ? segmentHandle : undefined}
        focusTargets={focusTargets?.rowIndex === index ? focusTargets.targets : undefined}
        focusProgramId={index === 0 ? focusProgramId : undefined}
        onProgramPress={onProgramPress}
        onProgramLongPress={onProgramLongPress}
        onCellFocus={handleCellFocus}
        onCellHandle={handleCellHandle}
      />
    ),
    [windowStartMs, windowEndMs, spanPx, nowMs, timersByProgramId, scrollX, segmentHandle, focusTargets, focusProgramId, onProgramPress, onProgramLongPress, handleCellFocus, handleCellHandle],
  );
  const getItemLayout = useCallback((_data: ArrayLike<GuideRowData> | null | undefined, index: number) => ({ length: METRICS.rowHeight, offset: METRICS.rowHeight * index, index }), []);
  const keyExtractor = useCallback((row: GuideRowData) => row.channel.Id, []);

  if (isLoading && rows.length === 0) {
    return (
      <View style={styles.center}>
        <LoadingRow label={t("liveTv.loadingGuide")} />
      </View>
    );
  }
  if (error && rows.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
        <Text style={styles.errorText}>{error}</Text>
        <FocusableButton title={t("common.retry")} variant="primary" onPress={retry} hasTVPreferredFocus icon={<Ionicons name="refresh-outline" size={IS_TV ? 24 : 20} color={COLORS.ON_ACCENT} />} />
      </View>
    );
  }
  if (rows.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="tv-outline" size={64} color={COLORS.TEXT_SECONDARY} />
        <Text style={styles.emptyText}>{t("liveTv.noChannels")}</Text>
      </View>
    );
  }

  const listHeight = Math.max(0, canvasHeight - METRICS.rulerHeight);
  return (
    <View style={styles.canvas}>
      <GuideChannelColumn channels={channels} metrics={METRICS} listRef={columnRef} dayLabel={dayLabel} listHeight={listHeight} />
      <View style={styles.scrollHost} onLayout={handleCanvasLayout}>
        <Animated.ScrollView
          horizontal
          onScroll={horizontalHandler}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          bounces={false}
          style={styles.scroll}
          contentContainerStyle={{ width: spanPx }}>
          <View style={{ width: spanPx, height: canvasHeight }}>
            <GuideTimeRuler windowStartMs={windowStartMs} windowEndMs={windowEndMs} metrics={METRICS} spanPx={spanPx} nowMs={nowMs} />
            <Animated.FlatList
              data={rows}
              renderItem={renderRow}
              keyExtractor={keyExtractor}
              getItemLayout={getItemLayout}
              onScroll={verticalHandler}
              scrollEventThrottle={16}
              onEndReached={loadMoreRows}
              onEndReachedThreshold={1}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={!IS_TV}
              initialNumToRender={IS_TV ? 10 : 12}
              maxToRenderPerBatch={8}
              windowSize={5}
              style={{ height: listHeight, width: spanPx }}
            />
          </View>
        </Animated.ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    flexDirection: "row",
  },
  scrollHost: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    gap: 18,
  },
  errorText: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 22 : 16,
    textAlign: "center",
  },
  emptyText: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 24 : 18,
    textAlign: "center",
  },
});
