import { FocusableButton } from "@/components/FocusableButton";
import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { GuideChannelColumn } from "@/components/live-tv/guide-channel-column";
import { HUD_BAR_HEIGHT } from "@/components/live-tv/guide-hud";
import { GuideColumnDivider, useColumnResize } from "@/components/live-tv/guide-column-divider";
import { GuideRow, rowCells, type FocusTargetsFor } from "@/components/live-tv/guide-row";
import { GuideSeamMark } from "@/components/live-tv/guide-seam-mark";
import { GuideTimeRuler, useRulerScrub } from "@/components/live-tv/guide-time-ruler";
import { COLORS } from "@/constants/colors";
import type { GuideRow as GuideRowData, GuideState } from "@/hooks/useGuide";
import { t } from "@/services/i18n";
import type { JellyfinItem, JellyfinProgram } from "@/types/jellyfin";
import { cellAtEdge, cellGeometry, guideMetrics, isAiring, leftRevealOffset, MINUTE_MS, mountSpanFor, programTimes, rowSnap } from "@/utils/guide";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { LayoutChangeEvent, Platform, Animated as RNAnimated, StyleSheet, Text, TVFocusGuideView, useAnimatedValue, View, type ViewToken } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { runOnJS, runOnUI, scrollTo, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { setFocusedGuideRow } from "@/services/guideChannelFocus";
import { setLiveFrameFocus } from "@/services/liveFrames";
import { getLiveTvPreferences, updateLiveTvPreferences, type ChannelFilter } from "@/services/liveTvPreferences";
import { claimMacEscape } from "@/services/macKeyCommands";
import { IS_MAC } from "@/utils/hostEnvironment";

const IS_TV = Platform.isTV;
const METRICS = guideMetrics(IS_TV);
/** Phone: clear the tab bar so the last channel is never tucked under it. */
const LIST_BOTTOM_PAD = 200;
/** The floating tab bar the phone list scrolls under; matches home-shelves. */
const TAB_BAR_HEIGHT = 49;
/** Public in Animated's Flow exports (AnimatedExports.js.flow), missing from its TypeScript types. */
const attachNativeEvent = (RNAnimated as unknown as { attachNativeEvent: (view: unknown, eventName: string, mapping: unknown[]) => { detach: () => void } }).attachNativeEvent;
/** The grid reaches this far under the channel column, the width of the grid line on the seam. */
const SEAM_REACH = 1;
/** A page or row must hold this long before its posters load. */
const ART_SETTLE_MS = 150;
const ART_ROW_VIEWABILITY = { itemVisiblePercentThreshold: 1, minimumViewTime: ART_SETTLE_MS };
const NO_ROWS: ReadonlySet<string> = new Set();

interface GuideCanvasProps {
  guide: GuideState;
  /** The picked channel group: a change rewinds the rows to the top. */
  filter: ChannelFilter;
  /** Native node the top row's Up lands on: the screen's first action above the guide. */
  topFocusHandle?: number;
  /** TV: reports the first channel card's node, the way down into the guide from above. */
  onEntryHandle?: (handle: number | undefined) => void;
  /** The HUD band between the ruler and the rows: corner actions, group cells, guide status. */
  hudRow?: React.ReactNode;
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
export function GuideCanvas({ guide, filter, topFocusHandle, onEntryHandle, hudRow, onProgramPress, onProgramLongPress, onChannelPress, onChannelLongPress }: GuideCanvasProps) {
  const { rows, windowStartMs, windowEndMs, nowMs, timersByProgramId, recordingChannelIds, isLoading, error, retry, extendWindow, loadMoreRows } = guide;
  const spanPx = ((windowEndMs - windowStartMs) / MINUTE_MS) * METRICS.pxPerMinute;
  const isScreenFocused = useIsFocused();

  const insets = useSafeAreaInsets();
  // Phone: the column reopens the way it was last left.
  const [initialCompact] = useState(() => !IS_TV && getLiveTvPreferences().compactColumn);
  const [compact, setCompact] = useState(initialCompact);
  const handleCompactChange = useCallback((next: boolean) => {
    setCompact(next);
    updateLiveTvPreferences({ compactColumn: next });
  }, []);

  const scrollX = useSharedValue(0);
  const columnRef = useAnimatedRef<Animated.FlatList<JellyfinItem>>();
  const rowsRef = useAnimatedRef<Animated.FlatList<GuideRowData>>();
  const gridRef = useAnimatedRef<Animated.ScrollView>();
  // The pins, ruler and seam mark ride this: the native driver moves them inside the grid's own scroll event.
  const nativeScrollX = useAnimatedValue(0);
  const rulerShift = useMemo(() => ({ transform: [{ translateX: RNAnimated.multiply(nativeScrollX, -1) }] }), [nativeScrollX]);
  // The channel column's live width and the whole guide's width, both driven from the UI thread
  // so the resize drag never re-renders the two lists.
  const columnW = useSharedValue(initialCompact ? METRICS.compactColumnWidth : METRICS.channelColumnWidth);
  const canvasW = useSharedValue(0);
  const resize = useColumnResize({ columnW, canvasW, minWidth: METRICS.compactColumnWidth, maxWidth: METRICS.channelColumnWidth, initialCompact, onCompactChange: handleCompactChange });
  const [viewportWidth, setViewportWidth] = useState(0);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const handleCanvasLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
    setCanvasHeight(event.nativeEvent.layout.height);
  }, []);
  const handleGuideLayout = useCallback((event: LayoutChangeEvent) => canvasW.set(event.nativeEvent.layout.width), [canvasW]);
  // The corner tracks the column's live width.
  const cornerWidthStyle = useAnimatedStyle(() => ({ width: columnW.get() }));
  const { gesture: scrubGesture, stop: stopScrub } = useRulerScrub(gridRef, scrollX, Math.max(0, spanPx + SEAM_REACH - viewportWidth));

  // The page steps once per viewport scrolled.
  const [mountPage, setMountPage] = useState(0);
  const mountPageUi = useSharedValue(0);
  const mountSpan = useMemo(() => (viewportWidth > 0 ? mountSpanFor(mountPage, viewportWidth) : undefined), [mountPage, viewportWidth]);
  // Posters load only for the cells and rows in view, once the scroll rests there; a fling past loads none.
  const [artPage, setArtPage] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setArtPage(mountPage), ART_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [mountPage]);
  const artSpan = useMemo(() => (viewportWidth > 0 ? { fromPx: artPage * viewportWidth, toPx: (artPage + 2) * viewportWidth } : undefined), [artPage, viewportWidth]);
  const [artRows, setArtRows] = useState<ReadonlySet<string>>(NO_ROWS);
  const handleRowsViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<GuideRowData>[] }) => {
    setArtRows(new Set(viewableItems.map((token) => token.item.channel.Id)));
  }, []);

  // Within a viewport of the loaded edge: grow the window before the viewer reaches it.
  const horizontalHandler = useAnimatedScrollHandler({
    onBeginDrag: () => {
      stopScrub();
    },
    onScroll: (event) => {
      scrollX.set(event.contentOffset.x);
      const page = viewportWidth > 0 ? Math.floor(event.contentOffset.x / viewportWidth) : 0;
      if (page !== mountPageUi.get()) {
        mountPageUi.set(page);
        runOnJS(setMountPage)(page);
      }
      if (viewportWidth > 0 && event.contentOffset.x + 2 * viewportWidth > spanPx) runOnJS(extendWindow)();
    },
  });
  // Feeds nativeScrollX while the grid is mounted; the listener keeps its JS value current for re-renders.
  const gridShown = rows.length > 0 || (isLoading && !error);
  useEffect(() => {
    const grid = gridRef.current;
    if (!gridShown || !grid) return;
    const event = attachNativeEvent(grid, "onScroll", [{ nativeEvent: { contentOffset: { x: nativeScrollX } } }]);
    const listener = nativeScrollX.addListener(() => undefined);
    return () => {
      nativeScrollX.removeListener(listener);
      event.detach();
    };
  }, [gridShown, gridRef, nativeScrollX]);
  // A viewport wider than the window never scrolls, so the loaded edge grows until it clears two viewports.
  useEffect(() => {
    if (!isLoading && viewportWidth > 0 && 2 * viewportWidth > spanPx) extendWindow();
  }, [isLoading, rows, viewportWidth, spanPx, extendWindow]);
  // Only the list the viewer is moving scrolls the other, so the two never chase each other.
  // A drag picks it on phone; on TV focus picks it, since a focus scroll fires no drag.
  const driver = useSharedValue<"grid" | "column">("grid");
  const scrollY = useSharedValue(0);
  const verticalHandler = useAnimatedScrollHandler({
    onBeginDrag: () => {
      driver.value = "grid";
    },
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
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
  const rewindToTop = useCallback(
    (animated: boolean) => {
      driver.set("grid");
      runOnUI(() => {
        "worklet";
        scrollTo(rowsRef, 0, 0, animated);
      })();
    },
    [driver, rowsRef],
  );
  // Another group opens at its first channel and the window's start; the old rows hold until its first page replaces them.
  const lastFilterRef = useRef(filter);
  useEffect(() => {
    if (lastFilterRef.current === filter) return;
    lastFilterRef.current = filter;
    if (!gridShown) return;
    rewindToTop(false);
    runOnUI(() => {
      "worklet";
      stopScrub();
      scrollTo(gridRef, 0, 0, false);
    })();
  }, [filter, gridShown, rewindToTop, stopScrub, gridRef]);

  // Mac: Escape from a scrolled guide rewinds it to the top; the next press pops as usual.
  useEffect(() => {
    if (!IS_MAC || !isScreenFocused) return;
    return claimMacEscape("guide", () => {
      if (scrollY.get() < 1) return false;
      rewindToTop(true);
      return true;
    });
  }, [isScreenFocused, scrollY, rewindToTop]);

  // One-shot latch (home-shelves pattern): the first row's airing cell claims focus on mount
  // while the screen is on top; once any cell or channel reports focus the claim retires for good.
  const [focusLatched, setFocusLatched] = useState(false);

  // Up and Down from a cell land on the neighbouring row's cell under its visible left edge,
  // named by handle: left to geometry, the focus engine picks the wide cell's far end.
  const handlesRef = useRef(new Map<string, number>());
  // The first row's airing cell doubles as the HUD band's way into the grid: the entry focus
  // guide names it, so Down from a group cell lands on a programme, never on the channel column.
  const entryProgramIdRef = useRef<string | undefined>(undefined);
  const [entryHandle, setEntryHandle] = useState<number | undefined>(undefined);
  const handleCellHandle = useCallback((programId: string, handle: number | undefined) => {
    if (handle === undefined) handlesRef.current.delete(programId);
    else handlesRef.current.set(programId, handle);
    if (programId === entryProgramIdRef.current) setEntryHandle(handle);
  }, []);
  const entryProgramId = useMemo(() => {
    const first = rows[0];
    if (!IS_TV || !first) return undefined;
    const cells = rowCells(first.channel, first.programs, windowStartMs, windowEndMs, METRICS);
    return (cells.find((program) => isAiring(program, nowMs)) ?? cells[0])?.Id;
  }, [rows, nowMs, windowStartMs, windowEndMs]);
  useEffect(() => {
    entryProgramIdRef.current = entryProgramId;
    setEntryHandle(entryProgramId ? handlesRef.current.get(entryProgramId) : undefined);
  }, [entryProgramId]);
  // Read at focus time through a ref: the lookup stays one function for the rows' whole life.
  const rowDataRef = useRef(rows);
  useEffect(() => {
    rowDataRef.current = rows;
  }, [rows]);
  const neighbourHandle = useCallback(
    (row: GuideRowData | undefined, edgeMs: number) => {
      if (!row) return undefined;
      const target = cellAtEdge(rowCells(row.channel, row.programs, windowStartMs, windowEndMs, METRICS), edgeMs);
      return target?.Id ? handlesRef.current.get(target.Id) : undefined;
    },
    [windowStartMs, windowEndMs],
  );
  const targetsFor = useCallback<FocusTargetsFor>(
    (rowIndex, program) => {
      const { startMs, endMs } = programTimes(program);
      const left = cellGeometry(startMs, endMs, windowStartMs, windowEndMs, METRICS)?.left ?? 0;
      // get(), never .value: the React Compiler hoists a `.value` read into its render-time
      // memo comparison, which is a shared-value read during render.
      const edgeMs = windowStartMs + (Math.max(left, scrollX.get()) / METRICS.pxPerMinute) * MINUTE_MS;
      return { up: neighbourHandle(rowDataRef.current[rowIndex - 1], edgeMs), down: neighbourHandle(rowDataRef.current[rowIndex + 1], edgeMs) };
    },
    [windowStartMs, windowEndMs, scrollX, neighbourHandle],
  );
  // The row the last focused cell sat in: a focus in that same row came from Left or Right.
  const lastCellRowRef = useRef<string | null>(null);
  const handleCellFocus = useCallback(
    (program: JellyfinProgram, channel: JellyfinItem) => {
      if (!IS_TV) return;
      // The pinned label is always on screen, so the focus engine never scrolls a Left move back to the cell's start.
      if (lastCellRowRef.current === channel.Id) {
        const { startMs, endMs } = programTimes(program);
        const geometry = cellGeometry(startMs, endMs, windowStartMs, windowEndMs, METRICS);
        const target = geometry ? leftRevealOffset(geometry.left, scrollX.get()) : undefined;
        if (target !== undefined) {
          runOnUI(() => {
            "worklet";
            scrollTo(gridRef, target, 0, true);
          })();
        }
      }
      lastCellRowRef.current = channel.Id;
      driver.set("grid");
      setFocusLatched(true);
      // A dwell on the row promotes its channel to the sampler's front; its card plays its clip.
      setLiveFrameFocus(channel.Id);
      setFocusedGuideRow(channel.Id);
    },
    [driver, windowStartMs, windowEndMs, scrollX, gridRef],
  );
  // While focus sits in the cells region the entry guide points back up at the HUD, so both
  // guides on row 0's top edge name the same target and Up never redirects to the focused cell.
  const [cellsFocused, setCellsFocused] = useState(false);
  const handleCellsEnter = useCallback(() => setCellsFocused(true), []);
  const handleCellsLeave = useCallback(() => {
    lastCellRowRef.current = null;
    setCellsFocused(false);
    setLiveFrameFocus(null);
    setFocusedGuideRow(null);
  }, []);
  useEffect(() => () => setFocusedGuideRow(null), []);
  const handleChannelFocus = useCallback(() => {
    if (!IS_TV) return;
    driver.set("column");
    setFocusLatched(true);
  }, [driver]);
  const focusProgramId = useMemo(() => {
    if (!IS_TV || focusLatched || !isScreenFocused) return undefined;
    const first = rows[0];
    if (!first) return undefined;
    const cells = rowCells(first.channel, first.programs, windowStartMs, windowEndMs, METRICS);
    return (cells.find((program) => isAiring(program, nowMs)) ?? cells[0])?.Id;
  }, [rows, nowMs, focusLatched, isScreenFocused, windowStartMs, windowEndMs]);

  const channels = useMemo(() => rows.map((row) => row.channel), [rows]);
  // TV: the focused row lands as the lowest whole row, so every focus scroll rests on a row edge, the last row's too.
  const snap = rowSnap(canvasHeight, METRICS.rowHeight);
  const rowSnapOffset = IS_TV ? snap.offset : undefined;
  const listBottomPad = IS_TV ? snap.bottomPad : LIST_BOTTOM_PAD;

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
        scrollX={nativeScrollX}
        viewportWidth={viewportWidth}
        mountSpan={mountSpan}
        artSpan={artSpan}
        artInView={artRows.has(item.channel.Id)}
        rowIndex={index}
        snapOffset={rowSnapOffset}
        nextFocusUp={index === 0 ? topFocusHandle : undefined}
        targetsFor={IS_TV ? targetsFor : undefined}
        focusProgramId={index === 0 ? focusProgramId : undefined}
        onProgramPress={onProgramPress}
        onProgramLongPress={onProgramLongPress}
        onCellFocus={handleCellFocus}
        onCellHandle={handleCellHandle}
      />
    ),
    [
      windowStartMs,
      windowEndMs,
      spanPx,
      nowMs,
      timersByProgramId,
      nativeScrollX,
      viewportWidth,
      mountSpan,
      artSpan,
      artRows,
      rowSnapOffset,
      topFocusHandle,
      targetsFor,
      focusProgramId,
      onProgramPress,
      onProgramLongPress,
      handleCellFocus,
      handleCellHandle,
    ],
  );
  const getItemLayout = useCallback((_data: ArrayLike<GuideRowData> | null | undefined, index: number) => ({ length: METRICS.rowHeight, offset: METRICS.rowHeight * index, index }), []);
  const keyExtractor = useCallback((row: GuideRowData) => row.channel.Id, []);

  const corner = <Animated.View style={[styles.corner, { height: METRICS.rulerHeight }, cornerWidthStyle]} />;
  const rulerClip = (
    <View style={styles.rulerClip}>
      <RNAnimated.View style={[{ width: spanPx + SEAM_REACH, marginLeft: SEAM_REACH }, rulerShift]}>
        <GuideTimeRuler windowStartMs={windowStartMs} windowEndMs={windowEndMs} metrics={METRICS} spanPx={spanPx} nowMs={nowMs} />
      </RNAnimated.View>
    </View>
  );
  // The ruler band: the corner cell, then the ruler mirroring the rows' horizontal scroll.
  const rulerRow = (
    <View style={[styles.topRow, { height: METRICS.rulerHeight }]}>
      {IS_TV ? (
        corner
      ) : (
        <GestureHandlerRootView style={styles.cornerHost}>
          <GestureDetector gesture={resize.corner}>{corner}</GestureDetector>
        </GestureHandlerRootView>
      )}
      {IS_TV ? (
        rulerClip
      ) : (
        <GestureHandlerRootView style={styles.rulerClip}>
          <GestureDetector gesture={scrubGesture}>{rulerClip}</GestureDetector>
        </GestureHandlerRootView>
      )}
    </View>
  );
  const seamMark = <GuideSeamMark columnW={columnW} scrollX={nativeScrollX} isHour={new Date(windowStartMs).getMinutes() === 0} height={METRICS.rulerHeight - 1} />;

  // The ruler and HUD stay mounted through every branch: an empty pick must keep the group cells (and
  // the focus sitting on one) so the viewer can pick their way back out, and the band must not reflow.
  if (error && rows.length === 0) {
    return (
      <View style={styles.canvas}>
        {rulerRow}
        {hudRow}
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
          <Text style={styles.errorText}>{error}</Text>
          <FocusableButton title={t("common.retry")} variant="primary" onPress={retry} hasTVPreferredFocus icon={<Ionicons name="refresh-outline" size={IS_TV ? 24 : 20} color={COLORS.ON_ACCENT} />} />
        </View>
        {seamMark}
      </View>
    );
  }
  // While loading, the empty grid renders as the skeleton the arriving rows fill in.
  if (!isLoading && rows.length === 0) {
    return (
      <View style={styles.canvas}>
        {rulerRow}
        {hudRow}
        <View style={styles.center}>
          <Ionicons name="tv-outline" size={64} color={COLORS.TEXT_SECONDARY} />
          <Text style={styles.emptyText}>{t("liveTv.noChannels")}</Text>
        </View>
        {seamMark}
      </View>
    );
  }

  const listHeight = Math.max(0, canvasHeight);
  return (
    <View style={styles.canvas} onLayout={handleGuideLayout}>
      {rulerRow}
      {hudRow}
      {/* Only over the cells, so Up from the channel column still reaches the corner actions;
          only with a destination, an empty guide would catch presses and trap them. */}
      {IS_TV && entryHandle !== undefined ? (
        <View style={styles.entryRow}>
          <Animated.View style={cornerWidthStyle} />
          <TVFocusGuideView style={styles.entryGuide} destinations={cellsFocused && topFocusHandle !== undefined ? [topFocusHandle] : [entryHandle]} />
        </View>
      ) : null}
      <View style={styles.bandRow}>
        <GuideChannelColumn
          channels={channels}
          recordingChannelIds={recordingChannelIds}
          metrics={METRICS}
          listRef={columnRef}
          onScroll={columnHandler}
          listHeight={listHeight}
          rowSnapOffset={rowSnapOffset}
          contentBottomPad={listBottomPad}
          columnWidth={columnW}
          compact={compact}
          onChannelPress={onChannelPress}
          onChannelLongPress={onChannelLongPress}
          onChannelFocus={handleChannelFocus}
          onFirstHandle={onEntryHandle}
          onEndReached={loadMoreRows}
        />
        <TVFocusGuideView style={styles.scrollHost} onLayout={handleCanvasLayout} onFocusEnter={IS_TV ? handleCellsEnter : undefined} onFocusLeave={IS_TV ? handleCellsLeave : undefined}>
          <Animated.ScrollView
            ref={gridRef}
            horizontal
            onScroll={horizontalHandler}
            scrollEventThrottle={16}
            showsHorizontalScrollIndicator={false}
            bounces={false}
            style={styles.scroll}
            contentContainerStyle={{ width: spanPx + SEAM_REACH }}>
            <Animated.FlatList
              ref={rowsRef}
              data={rows}
              renderItem={renderRow}
              keyExtractor={keyExtractor}
              getItemLayout={getItemLayout}
              snapToAlignment={IS_TV ? "item" : undefined}
              snapToInterval={IS_TV ? METRICS.rowHeight : undefined}
              scrollToOverflowEnabled={IS_TV}
              onScroll={verticalHandler}
              scrollEventThrottle={16}
              onEndReached={loadMoreRows}
              onEndReachedThreshold={1}
              viewabilityConfig={ART_ROW_VIEWABILITY}
              onViewableItemsChanged={handleRowsViewable}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={!IS_TV}
              // Two viewports each side mounted ahead of a held press, in small batches so rows
              // paint one after another instead of as a block.
              initialNumToRender={12}
              maxToRenderPerBatch={4}
              updateCellsBatchingPeriod={16}
              windowSize={5}
              style={{ height: listHeight, width: spanPx + SEAM_REACH }}
              contentContainerStyle={{ paddingBottom: listBottomPad, paddingLeft: SEAM_REACH }}
            />
          </Animated.ScrollView>
        </TVFocusGuideView>
      </View>
      {IS_TV ? <View style={[styles.seam, { left: METRICS.channelColumnWidth - 1 }]} pointerEvents="none" /> : null}
      {IS_TV ? null : (
        <GuideColumnDivider
          columnW={columnW}
          topInset={METRICS.rulerHeight + HUD_BAR_HEIGHT}
          bottomInset={TAB_BAR_HEIGHT + insets.bottom}
          gesture={resize.seam}
          gripY={resize.gripY}
          bandH={resize.bandH}
        />
      )}
      {/* After the divider: the red mark sits on top of the seam line. */}
      {seamMark}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
  },
  topRow: {
    flexDirection: "row",
  },
  // The ruler is a passive mirror of the rows' scroll: clipped here, shifted by -scrollX.
  rulerClip: {
    flex: 1,
    overflow: "hidden",
  },
  // Unstyled, RNGH's root defaults to flex: 1 and takes half the top row from the ruler.
  cornerHost: {
    flexGrow: 0,
  },
  corner: {
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: GRID_LINE,
  },
  bandRow: {
    flex: 1,
    flexDirection: "row",
  },
  entryRow: {
    flexDirection: "row",
    height: 1,
  },
  entryGuide: {
    flex: 1,
    height: 1,
  },
  // Reaches back over the seam so a cell's focus ring can cover it; the content pads the same back.
  scrollHost: {
    flex: 1,
    marginLeft: -SEAM_REACH,
  },
  scroll: {
    flex: 1,
  },
  seam: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: GRID_LINE,
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
