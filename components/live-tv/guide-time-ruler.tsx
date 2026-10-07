import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { formatClock, MINUTE_MS, rulerTicks, type CanvasSpan, type GuideMetrics } from "@/utils/guide";
import React, { useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { type AnimatedRef, cancelAnimation, type SharedValue, scrollTo, useAnimatedReaction, useSharedValue, withDecay } from "react-native-reanimated";
import type Animated from "react-native-reanimated";

const IS_TV = Platform.isTV;
export const RULER_RED = COLORS.DESTRUCTIVE;
export const MAJOR_MARK_WIDTH = 1;
export const MAJOR_MARK_HEIGHT = IS_TV ? 16 : 10;
export const HOUR_MARK_HEIGHT = IS_TV ? 26 : 16;
const NOW_LABEL_LANE = IS_TV ? 28 : 17;
const NOW_EDGE = IS_TV ? 3 : 2;
/** The gold band stands as tall as a minor mark; its now edge spans the ruler. */
const NOW_HEIGHT = IS_TV ? 8 : 5;
const LABEL_LEFT = IS_TV ? 2.5 : 2;

interface GuideTimeRulerProps {
  windowStartMs: number;
  windowEndMs: number;
  metrics: GuideMetrics;
  spanPx: number;
  nowMs: number;
  /** Only the marks inside this stretch are drawn; undefined draws the whole window's. */
  mountSpan?: CanvasSpan;
}

/** Phone: dragging the ruler scrolls the grid under it, a release flings it on with native-like decay. */
export function useRulerScrub(scrollRef: AnimatedRef<Animated.ScrollView>, scrollX: SharedValue<number>, maxX: number) {
  const start = useSharedValue(0);
  const target = useSharedValue(0);
  useAnimatedReaction(
    () => target.get(),
    (x, previous) => {
      if (previous !== null && x !== previous) scrollTo(scrollRef, x, 0, false);
    },
  );
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          "worklet";
          cancelAnimation(target);
          start.set(scrollX.get());
          target.set(scrollX.get());
        })
        .onUpdate((event) => {
          "worklet";
          target.set(Math.min(maxX, Math.max(0, start.get() - event.translationX)));
        })
        .onEnd((event) => {
          "worklet";
          target.set(withDecay({ velocity: -event.velocityX, clamp: [0, maxX] }));
        }),
    [start, target, scrollX, maxX],
  );
  // The grid's own drag takes over from a fling still in flight.
  const stop = () => {
    "worklet";
    cancelAnimation(target);
  };
  return { gesture, stop };
}

/**
 * A red scale over the canvas, the accent up to now; the only place "now" is drawn, never over a cell.
 * A cell's edge is the previous cell's 1px right border, one pixel left of its offset: marks sit on it, as wide as it.
 */
export function GuideTimeRuler({ windowStartMs, windowEndMs, metrics, spanPx, nowMs, mountSpan }: GuideTimeRulerProps) {
  const ticks = rulerTicks(windowStartMs, windowEndMs, metrics, mountSpan);
  // Floored to the minute its label reads, so at :00 and :30 the mark sits on the tick.
  const minuteMs = nowMs - (nowMs % MINUTE_MS);
  const nowLeft = ((minuteMs - windowStartMs) / MINUTE_MS) * metrics.pxPerMinute;
  const showNow = nowMs >= windowStartMs && nowMs < windowEndMs;
  const { accent } = useCardPalette();
  return (
    <View style={[styles.ruler, { height: metrics.rulerHeight, width: spanPx }]} pointerEvents="none">
      {showNow ? <View style={[styles.elapsed, { width: nowLeft, backgroundColor: accent }]} /> : null}
      {ticks.map((tick) =>
        tick.isMinor ? (
          <View key={tick.atMs} style={[styles.minorMark, { left: Math.max(0, tick.left - 1) }]} />
        ) : (
          <View key={tick.atMs} style={[styles.tick, { left: Math.max(0, tick.left - 1) }]}>
            {/* The window's first mark is painted over the seam by GuideSeamMark; this one keeps the label's place. */}
            <View style={[styles.majorMark, tick.isHour && styles.hourMark, tick.atMs === windowStartMs && styles.hidden]} />
            <Text style={[styles.tickLabel, tick.isHour && styles.tickLabelHour]} numberOfLines={1}>
              {formatClock(tick.atMs)}
            </Text>
          </View>
        ),
      )}
      {showNow ? <View style={[styles.nowEdge, { left: nowLeft - NOW_EDGE / 2, backgroundColor: accent }]} /> : null}
      {showNow ? (
        <Text style={[styles.nowLabel, { left: nowLeft - MAJOR_MARK_WIDTH + LABEL_LEFT + 1.5, color: accent }]} numberOfLines={1}>
          {formatClock(minuteMs)}
        </Text>
      ) : null}
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
    alignItems: "flex-start",
    justifyContent: "flex-end",
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
  // Sits on top of its mark, nudged just right of the line.
  // Explicit width: the 1px tick parent would clamp an auto-sized absolute label to nothing.
  tickLabel: {
    position: "absolute",
    left: LABEL_LEFT,
    bottom: MAJOR_MARK_HEIGHT,
    width: IS_TV ? 120 : 70,
    color: RED,
    fontSize: IS_TV ? 18 : 11,
    fontWeight: "600",
  },
  tickLabelHour: {
    bottom: HOUR_MARK_HEIGHT,
    fontSize: IS_TV ? 20 : 12,
    fontWeight: "700",
  },
  nowEdge: {
    position: "absolute",
    bottom: 0,
    top: 0,
    width: NOW_EDGE,
  },
  // The top lane of the band, above the red labels.
  nowLabel: {
    position: "absolute",
    top: 0,
    lineHeight: NOW_LABEL_LANE,
    fontSize: IS_TV ? 24 : 14,
    fontWeight: "700",
  },
});
