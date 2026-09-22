import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { COLORS } from "@/constants/colors";
import { formatClock, MINUTE_MS, rulerTicks, type GuideMetrics } from "@/utils/guide";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const NOW_EDGE = IS_TV ? 3 : 2;

interface GuideTimeRulerProps {
  windowStartMs: number;
  windowEndMs: number;
  metrics: GuideMetrics;
  spanPx: number;
  nowMs: number;
}

/** A red scale over the canvas, gold up to now; the only place "now" is drawn, never over a cell. */
export function GuideTimeRuler({ windowStartMs, windowEndMs, metrics, spanPx, nowMs }: GuideTimeRulerProps) {
  const ticks = rulerTicks(windowStartMs, windowEndMs, metrics);
  const nowLeft = ((nowMs - windowStartMs) / MINUTE_MS) * metrics.pxPerMinute;
  const showNow = nowMs >= windowStartMs && nowMs < windowEndMs;
  return (
    <View style={[styles.ruler, { height: metrics.rulerHeight, width: spanPx }]} pointerEvents="none">
      {showNow ? <View style={[styles.elapsed, { width: nowLeft }]} /> : null}
      {ticks.map((tick) =>
        tick.isMinor ? (
          <View key={tick.atMs} style={[styles.minorMark, { left: tick.left }]} />
        ) : (
          <View key={tick.atMs} style={[styles.tick, { left: tick.left }]}>
            <View style={[styles.majorMark, tick.isHour && styles.hourMark]} />
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

const RED = COLORS.DESTRUCTIVE;

const styles = StyleSheet.create({
  ruler: {
    position: "relative",
    borderBottomWidth: 1,
    borderBottomColor: GRID_LINE,
  },
  elapsed: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: COLORS.ACCENT,
    opacity: 0.16,
  },
  minorMark: {
    position: "absolute",
    bottom: 0,
    width: 1,
    height: IS_TV ? 8 : 5,
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
    width: 2,
    height: IS_TV ? 16 : 10,
    backgroundColor: RED,
  },
  hourMark: {
    height: IS_TV ? 26 : 16,
  },
  tickLabel: {
    color: RED,
    fontSize: IS_TV ? 18 : 11,
    fontWeight: "600",
    paddingBottom: IS_TV ? 6 : 3,
  },
  tickLabelHour: {
    fontSize: IS_TV ? 20 : 12,
    fontWeight: "700",
  },
  nowEdge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: NOW_EDGE,
    backgroundColor: COLORS.ACCENT,
  },
});
