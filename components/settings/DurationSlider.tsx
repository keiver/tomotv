import { COLORS } from "@/constants/colors";
import React, { useCallback, useEffect, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const THUMB = 26;
const TRACK_H = 6;
const DETENT = 4;
const LABEL_SLOT = 48;
const SNAP_MS = 120;
/** Covers the label row under the track, so the whole band scrubs. */
const HIT_BELOW = 34;

interface DurationSliderProps<V extends number> {
  options: readonly { value: V; label: string }[];
  selected: V;
  onSelect: (value: V) => void;
}

/**
 * A stepped slider over a sunken track, one detent per duration, labels under the detents.
 * Phone and iPad only: the TV surface keeps focusable pills (DurationChips).
 */
export function DurationSlider<V extends number>({ options, selected, onSelect }: DurationSliderProps<V>) {
  const count = options.length;
  const last = count - 1;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === selected),
  );
  const [trackW, setTrackW] = useState(0);
  // The detent under the finger while scrubbing; null hands the highlight to the chosen value.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const liveIndex = dragIndex ?? selectedIndex;
  const x = useSharedValue(0);
  const width = useSharedValue(0);

  const commit = useCallback(
    (index: number) => {
      onSelect(options[index].value);
      setDragIndex(null);
    },
    [options, onSelect],
  );

  const onTrackLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const w = event.nativeEvent.layout.width;
      setTrackW(w);
      width.set(w);
      x.set((selectedIndex / last) * w);
    },
    [width, x, selectedIndex, last],
  );

  // An outside change (another surface writing the preference) reseats the thumb.
  useEffect(() => {
    if (width.get() > 0) x.set(withTiming((selectedIndex / last) * width.get(), { duration: SNAP_MS }));
  }, [selectedIndex, last, width, x]);

  const move = (posX: number) => {
    "worklet";
    const w = width.get();
    if (w <= 0) return;
    const nx = Math.min(w, Math.max(0, posX));
    x.set(nx);
    runOnJS(setDragIndex)(Math.round((nx / w) * last));
  };
  const snapCommit = () => {
    "worklet";
    const w = width.get();
    if (w <= 0) return;
    const index = Math.round((x.get() / w) * last);
    x.set(withTiming((index / last) * w, { duration: SNAP_MS }));
    runOnJS(commit)(index);
  };
  // Horizontal claim only: a vertical start stays a page scroll and never moves the thumb.
  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .hitSlop({ top: 12, bottom: HIT_BELOW })
    .onStart((event) => {
      "worklet";
      move(event.x);
    })
    .onUpdate((event) => {
      "worklet";
      move(event.x);
    })
    .onEnd(() => {
      "worklet";
      snapCommit();
    });
  const tap = Gesture.Tap()
    .hitSlop({ top: 12, bottom: HIT_BELOW })
    .onEnd((event) => {
      "worklet";
      move(event.x);
      snapCommit();
    });
  const gesture = Gesture.Race(pan, tap);

  const fillStyle = useAnimatedStyle(() => ({ width: x.get() }));
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  const step = useCallback((delta: number) => commit(Math.min(last, Math.max(0, selectedIndex + delta))), [commit, last, selectedIndex]);

  return (
    <GestureHandlerRootView
      style={styles.band}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={options[selectedIndex].label}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => step(event.nativeEvent.actionName === "increment" ? 1 : -1)}>
      <GestureDetector gesture={gesture}>
        <View style={styles.trackArea} onLayout={onTrackLayout} collapsable={false}>
          <View style={styles.track}>
            {options.map((option, index) => (
              <View key={option.value} style={[styles.detent, { left: `${(index / last) * 100}%` }]} />
            ))}
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>
          <Animated.View style={[styles.thumb, thumbStyle]} />
        </View>
      </GestureDetector>
      {trackW > 0 ? (
        <View style={styles.labels} pointerEvents="none">
          {options.map((option, index) => (
            <View key={option.value} style={styles.labelSlot}>
              <Text style={[styles.label, index === liveIndex && styles.labelSelected]}>{option.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  band: {
    paddingHorizontal: 20 + THUMB / 2,
    paddingTop: 22,
    paddingBottom: 14,
  },
  trackArea: {
    justifyContent: "center",
    height: THUMB,
  },
  // A sunken well, the app's track language.
  track: {
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: COLORS.SURFACE_SUNKEN,
    overflow: "hidden",
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: COLORS.ACCENT,
  },
  // Under the fill's z but inside the clipped track: unpassed stops read as marks in the well.
  detent: {
    position: "absolute",
    top: (TRACK_H - DETENT) / 2,
    marginLeft: -DETENT / 2,
    width: DETENT,
    height: DETENT,
    borderRadius: DETENT / 2,
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  thumb: {
    position: "absolute",
    left: -THUMB / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: COLORS.TEXT_PRIMARY,
    boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
  },
  // Slot centres land on the detents: the row overhangs the track by half a slot each side.
  labels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: -LABEL_SLOT / 2,
    marginTop: 10,
  },
  labelSlot: {
    width: LABEL_SLOT,
    alignItems: "center",
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.TEXT_TERTIARY,
  },
  labelSelected: {
    color: COLORS.ACCENT,
    fontWeight: "700",
  },
});
