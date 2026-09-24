import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { COLORS } from "@/constants/colors";
import { formatClock, MINUTE_MS, rulerTicks, type GuideMetrics } from "@/utils/guide";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
export const RULER_RED = COLORS.DESTRUCTIVE;
export const MAJOR_MARK_WIDTH = 1;
export const MAJOR_MARK_HEIGHT = IS_TV ? 16 : 10;
export const HOUR_MARK_HEIGHT = IS_TV ? 26 : 16;
const NOW_EDGE = IS_TV ? 3 : 2;
/** The gold band and its now edge stand as tall as a minor mark. */
const NOW_HEIGHT = IS_TV ? 8 : 5;

interface GuideTimeRulerProps {
  windowStartMs: number;
  windowEndMs: number;
  metrics: GuideMetrics;
  spanPx: number;
  nowMs: number;
}

/**
 * A red scale over the canvas, gold up to now; the only place "now" is drawn, never over a cell.
 * A cell's edge is the previous cell's 1px right border, one pixel left of its offset: marks sit on it, as wide as it.
 */
export function GuideTimeRuler({ windowStartMs, windowEndMs, metrics, spanPx, nowMs }: GuideTimeRulerProps) {
  const ticks = rulerTicks(windowStartMs, windowEndMs, metrics);
  const nowLeft = ((nowMs - windowStartMs) / MINUTE_MS) * metrics.pxPerMinute;
  const showNow = nowMs >= windowStartMs && nowMs < windowEndMs;
  return (
    <View style={[styles.ruler, { height: metrics.rulerHeight, width: spanPx }]} pointerEvents="none">
      {showNow ? <View style={[styles.elapsed, { width: nowLeft }]} /> : null}
      {ticks.map((tick, index) =>
        tick.isMinor ? (
          <View key={tick.atMs} style={[styles.minorMark, { left: Math.max(0, tick.left - 1) }]} />
        ) : (
          <View key={tick.atMs} style={[styles.tick, { left: Math.max(0, tick.left - 1) }]}>
            {/* The first mark is painted over the seam by GuideSeamMark; this one keeps the label's place. */}
            <View style={[styles.majorMark, tick.isHour && styles.hourMark, index === 0 && styles.hidden]} />
            <Text style={[styles.tickLabel, tick.isHour && styles.tickLabelHour]} numberOfLines={1}>
              {formatClock(tick.atMs)}
            </Text>
          </View>
        ),
      )}
      {showNow ? <View style={[styles.nowEdge, { left: nowLeft - NOW_EDGE / 2 }]} /> : null}
    </View>
  );
}

const RED = RULER_RED;

const styles = StyleSheet.create({
  ruler: {
    position: "relative",
    borderBottomWidth: 1,
    borderBottomColor: GRID_LINE,
  },
  elapsed: {
    position: "absolute",
    left: 0,
    bottom: 0,
    height: NOW_HEIGHT,
    backgroundColor: COLORS.ACCENT,
    opacity: 0.16,
  },
  minorMark: {
    position: "absolute",
    bottom: 0,
    width: 1,
    height: NOW_HEIGHT,
    backgroundColor: RED,
  },
  tick: {
    position: "absolute",
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: IS_TV ? 8 : 5,
  },
  majorMark: {
    width: MAJOR_MARK_WIDTH,
    height: MAJOR_MARK_HEIGHT,
    backgroundColor: RED,
  },
  hourMark: {
    height: HOUR_MARK_HEIGHT,
  },
  hidden: {
    opacity: 0,
  },
  tickLabel: {
    color: RED,
    fontSize: IS_TV ? 18 : 11,
    fontWeight: "600",
    paddingBottom: IS_TV ? 10 : 8,
  },
  tickLabelHour: {
    fontSize: IS_TV ? 20 : 12,
    fontWeight: "700",
  },
  nowEdge: {
    position: "absolute",
    bottom: 0,
    width: NOW_EDGE,
    height: NOW_HEIGHT,
    backgroundColor: COLORS.ACCENT,
  },
});
