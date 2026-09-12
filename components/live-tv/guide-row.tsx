import { GuideCell, type RecordingMark } from "@/components/live-tv/guide-cell";
import { t } from "@/services/i18n";
import type { JellyfinItem, JellyfinProgram, JellyfinTimer } from "@/types/jellyfin";
import { cellGeometry, NO_GUIDE_PREFIX, programTimes, type GuideMetrics } from "@/utils/guide";
import React from "react";
import { StyleSheet, View } from "react-native";
import type { SharedValue } from "react-native-reanimated";

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
  /** Top row only: Up leaves the canvas for the segment bar. */
  nextFocusUp?: number;
  /** The one cell that claims focus on mount, until the latch retires the claim. */
  focusProgramId?: string;
  onProgramPress: (program: JellyfinProgram, channel: JellyfinItem) => void;
  onProgramLongPress: (program: JellyfinProgram, channel: JellyfinItem) => void;
  onCellFocus?: () => void;
}

/** A window-wide stand-in cell; select tunes the channel, and it has no program panel. */
function noGuideProgram(channelId: string, windowStartMs: number, windowEndMs: number): JellyfinProgram {
  return { Id: `${NO_GUIDE_PREFIX}${channelId}`, Name: t("liveTv.noGuide"), StartDate: new Date(windowStartMs).toISOString(), EndDate: new Date(windowEndMs).toISOString() };
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
  nextFocusUp,
  focusProgramId,
  onProgramPress,
  onProgramLongPress,
  onCellFocus,
}: GuideRowProps) {
  const cellHeight = metrics.rowHeight;
  const placed = programs.filter((program) => {
    const { startMs, endMs } = programTimes(program);
    return !!program.Id && cellGeometry(startMs, endMs, windowStartMs, windowEndMs, metrics) !== null;
  });
  // A channel without guide data still needs a cell, or it can never be reached and tuned.
  const shown: JellyfinProgram[] = placed.length > 0 ? placed : [noGuideProgram(channel.Id, windowStartMs, windowEndMs)];
  return (
    <View style={[styles.row, { height: metrics.rowHeight, width: spanPx }]}>
      {shown.map((program) => {
        const { startMs, endMs } = programTimes(program);
        const geometry = cellGeometry(startMs, endMs, windowStartMs, windowEndMs, metrics);
        if (!geometry || !program.Id) return null;
        return (
          <GuideCell
            key={program.Id}
            program={program}
            left={geometry.left}
            width={geometry.width}
            height={cellHeight}
            nowMs={nowMs}
            recording={recordingMark(program, timersByProgramId)}
            scrollX={scrollX}
            nextFocusUp={nextFocusUp}
            hasTVPreferredFocus={focusProgramId === program.Id}
            onFocus={onCellFocus}
            onPress={(pressed) => onProgramPress(pressed, channel)}
            onLongPress={(pressed) => onProgramLongPress(pressed, channel)}
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
});
