import { GRID_LINE, GuideCell, type RecordingMark } from "@/components/live-tv/guide-cell";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import type { JellyfinItem, JellyfinProgram, JellyfinTimer } from "@/types/jellyfin";
import { cellGeometry, cellInSpan, NO_GUIDE_PREFIX, programTimes, type CanvasSpan, type GuideMetrics } from "@/utils/guide";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Platform, type Animated, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;

/** The neighbouring cells one focused cell names: set on that cell alone. */
export interface FocusTargets {
  programId: string;
  up?: number;
  down?: number;
}
/** Names the cells above and below a program's focused cell, by native handle. */
export type FocusTargetsFor = (rowIndex: number, program: JellyfinProgram) => Pick<FocusTargets, "up" | "down">;

interface GuideRowProps {
  channel: JellyfinItem;
  programs: JellyfinProgram[];
  windowStartMs: number;
  windowEndMs: number;
  metrics: GuideMetrics;
  spanPx: number;
  nowMs: number;
  timersByProgramId: Map<string, JellyfinTimer>;
  /** The grid's native-driven horizontal offset, for the cells' pins. */
  scrollX: Animated.Value;
  /** The rows' visible width: a reel longer than the screen fades at its edge. */
  viewportWidth: number;
  /** Only cells overlapping this horizontal span mount; undefined mounts every cell. */
  mountSpan?: CanvasSpan;
  /** Cells overlapping this span show their poster and reel; the canvas hands it to the rows in view alone, undefined shows none. */
  artSpan?: CanvasSpan;
  rowIndex: number;
  /** TV: where a focus scroll lands this row's top in the list (react-native-tvos item snap). */
  snapOffset?: number;
  /** Top row only: Up leaves the canvas for the screen's actions above it. */
  nextFocusUp?: number;
  /** TV: asked on a cell's focus; the answer rides that cell until it blurs. */
  targetsFor?: FocusTargetsFor;
  /** The one cell that claims focus on mount, until the latch retires the claim. */
  focusProgramId?: string;
  onProgramPress: (program: JellyfinProgram, channel: JellyfinItem) => void;
  onProgramLongPress: (program: JellyfinProgram, channel: JellyfinItem) => void;
  onCellFocus?: (program: JellyfinProgram, channel: JellyfinItem) => void;
  onCellHandle?: (programId: string, handle: number | undefined, node: View | null) => void;
}

/** A window-wide stand-in cell; select tunes the channel, and it has no program panel. */
function noGuideProgram(channel: JellyfinItem, windowStartMs: number, windowEndMs: number): JellyfinProgram {
  return {
    Id: `${NO_GUIDE_PREFIX}${channel.Id}`,
    Name: t("liveTv.noGuide"),
    EpisodeTitle: IS_TV ? t("liveTv.noGuideHint") : undefined,
    StartDate: new Date(windowStartMs).toISOString(),
    EndDate: new Date(windowEndMs).toISOString(),
  };
}

/** The cells a row draws: its programs inside the window, or the stand-in when it has none. */
export function rowCells(channel: JellyfinItem, programs: JellyfinProgram[], windowStartMs: number, windowEndMs: number, metrics: GuideMetrics): JellyfinProgram[] {
  const placed = programs.filter((program) => {
    const { startMs, endMs } = programTimes(program);
    return !!program.Id && cellGeometry(startMs, endMs, windowStartMs, windowEndMs, metrics) !== null;
  });
  return placed.length > 0 ? placed : [noGuideProgram(channel, windowStartMs, windowEndMs)];
}

function recordingMark(program: JellyfinProgram, timers: Map<string, JellyfinTimer>): RecordingMark {
  const timer = program.Id ? timers.get(program.Id) : undefined;
  if (!timer) return null;
  return timer.SeriesTimerId ? "series" : "single";
}

/** One channel's programs laid across the window; the canvas virtualizes these. */
function GuideRowComponent({
  channel,
  programs,
  windowStartMs,
  windowEndMs,
  metrics,
  spanPx,
  nowMs,
  timersByProgramId,
  scrollX,
  viewportWidth,
  mountSpan,
  artSpan,
  rowIndex,
  snapOffset,
  nextFocusUp,
  targetsFor,
  focusProgramId,
  onProgramPress,
  onProgramLongPress,
  onCellFocus,
  onCellHandle,
}: GuideRowProps) {
  const cellHeight = metrics.rowHeight - 1;
  // Row-local, so a focus move re-renders this row and the one it left, never the canvas.
  const [focusTargets, setFocusTargets] = useState<FocusTargets | undefined>(undefined);
  const focusedIdRef = useRef<string | null>(null);
  const press = useCallback((program: JellyfinProgram) => onProgramPress(program, channel), [onProgramPress, channel]);
  const longPress = useCallback((program: JellyfinProgram) => onProgramLongPress(program, channel), [onProgramLongPress, channel]);
  const focus = useCallback(
    (program: JellyfinProgram) => {
      if (targetsFor && program.Id) {
        const programId = program.Id;
        focusedIdRef.current = programId;
        // A tick later: the mount claim's focus event lands inside React's commit, where
        // targetsFor may not read the scroll offset's shared value.
        setTimeout(() => {
          if (focusedIdRef.current === programId) setFocusTargets({ programId, ...targetsFor(rowIndex, program) });
        }, 0);
      }
      onCellFocus?.(program, channel);
    },
    [targetsFor, rowIndex, onCellFocus, channel],
  );
  // Placed once per listing change: the canvas re-renders every row on each page step and art settle.
  const placed = useMemo(
    () =>
      rowCells(channel, programs, windowStartMs, windowEndMs, metrics).flatMap((program) => {
        const { startMs, endMs } = programTimes(program);
        const geometry = cellGeometry(startMs, endMs, windowStartMs, windowEndMs, metrics);
        return geometry && program.Id ? [{ program, programId: program.Id, geometry, startMs, endMs }] : [];
      }),
    [channel, programs, windowStartMs, windowEndMs, metrics],
  );
  const blur = useCallback((program: JellyfinProgram) => {
    if (focusedIdRef.current === program.Id) focusedIdRef.current = null;
    setFocusTargets((current) => (current?.programId === program.Id ? undefined : current));
  }, []);
  return (
    <View style={[styles.row, { height: metrics.rowHeight, width: spanPx }]} scrollSnapOffset={snapOffset}>
      <View style={styles.line} pointerEvents="none" />
      {placed.map(({ program, programId, geometry, startMs, endMs }) => {
        if (mountSpan && !cellInSpan(geometry, mountSpan)) return null;
        const showArt = artSpan !== undefined && cellInSpan(geometry, artSpan);
        const targets = focusTargets?.programId === programId ? focusTargets : undefined;
        return (
          <GuideCell
            key={programId}
            program={program}
            left={geometry.left}
            width={geometry.width}
            height={cellHeight}
            startMs={startMs}
            endMs={endMs}
            past={endMs <= nowMs}
            airing={startMs <= nowMs && nowMs < endMs}
            recording={recordingMark(program, timersByProgramId)}
            scrollX={scrollX}
            viewportWidth={viewportWidth}
            showArt={showArt}
            nextFocusUp={targets?.up ?? nextFocusUp}
            nextFocusDown={targets?.down}
            hasTVPreferredFocus={focusProgramId === programId}
            onFocus={focus}
            onBlur={IS_TV ? blur : undefined}
            onHandle={onCellHandle}
            onPress={press}
            onLongPress={longPress}
          />
        );
      })}
    </View>
  );
}

export const GuideRow = React.memo(GuideRowComponent);

const styles = StyleSheet.create({
  row: {
    position: "relative",
  },
  // The grid line over the cell surface, in the strip below the cells.
  line: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: COLORS.SURFACE,
    borderBottomWidth: 1,
    borderColor: GRID_LINE,
  },
});
