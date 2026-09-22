import { GRID_LINE, GuideCell, type RecordingMark } from "@/components/live-tv/guide-cell";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import type { JellyfinItem, JellyfinProgram, JellyfinTimer } from "@/types/jellyfin";
import { cellGeometry, NO_GUIDE_PREFIX, programTimes, repeatedArt, type GuideMetrics } from "@/utils/guide";
import React, { useCallback, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";

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
  scrollX: SharedValue<number>;
  rowIndex: number;
  /** Top row only: Up leaves the canvas for the screen's actions above it. */
  nextFocusUp?: number;
  /** TV: asked on a cell's focus; the answer rides that cell until it blurs. */
  targetsFor?: FocusTargetsFor;
  /** The one cell that claims focus on mount, until the latch retires the claim. */
  focusProgramId?: string;
  onProgramPress: (program: JellyfinProgram, channel: JellyfinItem) => void;
  onProgramLongPress: (program: JellyfinProgram, channel: JellyfinItem) => void;
  onCellFocus?: (program: JellyfinProgram, channel: JellyfinItem) => void;
  onCellHandle?: (programId: string, handle: number | undefined) => void;
}

/** A window-wide stand-in cell; select tunes the channel, and it has no program panel. */
function noGuideProgram(channelId: string, windowStartMs: number, windowEndMs: number): JellyfinProgram {
  return {
    Id: `${NO_GUIDE_PREFIX}${channelId}`,
    Name: t("liveTv.noGuide"),
    EpisodeTitle: t("liveTv.noGuideHint"),
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
  return placed.length > 0 ? placed : [noGuideProgram(channel.Id, windowStartMs, windowEndMs)];
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
  rowIndex,
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
  const press = useCallback((program: JellyfinProgram) => onProgramPress(program, channel), [onProgramPress, channel]);
  const longPress = useCallback((program: JellyfinProgram) => onProgramLongPress(program, channel), [onProgramLongPress, channel]);
  const focus = useCallback(
    (program: JellyfinProgram) => {
      if (targetsFor && program.Id) setFocusTargets({ programId: program.Id, ...targetsFor(rowIndex, program) });
      onCellFocus?.(program, channel);
    },
    [targetsFor, rowIndex, onCellFocus, channel],
  );
  const blur = useCallback((program: JellyfinProgram) => setFocusTargets((current) => (current?.programId === program.Id ? undefined : current)), []);
  return (
    // TV: a focused cell lands its row on the list's top edge (snapToAlignment="item" on the list).
    <View style={[styles.row, { height: metrics.rowHeight, width: spanPx }]} scrollSnapAlign={IS_TV ? "start" : undefined}>
      <View style={styles.line} pointerEvents="none" />
      {(() => {
        const cells = rowCells(channel, programs, windowStartMs, windowEndMs, metrics);
        const repeats = repeatedArt(cells);
        return cells.map((program, index) => {
          const { startMs, endMs } = programTimes(program);
          const geometry = cellGeometry(startMs, endMs, windowStartMs, windowEndMs, metrics);
          if (!geometry || !program.Id) return null;
          const targets = focusTargets?.programId === program.Id ? focusTargets : undefined;
          return (
            <GuideCell
              key={program.Id}
              program={program}
              left={geometry.left}
              width={geometry.width}
              height={cellHeight}
              nowMs={nowMs}
              recording={recordingMark(program, timersByProgramId)}
              artDimmed={repeats[index]}
              scrollX={scrollX}
              nextFocusUp={targets?.up ?? nextFocusUp}
              nextFocusDown={targets?.down}
              hasTVPreferredFocus={focusProgramId === program.Id}
              onFocus={focus}
              onBlur={IS_TV ? blur : undefined}
              onHandle={onCellHandle}
              onPress={press}
              onLongPress={longPress}
            />
          );
        });
      })()}
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
