import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { GRIP_SIZE, GuideGrip } from "@/components/live-tv/guide-grip";
import { t } from "@/services/i18n";
import { columnDragWidth, type ColumnStop, columnStopAt, columnStopStep, settleColumnStop, wideColumnWidth } from "@/utils/guide";
import React, { useCallback, useMemo, useRef } from "react";
import { type LayoutChangeEvent, StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, runOnUI, type SharedValue, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

const GRIP_WIDTH = 48;
const HIT_HEIGHT = 64;
/** Damped to the edge of bouncing and clamped at the stop: the column decelerates into it and stays, never swinging past. */
const STOP_SPRING = { damping: 32, stiffness: 260, mass: 1, overshootClamping: true };
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
  /** Fires each time a drag carries the column past halfway to another stop: the detent's tick. */
  onDetent: () => void;
}

/** The seam grip's pan: drag across between the closed, default and wide stops, along the line to move the grip. */
export function useColumnResize({ columnW, canvasW, minWidth, defaultWidth, onSettle, onRest, onResizeStart, onDetent }: ColumnResizeOptions) {
  const start = useSharedValue(0);
  // The stop the drag is nearest, so the tick fires once per stop passed.
  const passing = useSharedValue<ColumnStop | null>(null);
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
      const widths = stops();
      const width = columnDragWidth(start.get(), translationX, widths);
      columnW.set(width);
      const near = columnStopAt(width, widths);
      if (near !== passing.get()) {
        passing.set(near);
        runOnJS(onDetent)();
      }
    };
    // VoiceOver's adjustable swipe: one stop wider or narrower, with the same spring and callbacks as a drag.
    const step = (direction: 1 | -1) => {
      "worklet";
      const widths = stops();
      const stop = columnStopStep(columnStopAt(columnW.get(), widths), direction);
      const width = widths[stop];
      columnW.set(
        withSpring(width, STOP_SPRING, (finished) => {
          "worklet";
          if (finished) runOnJS(onRest)(width);
        }),
      );
      runOnJS(onSettle)(stop, width);
    };
    // One axis per drag, picked by the first movement, so sliding the grip never nudges the width.
    const seam = Gesture.Pan()
      .onBegin(() => {
        "worklet";
        start.set(columnW.get());
        passing.set(columnStopAt(columnW.get(), stops()));
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
        const stop = settleColumnStop(columnW.get(), event.velocityX, start.get(), widths);
        const width = widths[stop];
        // The spring takes over at the finger's own speed, so the column carries on rather than starting from rest.
        columnW.set(
          withSpring(width, { ...STOP_SPRING, velocity: event.velocityX }, (finished) => {
            "worklet";
            if (finished) runOnJS(onRest)(width);
          }),
        );
        runOnJS(onSettle)(stop, width);
      });
    const stepOnUI = (direction: 1 | -1) => runOnUI(step)(direction);
    return { seam, gripY, bandH, step: stepOnUI };
  }, [columnW, canvasW, minWidth, defaultWidth, start, passing, onSettle, onRest, onResizeStart, onDetent, gripY, gripStartY, bandH, axis]);
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
  /** The stop the column rests on, read to VoiceOver as the grip's value. */
  stop: ColumnStop;
  /** VoiceOver's swipe up (+1) or down (-1) on the grip. */
  onStep: (direction: 1 | -1) => void;
}

const STOP_LABEL: Record<ColumnStop, Parameters<typeof t>[0]> = { closed: "liveTv.columnClosed", default: "liveTv.columnDefault", wide: "liveTv.columnWide" };
const STEP_ACTIONS = [{ name: "increment" }, { name: "decrement" }];

/** A grip on the column/grid seam: drag across to resize, along the line to move it. Phone only. */
export function GuideColumnDivider({ columnW, topInset, bottomInset, gesture, gripY, bandH, stop, onStep }: GuideColumnDividerProps) {
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
            <Animated.View
              style={[styles.hit, gripStyle]}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={t("liveTv.columnWidth")}
              accessibilityValue={{ text: t(STOP_LABEL[stop]) }}
              accessibilityActions={STEP_ACTIONS}
              onAccessibilityAction={(event) => onStep(event.nativeEvent.actionName === "increment" ? 1 : -1)}>
              <GuideGrip size={GRIP_SIZE} arrowSize={19} />
            </Animated.View>
          </GestureDetector>
        </View>
      </Animated.View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  // Over the pinned band too, which lifts above the lists.
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
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
