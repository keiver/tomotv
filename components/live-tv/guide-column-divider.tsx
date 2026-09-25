import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { GuideGrip } from "@/components/live-tv/guide-grip";
import React, { useCallback, useMemo } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, type SharedValue, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

const GRIP_WIDTH = 48;
/** The channel column may take at most this fraction of the guide, so the grid always survives. */
const MAX_RATIO = 0.6;
/** Drag within this of the logo-only width and the column magnets to it, collapsing to logos alone. */
const SNAP_ZONE = 56;
const HIT_HEIGHT = 64;
/** Movement before a seam drag commits to resizing or to sliding the grip. */
const AXIS_LOCK = 8;

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

interface ColumnResizeOptions {
  /** The channel column's live width; the drag writes it, the column reads it. */
  columnW: SharedValue<number>;
  /** The whole guide's width, so the column's ceiling tracks the viewport. */
  canvasW: SharedValue<number>;
  /** The portrait-card width the left magnet lands on. */
  minWidth: number;
  /** The card's full width: the column never opens past what the card fills. */
  maxWidth: number;
  /** Fires when the left magnet takes hold or lets go, so the rows collapse to logos and back. */
  onCompactChange: (compact: boolean) => void;
}

/** One resize, two handles: the seam's grip and the NOW cell each get a pan over the same drag state. */
export function useColumnResize({ columnW, canvasW, minWidth, maxWidth, onCompactChange }: ColumnResizeOptions) {
  const start = useSharedValue(0);
  const compact = useSharedValue(false);
  // The seam grip also slides along its line: its offset from the band's centre, and the band's height.
  const gripY = useSharedValue(0);
  const gripStartY = useSharedValue(0);
  const bandH = useSharedValue(0);
  const axis = useSharedValue<"x" | "y" | null>(null);
  return useMemo(() => {
    const resize = (translationX: number) => {
      "worklet";
      const max = Math.max(minWidth, Math.min(maxWidth, canvasW.get() * MAX_RATIO));
      const raw = clamp(start.get() + translationX, minWidth, max);
      const wantCompact = raw < minWidth + SNAP_ZONE;
      // Inside the zone the column sticks to the logo width: the magnet.
      columnW.set(wantCompact ? minWidth : raw);
      if (wantCompact !== compact.get()) {
        compact.set(wantCompact);
        runOnJS(onCompactChange)(wantCompact);
      }
    };
    const corner = Gesture.Pan()
      .onBegin(() => {
        "worklet";
        start.set(columnW.get());
      })
      .onUpdate((event) => {
        "worklet";
        resize(event.translationX);
      });
    // One axis per drag, picked by the first movement, so sliding the grip never nudges the width.
    const seam = Gesture.Pan()
      .onBegin(() => {
        "worklet";
        start.set(columnW.get());
        gripStartY.set(gripY.get());
        axis.set(null);
      })
      .onUpdate((event) => {
        "worklet";
        if (axis.get() === null) {
          if (Math.max(Math.abs(event.translationX), Math.abs(event.translationY)) < AXIS_LOCK) return;
          axis.set(Math.abs(event.translationX) >= Math.abs(event.translationY) ? "x" : "y");
        }
        if (axis.get() === "x") {
          resize(event.translationX);
        } else {
          const reach = Math.max(0, (bandH.get() - HIT_HEIGHT) / 2);
          gripY.set(clamp(gripStartY.get() + event.translationY, -reach, reach));
        }
      });
    return { seam, corner, gripY, bandH };
  }, [columnW, canvasW, minWidth, maxWidth, start, compact, onCompactChange, gripY, gripStartY, bandH, axis]);
}

interface GuideColumnDividerProps {
  columnW: SharedValue<number>;
  /** Points clear at the top (ruler) and bottom (tab bar) so the grip centres on the visible seam. */
  topInset: number;
  bottomInset: number;
  /** The seam's pan, the grip's offset along the line, and the band it slides in, from useColumnResize. */
  gesture: ReturnType<typeof Gesture.Pan>;
  gripY: SharedValue<number>;
  bandH: SharedValue<number>;
}

/** A grip on the column/grid seam: drag across to resize, along the line to move it. Phone only. */
export function GuideColumnDivider({ columnW, topInset, bottomInset, gesture, gripY, bandH }: GuideColumnDividerProps) {
  // The seat straddles the seam; the line and grip share its centre, so the grip can never drift
  // off the line. Follows the column's live width.
  const seatStyle = useAnimatedStyle(() => ({ left: columnW.get() - GRIP_WIDTH / 2 }));
  const gripStyle = useAnimatedStyle(() => ({ transform: [{ translateY: gripY.get() }] }));
  const handleBandLayout = useCallback((event: LayoutChangeEvent) => bandH.set(event.nativeEvent.layout.height), [bandH]);

  return (
    <GestureHandlerRootView style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.seat, seatStyle]} pointerEvents="box-none">
        <View style={styles.line} pointerEvents="none" />
        <View style={[styles.gripWrap, { top: topInset, bottom: bottomInset }]} pointerEvents="box-none" onLayout={handleBandLayout}>
          <GestureDetector gesture={gesture}>
            <Animated.View style={[styles.hit, gripStyle]}>
              <GuideGrip size={36} arrowSize={16} />
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
    height: HIT_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
});
