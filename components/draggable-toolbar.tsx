import { GlassSurface } from "@/components/glass-surface";
import { COLORS } from "@/constants/colors";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/** Points of the bar left on screen once it is tucked against an edge: a notch, not a stub.
    Sized so the grip (4 wide, 8 either side) sits inside it with a little air. */
const VISIBLE_PORTION = 21;
/** Gap between the bar and the band edges while it is expanded. */
const SIDE_MARGIN = 16;
/** A pill, not a shelf. Without a cap it stretched to the window and looked worst on iPad. */
const MAX_WIDTH = 240;
/** Travel before the pan takes the touch away from the buttons inside. */
const ACTIVATION = 12;
const SETTLE = { duration: 260 } as const;
const RIM = "rgba(73, 64, 46, 0.5)";

/**
 * Where a finished horizontal drag leaves the bar: 0 expanded, `tuckLeft` (negative) or
 * `tuckRight` (positive) tucked.
 *
 * Exported and pure so the rule can be tested off the UI thread. Asymmetric on purpose: a
 * quarter of the travel tucks it away and half is needed to pull it back, so the bar gets out
 * of the way easily and returns deliberately. The two travels are passed separately because a
 * caller can inset one edge further than the other.
 */
export function settleX(startX: number, translationX: number, tuckLeft: number, tuckRight: number): number {
  "worklet";
  if (startX === 0) {
    if (translationX > tuckRight * 0.25) return tuckRight;
    if (translationX < tuckLeft * 0.25) return tuckLeft;
    return 0;
  }
  // How far this side's tuck actually is, so "halfway back" means the same on both.
  const travel = startX > 0 ? tuckRight : -tuckLeft;
  const towardCentre = startX > 0 ? -translationX : translationX;
  return towardCentre > travel * 0.5 ? 0 : startX;
}

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

/**
 * Where the bar was left.
 *
 * Module scope because it unmounts and remounts constantly (whenever the native player is
 * presented and dismissed), and returning to the default spot each time undoes the user's
 * placement. Vertical position is a FRACTION of the travel, never pixels: rotating while the
 * bar is unmounted used to leave a portrait offset to be restored into a landscape window,
 * which stranded it wherever that number happened to land.
 */
const parked: { yFraction: number; collapsed: boolean; side: 1 | -1 } = { yFraction: 0, collapsed: false, side: -1 };

interface DraggableToolbarProps {
  children: React.ReactNode;
  height: number;
  /**
   * Points kept clear on each edge: safe-area insets plus whatever chrome the caller wants
   * cleared. The bar cannot be dragged into the vertical ones, and the horizontal ones clip it.
   */
  bounds: { top: number; bottom: number; left: number; right: number };
  /** Idle time before the bar tucks itself against the last edge it was sent to. 0 disables. */
  idleCollapseMs?: number;
}

/**
 * Floating pill the user can move anywhere and tuck against either side.
 *
 * Renders nothing on tvOS: react-native-tvos forces `isUserInteractionEnabled` YES on plain
 * views, so an absolutely positioned view above focusables occludes the focus engine and
 * `pointerEvents` cannot opt out.
 */
export function DraggableToolbar({ children, height, bounds, idleCollapseMs = 0 }: DraggableToolbarProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const minY = bounds.top;
  const maxY = Math.max(minY, screenHeight - bounds.bottom - height);
  const travelY = Math.max(1, maxY - minY);
  const yAt = (fraction: number) => minY + clamp(fraction, 0, 1) * travelY;

  // Everything below is measured inside the safe band, and the band CLIPS. Positioning alone
  // cannot both keep the notch inside the inset and stop the rest of the bar showing: park its
  // edge at `screenWidth - inset - VISIBLE_PORTION` and the remaining inset's worth of bar
  // keeps drawing out to the physical edge, which in landscape is 59pt of stray panel.
  const band = Math.max(0, screenWidth - bounds.left - bounds.right);
  const barWidth = Math.max(0, Math.min(band - SIDE_MARGIN * 2, MAX_WIDTH));
  const barLeft = (band - barWidth) / 2;

  // Travel that leaves exactly VISIBLE_PORTION inside the band, symmetric by construction
  // because the insets are already out of this coordinate space.
  const tuckRight = Math.max(0, band - VISIBLE_PORTION - barLeft);
  const tuckLeft = Math.min(0, VISIBLE_PORTION - (barLeft + barWidth));
  const tuckX = (towards: 1 | -1) => (towards > 0 ? tuckRight : tuckLeft);

  const translateY = useSharedValue(yAt(parked.yFraction));
  const translateX = useSharedValue(parked.collapsed ? tuckX(parked.side) : 0);
  const startY = useSharedValue(0);
  const startX = useSharedValue(0);

  const [collapsed, setCollapsed] = useState(parked.collapsed);
  // Which side the bar was last sent to, so the idle timer tucks it back the same way.
  const [side, setSide] = useState<1 | -1>(parked.side);

  // Any window change (rotation, keyboard, Split View) re-resolves the remembered fraction
  // against the new range. No guard and no stored pixels, so there is nothing to go stale.
  useEffect(() => {
    translateY.set(withTiming(yAt(parked.yFraction), SETTLE));
    translateX.set(withTiming(parked.collapsed ? tuckX(parked.side) : 0, SETTLE));
    // yAt and tuckX close over exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minY, travelY, tuckLeft, tuckRight, translateX, translateY]);

  const settle = useCallback((target: number, yFraction: number) => {
    parked.yFraction = yFraction;
    parked.collapsed = target !== 0;
    // Only a real tuck changes the side the idle timer will use; ending expanded leaves it.
    if (target !== 0) {
      parked.side = target < 0 ? -1 : 1;
      setSide(parked.side);
    }
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
      translateX.set(withTiming(side > 0 ? tuckRight : tuckLeft, SETTLE));
      parked.collapsed = true;
      setCollapsed(true);
    }, idleCollapseMs);
    return () => clearTimeout(timer);
  }, [idleCollapseMs, collapsed, interactionAt, tuckLeft, tuckRight, side, translateX]);

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
          runOnJS(noteInteraction)();
        })
        // Both axes, every frame. This used to lock to whichever axis moved first and ignore
        // the other for the rest of the gesture, which made a pill you can put anywhere feel
        // like it ran on rails.
        .onUpdate((event) => {
          "worklet";
          translateX.set(clamp(startX.get() + event.translationX, tuckLeft, tuckRight));
          translateY.set(clamp(startY.get() + event.translationY, minY, maxY));
        })
        // Vertical stays where it was released; only the horizontal snaps.
        .onEnd((event) => {
          "worklet";
          const target = settleX(startX.get(), event.translationX, tuckLeft, tuckRight);
          translateX.set(withTiming(target, SETTLE));
          runOnJS(settle)(target, (translateY.get() - minY) / travelY);
        })
        .onFinalize(() => {
          "worklet";
          runOnJS(noteInteraction)();
        }),
    [tuckLeft, tuckRight, maxY, minY, travelY, noteInteraction, settle, startX, startY, translateX, translateY],
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
    <GestureHandlerRootView style={[styles.root, { left: bounds.left, right: bounds.right }]} pointerEvents="box-none">
      <Animated.View style={[styles.bar, { height, width: barWidth, left: barLeft, borderRadius: height / 2 }, barStyle]} pointerEvents="box-none">
        <GestureDetector gesture={gesture}>
          <GlassSurface style={[styles.surface, { height, borderRadius: height / 2 }]} intensity={75}>
            {/* One grip per edge: whichever side the bar is tucked against, the sliver still
                on screen carries a grab target. */}
            <View style={styles.grip} />
            {/* Inert while tucked away. Whatever control happens to sit under the notch would
                otherwise fire on a press meant to bring the bar back, and which control that
                is depends only on which edge it went to. Touches fall through to the tap
                gesture on the surface, which is what expands it. */}
            <View style={styles.content} pointerEvents={collapsed ? "none" : "auto"}>
              {children}
            </View>
            <View style={styles.grip} />
          </GlassSurface>
        </GestureDetector>
      </Animated.View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  // Inset to the safe area by the caller's bounds, and clipping: a tucked bar slides past this
  // edge and the overhang is cut, so the sliver on screen is the notch and nothing else.
  root: {
    position: "absolute",
    top: 0,
    bottom: 0,
    overflow: "hidden",
  },
  // No background and no shadow: either one puts an opaque layer under the glass, and the
  // material stops refracting the moment it has a solid backing. The rim is the edge.
  bar: {
    position: "absolute",
    top: 0,
  },
  surface: {
    flex: 1,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: RIM,
  },
  // The one affordance that says this thing moves; also the whole of the tucked-away notch,
  // which is why it is the brightest thing on the bar.
  grip: {
    width: 4,
    height: 22,
    marginHorizontal: 8,
    borderRadius: 2,
    backgroundColor: COLORS.ACCENT,
  },
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },
});

export default DraggableToolbar;
