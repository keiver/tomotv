import { FocusableButton } from "@/components/FocusableButton";
import { GuideChannelColumn } from "@/components/live-tv/guide-channel-column";
import { GuideColumnDivider } from "@/components/live-tv/guide-column-divider";
import { GuideRow, rowCells, type FocusTargetsFor } from "@/components/live-tv/guide-row";
import { GuideTimeRuler } from "@/components/live-tv/guide-time-ruler";
import { LoadingRow } from "@/components/loading-row";
import { COLORS } from "@/constants/colors";
import type { GuideRow as GuideRowData, GuideState } from "@/hooks/useGuide";
import { t } from "@/services/i18n";
import type { JellyfinItem, JellyfinProgram } from "@/types/jellyfin";
import { cellAtEdge, cellGeometry, formatDayLabel, guideMetrics, isAiring, MINUTE_MS, programTimes } from "@/utils/guide";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { runOnJS, scrollTo, useAnimatedRef, useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";

const IS_TV = Platform.isTV;
const METRICS = guideMetrics(IS_TV);
/** Phone: clear the tab bar so the last channel is never tucked under it. */
const LIST_BOTTOM_PAD = IS_TV ? 0 : 200;
/** The floating tab bar the phone list scrolls under; matches home-shelves. */
const TAB_BAR_HEIGHT = 49;

interface GuideCanvasProps {
  guide: GuideState;
  /** Native node the top row's Up lands on: the screen's first action above the guide. */
  topFocusHandle?: number;
  onProgramPress: (program: JellyfinProgram, channel: JellyfinItem) => void;
  onProgramLongPress: (program: JellyfinProgram, channel: JellyfinItem) => void;
  onChannelPress: (channel: JellyfinItem) => void;
  onChannelLongPress: (channel: JellyfinItem) => void;
}

/**
 * The guide: a horizontal scroll view holding the ruler and a virtualized list of channel rows,
 * with the channel column beside it kept level with the rows. Cells and channels are the
 * focusables; the focus engine scrolls both axes to reveal the one it lands on.
 */
export function GuideCanvas({ guide, topFocusHandle, onProgramPress, onProgramLongPress, onChannelPress, onChannelLongPress }: GuideCanvasProps) {
  const { rows, windowStartMs, windowEndMs, nowMs, timersByProgramId, isLoading, error, retry, extendWindow, loadMoreRows } = guide;
  const spanPx = ((windowEndMs - windowStartMs) / MINUTE_MS) * METRICS.pxPerMinute;
  const isScreenFocused = useIsFocused();

  const insets = useSafeAreaInsets();
  const [compact, setCompact] = useState(false);

  const scrollX = useSharedValue(0);
  const columnRef = useAnimatedRef<Animated.FlatList<JellyfinItem>>();
  const rowsRef = useAnimatedRef<Animated.FlatList<GuideRowData>>();
  // The channel column's live width and the whole guide's width, both driven from the UI thread
  // so the resize drag never re-renders the two lists.
  const columnW = useSharedValue(METRICS.channelColumnWidth);
  const canvasW = useSharedValue(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const handleCanvasLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
    setCanvasHeight(event.nativeEvent.layout.height);
  }, []);
  const handleGuideLayout = useCallback((event: LayoutChangeEvent) => canvasW.set(event.nativeEvent.layout.width), [canvasW]);

  // Within a viewport of the loaded edge: grow the window before the viewer reaches it.
  const horizontalHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
      if (viewportWidth > 0 && event.contentOffset.x + 2 * viewportWidth > spanPx) runOnJS(extendWindow)();
    },
  });
  // Only the list the viewer is moving scrolls the other, so the two never chase each other.
  // A drag picks it on phone; on TV focus picks it, since a focus scroll fires no drag.
  const driver = useSharedValue<"grid" | "column">("grid");
  const verticalHandler = useAnimatedScrollHandler({
    onBeginDrag: () => {
      driver.value = "grid";
    },
    onScroll: (event) => {
      if (driver.value === "grid") scrollTo(columnRef, 0, event.contentOffset.y, false);
    },
  });
  const columnHandler = useAnimatedScrollHandler({
    onBeginDrag: () => {
      driver.value = "column";
    },
    onScroll: (event) => {
      if (driver.value === "column") scrollTo(rowsRef, 0, event.contentOffset.y, false);
    },
  });

  // One-shot latch (home-shelves pattern): the first row's airing cell claims focus on mount
  // while the screen is on top; once any cell or channel reports focus the claim retires for good.
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
  // Read at focus time through a ref: the lookup stays one function for the rows' whole life.
  const rowDataRef = useRef(rows);
  useEffect(() => {
    rowDataRef.current = rows;
  }, [rows]);
  const neighbourHandle = useCallback(
    (row: GuideRowData | undefined, edgeMs: number) => {
      if (!row) return undefined;
      const target = cellAtEdge(rowCells(row.channel, row.programs, windowStartMs, windowEndMs, METRICS), edgeMs);
      return target?.Id ? handles.get(target.Id) : undefined;
    },
    [handles, windowStartMs, windowEndMs],
  );
  const targetsFor = useCallback<FocusTargetsFor>(
    (rowIndex, program) => {
      const { startMs, endMs } = programTimes(program);
      const left = cellGeometry(startMs, endMs, windowStartMs, windowEndMs, METRICS)?.left ?? 0;
      const edgeMs = windowStartMs + (Math.max(left, scrollX.value) / METRICS.pxPerMinute) * MINUTE_MS;
      return { up: neighbourHandle(rowDataRef.current[rowIndex - 1], edgeMs), down: neighbourHandle(rowDataRef.current[rowIndex + 1], edgeMs) };
    },
    [windowStartMs, windowEndMs, scrollX, neighbourHandle],
  );
  const handleCellFocus = useCallback(() => {
    if (!IS_TV) return;
    driver.set("grid");
    setFocusLatched(true);
  }, [driver]);
  const handleChannelFocus = useCallback(() => {
    if (!IS_TV) return;
    driver.set("column");
    setFocusLatched(true);
  }, [driver]);
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
        rowIndex={index}
        nextFocusUp={index === 0 ? topFocusHandle : undefined}
        targetsFor={IS_TV ? targetsFor : undefined}
        focusProgramId={index === 0 ? focusProgramId : undefined}
        onProgramPress={onProgramPress}
        onProgramLongPress={onProgramLongPress}
        onCellFocus={handleCellFocus}
        onCellHandle={handleCellHandle}
      />
    ),
    [windowStartMs, windowEndMs, spanPx, nowMs, timersByProgramId, scrollX, topFocusHandle, targetsFor, focusProgramId, onProgramPress, onProgramLongPress, handleCellFocus, handleCellHandle],
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
    <View style={styles.canvas} onLayout={handleGuideLayout}>
      <GuideChannelColumn
        channels={channels}
        metrics={METRICS}
        listRef={columnRef}
        onScroll={columnHandler}
        dayLabel={dayLabel}
        listHeight={listHeight}
        contentBottomPad={LIST_BOTTOM_PAD}
        columnWidth={columnW}
        compact={compact}
        onChannelPress={onChannelPress}
        onChannelLongPress={onChannelLongPress}
        onChannelFocus={handleChannelFocus}
        onEndReached={loadMoreRows}
      />
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
              ref={rowsRef}
              data={rows}
              renderItem={renderRow}
              keyExtractor={keyExtractor}
              getItemLayout={getItemLayout}
              onScroll={verticalHandler}
              scrollEventThrottle={16}
              onEndReached={loadMoreRows}
              onEndReachedThreshold={1}
              showsVerticalScrollIndicator={false}
              snapToAlignment={IS_TV ? "item" : undefined}
              removeClippedSubviews={!IS_TV}
              // Three viewports each side mounted ahead of a held press, in small batches so rows
              // paint one after another instead of as a block; a press costs no canvas render now.
              initialNumToRender={12}
              maxToRenderPerBatch={4}
              updateCellsBatchingPeriod={16}
              windowSize={7}
              style={{ height: listHeight, width: spanPx }}
              contentContainerStyle={{ paddingBottom: LIST_BOTTOM_PAD }}
            />
          </View>
        </Animated.ScrollView>
      </View>
      {IS_TV ? null : (
        <GuideColumnDivider
          columnW={columnW}
          canvasW={canvasW}
          minWidth={METRICS.compactColumnWidth}
          maxWidth={METRICS.channelColumnWidth}
          topInset={METRICS.rulerHeight}
          bottomInset={TAB_BAR_HEIGHT + insets.bottom}
          onCompactChange={setCompact}
        />
      )}
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
