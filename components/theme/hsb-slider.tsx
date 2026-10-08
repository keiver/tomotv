import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useRef, useState } from "react";
import { type LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, useTVEventHandler, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

const IS_TV = Platform.isTV;
const TRACK_H = IS_TV ? 40 : 32;
/** The value marker: a bar inside the track. */
export const KNOB_W = IS_TV ? 10 : 8;
/** The marker's gap from every edge of the track. */
export const KNOB_INSET = 3;
const ARROW = IS_TV ? 30 : 0;

/** The knob's left edge for a value: an inset from the start, the same inset short of the end at max. */
export function knobOffset(value: number, max: number, width: number): number {
  const span = Math.max(0, width - KNOB_W - 2 * KNOB_INSET);
  return KNOB_INSET + Math.round((Math.min(max, Math.max(0, value)) / max) * span);
}

/** The value under a touch at x, the inverse of knobOffset with the touch on the knob's middle. */
export function valueAt(x: number, max: number, width: number): number {
  const span = width - KNOB_W - 2 * KNOB_INSET;
  if (span <= 0) return 0;
  return Math.min(max, Math.max(0, ((x - KNOB_INSET - KNOB_W / 2) / span) * max));
}

interface HsbSliderProps {
  label: string;
  value: number;
  max: number;
  /** One press of left or right on the remote. */
  step: number;
  /** The readout beside the label: "32°", "90%". */
  readout: string;
  /** CSS linear-gradient across the track: the colours this channel runs through. */
  gradient: string;
  onChange: (value: number) => void;
  onFocus?: () => void;
  hasTVPreferredFocus?: boolean;
}

/**
 * One channel of the theme colour on a gradient track. TV: the row takes focus and left/right on
 * the remote step it. Touch: drag or tap.
 */
export function HsbSlider({ label, value, max, step, readout, gradient, onChange, onFocus, hasTVPreferredFocus = false }: HsbSliderProps) {
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const [width, setWidth] = useState(0);

  useTVEventHandler(
    useCallback(
      (event: { eventType: string }) => {
        if (!focusedRef.current) return;
        const delta = event.eventType === "right" ? step : event.eventType === "left" ? -step : 0;
        if (delta === 0) return;
        onChange(Math.min(max, Math.max(0, Math.round((value + delta) / step) * step)));
      },
      [step, max, value, onChange],
    ),
  );

  const fromTouch = useCallback((x: number, w: number) => onChange(valueAt(x, max, w)), [onChange, max]);
  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart((event) => {
      "worklet";
      runOnJS(fromTouch)(event.x, width);
    })
    .onUpdate((event) => {
      "worklet";
      runOnJS(fromTouch)(event.x, width);
    });
  const tap = Gesture.Tap().onEnd((event) => {
    "worklet";
    runOnJS(fromTouch)(event.x, width);
  });

  const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), []);

  const track = (
    <View style={[styles.track, { experimental_backgroundImage: gradient }, focused && styles.trackFocused]} onLayout={onLayout} collapsable={false}>
      {width > 0 ? <View style={[styles.knob, { left: knobOffset(value, max, width) }]} pointerEvents="none" /> : null}
    </View>
  );

  const header = (
    <View style={styles.header}>
      <Text style={[styles.label, focused && styles.labelFocused]}>{label}</Text>
      <Text style={[styles.readout, focused && styles.labelFocused]}>{readout}</Text>
    </View>
  );

  if (IS_TV) {
    return (
      <Pressable
        hasTVPreferredFocus={hasTVPreferredFocus}
        onFocus={() => {
          focusedRef.current = true;
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          focusedRef.current = false;
          setFocused(false);
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: readout }}
        style={[styles.row, styles.trackRow]}>
        {/* One line on TV: label, track, value, so three sliders fit the screen with the palette. */}
        <Text style={[styles.label, styles.tvLabel, focused && styles.labelFocused]}>{label}</Text>
        <Ionicons name="chevron-back" size={ARROW} color={focused ? COLORS.TEXT_PRIMARY : "transparent"} />
        <View style={styles.trackFlex}>{track}</View>
        <Ionicons name="chevron-forward" size={ARROW} color={focused ? COLORS.TEXT_PRIMARY : "transparent"} />
        <Text style={[styles.readout, styles.tvReadout, focused && styles.labelFocused]}>{readout}</Text>
      </Pressable>
    );
  }

  return (
    <GestureHandlerRootView
      style={styles.row}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: readout }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => onChange(Math.min(max, Math.max(0, value + (event.nativeEvent.actionName === "increment" ? step : -step))))}>
      {header}
      <GestureDetector gesture={Gesture.Race(pan, tap)}>{track}</GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: IS_TV ? 6 : 6,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  label: {
    fontSize: IS_TV ? 24 : 13,
    fontWeight: "600",
    color: COLORS.TEXT_SECONDARY,
    textTransform: "uppercase",
  },
  labelFocused: {
    color: COLORS.TEXT_PRIMARY,
  },
  readout: {
    fontSize: IS_TV ? 24 : 13,
    fontWeight: "600",
    color: COLORS.TEXT_SECONDARY,
    fontVariant: ["tabular-nums"],
  },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  tvLabel: {
    width: 220,
  },
  tvReadout: {
    width: 90,
    textAlign: "right",
  },
  trackFlex: {
    flex: 1,
  },
  // Square, like the palette's tiles. The focus ring is an inset shadow, so focus never shifts the layout.
  track: {
    height: TRACK_H,
  },
  trackFocused: {
    boxShadow: `inset 0 0 0 3px ${COLORS.TEXT_PRIMARY}`,
  },
  // White with a dark rim drawn inside its own box, so it reads on every gradient. Inset on every
  // side, so it never touches the track's edges or the focus ring.
  knob: {
    position: "absolute",
    top: KNOB_INSET,
    bottom: KNOB_INSET,
    width: KNOB_W,
    backgroundColor: COLORS.TEXT_PRIMARY,
    borderWidth: 2,
    borderColor: "rgba(0, 0, 0, 0.55)",
  },
});
