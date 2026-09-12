import { COLORS } from "@/constants/colors";
import { formatClock, MINUTE_MS, rulerTicks, type GuideMetrics } from "@/utils/guide";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface GuideTimeRulerProps {
  windowStartMs: number;
  windowEndMs: number;
  metrics: GuideMetrics;
  spanPx: number;
  nowMs: number;
}

/** Half-hour ticks over the canvas and the now mark; the only place "now" is drawn, never over a cell. */
export function GuideTimeRuler({ windowStartMs, windowEndMs, metrics, spanPx, nowMs }: GuideTimeRulerProps) {
  const ticks = rulerTicks(windowStartMs, windowEndMs, metrics);
  const nowLeft = ((nowMs - windowStartMs) / MINUTE_MS) * metrics.pxPerMinute;
  const showNow = nowMs >= windowStartMs && nowMs < windowEndMs;
  return (
    <View style={[styles.ruler, { height: metrics.rulerHeight, width: spanPx }]} pointerEvents="none">
      {ticks.map((tick) => (
        <View key={tick.atMs} style={[styles.tick, { left: tick.left }]}>
          <View style={[styles.tickMark, tick.isHour && styles.tickMarkHour]} />
          <Text style={[styles.tickLabel, tick.isHour && styles.tickLabelHour]} numberOfLines={1}>
            {formatClock(tick.atMs)}
          </Text>
        </View>
      ))}
      {showNow ? <View style={[styles.nowMark, { left: nowLeft - (IS_TV ? 3 : 2) }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ruler: {
    position: "relative",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.12)",
  },
  tick: {
    position: "absolute",
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: IS_TV ? 10 : 6,
    paddingBottom: IS_TV ? 10 : 6,
  },
  tickMark: {
    width: 1,
    height: IS_TV ? 12 : 8,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
  },
  tickMarkHour: {
    height: IS_TV ? 20 : 12,
    backgroundColor: "rgba(255, 255, 255, 0.5)",
  },
  tickLabel: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 20 : 12,
    fontWeight: "600",
  },
  tickLabelHour: {
    color: COLORS.TEXT_BRIGHT,
  },
  nowMark: {
    position: "absolute",
    bottom: 0,
    width: IS_TV ? 6 : 4,
    height: IS_TV ? 16 : 10,
    borderRadius: 3,
    backgroundColor: COLORS.ACCENT,
  },
});
