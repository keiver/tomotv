import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { LOGO_ONLY_WIDTH } from "@/components/live-tv/guide-channel-row";
import { COLORS } from "@/constants/colors";
import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, type SharedValue, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

const GRIP_WIDTH = 26;
/** The channel column may take at most this fraction of the guide, so the grid always survives. */
const MAX_RATIO = 0.6;
/** Drag within this of the logo-only width and the column magnets to it, collapsing to logos alone. */
const SNAP_ZONE = 56;

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

interface GuideColumnDividerProps {
  /** The channel column's live width; the drag writes it, the column reads it. */
  columnW: SharedValue<number>;
  /** The whole guide's width, so the column's ceiling tracks the viewport. */
  canvasW: SharedValue<number>;
  /** Points clear at the top (ruler) and bottom (tab bar) so the grip centres on the visible seam. */
  topInset: number;
  bottomInset: number;
  /** Fires when the left magnet takes hold or lets go, so the rows collapse to logos and back. */
  onCompactChange: (compact: boolean) => void;
}

/** A grip sitting on the column/grid seam, mid-screen; drag it to resize. Phone only. */
export function GuideColumnDivider({ columnW, canvasW, topInset, bottomInset, onCompactChange }: GuideColumnDividerProps) {
  const start = useSharedValue(0);
  const compact = useSharedValue(false);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          "worklet";
          start.set(columnW.get());
        })
        .onUpdate((event) => {
          "worklet";
          const max = Math.max(LOGO_ONLY_WIDTH, canvasW.get() * MAX_RATIO);
          const raw = clamp(start.get() + event.translationX, LOGO_ONLY_WIDTH, max);
          const wantCompact = raw < LOGO_ONLY_WIDTH + SNAP_ZONE;
          // Inside the zone the column sticks to the logo width: the magnet.
          columnW.set(wantCompact ? LOGO_ONLY_WIDTH : raw);
          if (wantCompact !== compact.get()) {
            compact.set(wantCompact);
            runOnJS(onCompactChange)(wantCompact);
          }
        }),
    [columnW, canvasW, start, compact, onCompactChange],
  );
  // The seat straddles the seam; the line and grip share its centre, so the grip can never drift
  // off the line. Follows the column's live width.
  const seatStyle = useAnimatedStyle(() => ({ left: columnW.get() - GRIP_WIDTH / 2 }));

  return (
    <GestureHandlerRootView style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.seat, seatStyle]} pointerEvents="box-none">
        <View style={styles.line} pointerEvents="none" />
        <View style={[styles.gripWrap, { top: topInset, bottom: bottomInset }]} pointerEvents="box-none">
          <GestureDetector gesture={pan}>
            <Animated.View style={styles.hit}>
              <Animated.View style={styles.grip} />
            </Animated.View>
          </GestureDetector>
        </View>
      </Animated.View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  seat: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: GRIP_WIDTH,
  },
  // The seam itself, full height and dead centre of the seat.
  line: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: (GRIP_WIDTH - 1) / 2,
    width: 1,
    backgroundColor: GRID_LINE,
  },
  // Holds the grip in the visible band, centred on the line.
  gripWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  hit: {
    width: GRIP_WIDTH,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  grip: {
    width: 5,
    height: 44,
    borderRadius: 3,
    backgroundColor: COLORS.ACCENT,
  },
});
