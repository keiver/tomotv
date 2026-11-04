import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { GuideGrip } from "@/components/live-tv/guide-grip";
import { type ColumnStop, nearestColumnStop, wideColumnWidth } from "@/utils/guide";
import React, { useCallback, useMemo, useRef } from "react";
import { type LayoutChangeEvent, StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, type SharedValue, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

const GRIP_WIDTH = 48;
const HIT_HEIGHT = 64;
const STOP_SPRING = { damping: 22, stiffness: 220, mass: 0.8 };
/** The grip opens 20% up from the screen's bottom: the one-handed thumb's natural zone, clear of the corner. */
const REST_FROM_BOTTOM = 0.2;
/** Movement before a seam drag commits to resizing or to sliding the grip. */
const AXIS_LOCK = 8;

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

interface ColumnResizeOptions {
  /** The channel column's live width; the drag writes it, the column reads it. */
  columnW: SharedValue<number>;
  /** The whole guide's width: the wide stop is a share of it. */
  canvasW: SharedValue<number>;
  /** The closed stop: the logo tile's width. */
  minWidth: number;
  /** The default stop: the card's own width. */
  defaultWidth: number;
  /** Fires when a drag lets go, with the stop the column springs to and that stop's width. */
  onSettle: (stop: ColumnStop, width: number) => void;
  /** Fires once the column has sprung to rest at that width, so the lists lay out at it with no scale left over. */
  onRest: (width: number) => void;
  /** Fires when a drag commits to resizing the column. */
  onResizeStart: () => void;
}

/** The seam grip's pan: drag across between the closed, default and wide stops, along the line to move the grip. */
export function useColumnResize({ columnW, canvasW, minWidth, defaultWidth, onSettle, onRest, onResizeStart }: ColumnResizeOptions) {
  const start = useSharedValue(0);
  // The seam grip also slides along its line: its offset from the band's centre, and the band's height.
  const gripY = useSharedValue(0);
  const gripStartY = useSharedValue(0);
  const bandH = useSharedValue(0);
  const axis = useSharedValue<"x" | "y" | null>(null);
  return useMemo(() => {
    const stops = () => {
      "worklet";
      return { closed: minWidth, default: defaultWidth, wide: wideColumnWidth(canvasW.get(), defaultWidth) };
    };
    const resize = (translationX: number) => {
      "worklet";
      columnW.set(clamp(start.get() + translationX, minWidth, stops().wide));
    };
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
          if (axis.get() === "x") runOnJS(onResizeStart)();
        }
        if (axis.get() === "x") {
          resize(event.translationX);
        } else {
          const reach = Math.max(0, (bandH.get() - HIT_HEIGHT) / 2);
          gripY.set(clamp(gripStartY.get() + event.translationY, -reach, reach));
        }
      })
      .onFinalize((event) => {
        "worklet";
        if (axis.get() !== "x") return;
        const widths = stops();
        const stop = nearestColumnStop(columnW.get(), event.velocityX, widths);
        const width = widths[stop];
        columnW.set(
          withSpring(width, STOP_SPRING, (finished) => {
            "worklet";
            if (finished) runOnJS(onRest)(width);
          }),
        );
        runOnJS(onSettle)(stop, width);
      });
    return { seam, gripY, bandH };
  }, [columnW, canvasW, minWidth, defaultWidth, start, onSettle, onRest, onResizeStart, gripY, gripStartY, bandH, axis]);
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
  const { height: windowH } = useWindowDimensions();
  const bandRef = useRef<View>(null);
  const placed = useRef(false);
  const handleBandLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      bandH.set(height);
      const reach = Math.max(0, (height - HIT_HEIGHT) / 2);
      // A later layout (rotation) keeps the grip where it is, back inside the new band.
      if (placed.current) {
        gripY.set(clamp(gripY.get(), -reach, reach));
        return;
      }
      placed.current = true;
      bandRef.current?.measureInWindow((_x, y) => {
        gripY.set(clamp(windowH * (1 - REST_FROM_BOTTOM) - (y + height / 2), -reach, reach));
      });
    },
    [bandH, gripY, windowH],
  );

  return (
    <GestureHandlerRootView style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.seat, seatStyle]} pointerEvents="box-none">
        <View style={styles.line} pointerEvents="none" />
        <View ref={bandRef} style={[styles.gripWrap, { top: topInset, bottom: bottomInset }]} pointerEvents="box-none" onLayout={handleBandLayout}>
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
