import { GlassSurface } from "@/components/glass-surface";
import { COLORS } from "@/constants/colors";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/** Points of the bar left on screen once it is tucked against an edge. */
const VISIBLE_PORTION = 34;
/** Gap between the bar and the screen edges while it is expanded. */
const SIDE_MARGIN = 16;
/** Travel before the pan takes the touch away from the buttons inside. */
const ACTIVATION = 12;
const SETTLE = { duration: 260 } as const;

/**
 * Where a finished horizontal drag leaves the bar: 0 expanded, ±`collapseOffset` tucked.
 *
 * Exported and pure so the rule can be tested off the UI thread. Asymmetric on purpose —
 * a quarter of the travel tucks it away, half of it is needed to pull it back, so the bar
 * gets out of the way easily and returns deliberately.
 */
export function settleX(startX: number, translationX: number, collapseOffset: number): number {
  "worklet";
  if (startX === 0) {
    if (translationX > collapseOffset * 0.25) return collapseOffset;
    if (translationX < -collapseOffset * 0.25) return -collapseOffset;
    return 0;
  }
  const towardCentre = startX > 0 ? -translationX : translationX;
  return towardCentre > collapseOffset * 0.5 ? 0 : startX;
}

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

/**
 * Where the bar was left. Module scope because it unmounts and remounts constantly (whenever
 * the native player is presented and dismissed), and coming back to the default spot each time
 * undoes the user's placement.
 */
const parked: { y: number | null; collapsed: boolean; side: 1 | -1 } = { y: null, collapsed: false, side: 1 };

interface DraggableToolbarProps {
  children: React.ReactNode;
  height: number;
  /** Points kept clear at the top and bottom; the bar cannot be dragged into them. */
  bounds: { top: number; bottom: number };
  /** Idle time before the bar tucks itself against the last edge it was sent to. 0 disables. */
  idleCollapseMs?: number;
}

/**
 * Floating bar the user can slide up and down and tuck against either side.
 *
 * Renders nothing on tvOS: react-native-tvos forces `isUserInteractionEnabled` YES on plain
 * views, so an absolutely positioned view above focusables occludes the focus engine and
 * `pointerEvents` cannot opt out.
 */
export function DraggableToolbar({ children, height, bounds, idleCollapseMs = 0 }: DraggableToolbarProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const minY = bounds.top;
  const maxY = Math.max(minY, screenHeight - bounds.bottom - height);
  const collapseOffset = screenWidth - SIDE_MARGIN - VISIBLE_PORTION;

  const translateY = useSharedValue(parked.y ?? maxY);
  const translateX = useSharedValue(parked.collapsed ? parked.side * collapseOffset : 0);
  const startY = useSharedValue(0);
  const startX = useSharedValue(0);
  // 0 undecided, 1 horizontal, 2 vertical. Locked on the first movement past ACTIVATION.
  const axis = useSharedValue(0);

  const [collapsed, setCollapsed] = useState(parked.collapsed);
  // Which side the bar was last sent to, so the idle timer tucks it back the same way.
  const [side, setSide] = useState<1 | -1>(parked.side);

  // Rotation, or a keyboard changing the window: pull the bar back inside the new bounds.
  useEffect(() => {
    if (translateY.get() > maxY) translateY.set(withTiming(maxY, SETTLE));
    if (translateY.get() < minY) translateY.set(withTiming(minY, SETTLE));
  }, [maxY, minY, translateY]);

  const settle = useCallback((target: number, y: number) => {
    parked.y = y;
    parked.side = target < 0 ? -1 : 1;
    parked.collapsed = target !== 0;
    setSide(parked.side);
    setCollapsed(parked.collapsed);
  }, []);

  const expand = useCallback(() => {
    translateX.set(withTiming(0, SETTLE));
    parked.collapsed = false;
    setCollapsed(false);
  }, [translateX]);

  // Tucks itself away after a quiet spell; any touch on the bar restarts the countdown.
  const [interactionAt, setInteractionAt] = useState(0);
  useEffect(() => {
    if (!idleCollapseMs || collapsed) return;
    const timer = setTimeout(() => {
      translateX.set(withTiming(side * collapseOffset, SETTLE));
      parked.collapsed = true;
      setCollapsed(true);
    }, idleCollapseMs);
    return () => clearTimeout(timer);
  }, [idleCollapseMs, collapsed, interactionAt, collapseOffset, side, translateX]);

  const noteInteraction = useCallback(() => setInteractionAt(Date.now()), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-ACTIVATION, ACTIVATION])
        .activeOffsetY([-ACTIVATION, ACTIVATION])
        .onBegin(() => {
          "worklet";
          startY.set(translateY.get());
          startX.set(translateX.get());
          axis.set(0);
          runOnJS(noteInteraction)();
        })
        .onUpdate((event) => {
          "worklet";
          if (axis.get() === 0) {
            if (Math.abs(event.translationX) < ACTIVATION && Math.abs(event.translationY) < ACTIVATION) return;
            axis.set(Math.abs(event.translationX) > Math.abs(event.translationY) ? 1 : 2);
          }
          if (axis.get() === 1) {
            translateX.set(clamp(startX.get() + event.translationX, -collapseOffset, collapseOffset));
          } else {
            translateY.set(clamp(startY.get() + event.translationY, minY, maxY));
          }
        })
        .onEnd((event) => {
          "worklet";
          // A vertical drag settles where it was released; only the horizontal one snaps.
          const target = axis.get() === 1 ? settleX(startX.get(), event.translationX, collapseOffset) : translateX.get();
          if (axis.get() === 1) translateX.set(withTiming(target, SETTLE));
          runOnJS(settle)(target, translateY.get());
        })
        .onFinalize(() => {
          "worklet";
          runOnJS(noteInteraction)();
        }),
    [axis, collapseOffset, maxY, minY, noteInteraction, settle, startX, startY, translateX, translateY],
  );

  // Only while tucked away: an enabled tap gesture over the bar swallows presses meant for
  // the controls inside it.
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .enabled(collapsed)
        .onEnd(() => {
          "worklet";
          runOnJS(expand)();
        }),
    [collapsed, expand],
  );

  const gesture = useMemo(() => Gesture.Race(pan, tap), [pan, tap]);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }, { translateX: translateX.get() }],
  }));

  if (Platform.isTV) return null;

  return (
    <GestureHandlerRootView style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.bar, { height }, barStyle]} pointerEvents="box-none">
        <GestureDetector gesture={gesture}>
          <GlassSurface style={[styles.surface, { height }]} intensity={80}>
            {/* One grip per edge: whichever side the bar is tucked against, the sliver still
                on screen carries a grab target. */}
            <View style={styles.grip} />
            <View style={styles.content}>{children}</View>
            <View style={styles.grip} />
          </GlassSurface>
        </GestureDetector>
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
  bar: {
    position: "absolute",
    left: SIDE_MARGIN,
    right: SIDE_MARGIN,
    top: 0,
    // The shadow needs a solid layer to cast from: a transparent container with a clipping
    // child casts nothing. This background also sits under the glass rather than through it.
    backgroundColor: COLORS.SURFACE_SUNKEN,
    borderRadius: 20,
    shadowColor: COLORS.SHADOW,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
  },
  surface: {
    flex: 1,
    borderRadius: 20,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
  },
  // The one affordance that says this thing moves; also the grab target when tucked away.
  grip: {
    width: 3,
    height: 22,
    marginHorizontal: 7,
    borderRadius: 2,
    backgroundColor: COLORS.ACCENT,
    opacity: 0.5,
  },
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
});

export default DraggableToolbar;
