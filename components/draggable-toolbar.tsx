import { GlassSurface } from "@/components/glass-surface";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/**
 * Points of the bar left on screen once it is tucked against an edge.
 *
 * This is the touch target as well as the sliver, and the two cannot differ: the band clips,
 * so anything past the edge is not drawn AND not touchable, and a hitSlop cannot help because
 * the container is `box-none` and never receives the touch to forward. Well under Apple's 44pt
 * minimum, which the filled notch offsets by being unmissable rather than merely present.
 */
const VISIBLE_PORTION = 25;
/** Gap between the bar and the band edges while it is expanded. */
const SIDE_MARGIN = 16;
/** A pill, not a shelf. Without a cap it stretched to the window and looked worst on iPad. */
const MAX_WIDTH = 240;
/** Travel before the pan takes the touch away from the buttons inside. */
const ACTIVATION = 12;
const SETTLE = { duration: 260 } as const;
const RIM = "rgba(73, 64, 46, 0.5)";
/**
 * The material's own colour, in every state. Low alpha on purpose: this is UIGlassEffect's
 * tint, so the pill still refracts what is behind it, and the tucked notch is the same glass
 * rather than a coloured view laid over it.
 */
const GLASS_TINT = "rgba(255, 195, 18, 0.0)";

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
 *
 * 1 is the bottom of the range, which is where it first appears: as low as it can sit while
 * still clearing whatever the caller's `bounds.bottom` reserves for the tab bar.
 */
const parked: { yFraction: number; collapsed: boolean; side: 1 | -1 } = { yFraction: 1, collapsed: false, side: -1 };

interface DraggableToolbarProps {
  children: React.ReactNode;
  height: number;
  /**
   * Points kept clear on each edge: safe-area insets plus whatever chrome the caller wants
   * cleared. The bar cannot be dragged into the vertical ones, and the horizontal ones clip it.
   */
  bounds: { top: number; bottom: number; left: number; right: number };
  /** The one mark shown in the notch once tucked away; `children` are not rendered then. */
  collapsedIcon?: React.ReactNode;
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
export function DraggableToolbar({ children, height, bounds, collapsedIcon, idleCollapseMs = 0 }: DraggableToolbarProps) {
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
          {/* The rim only while tucked: a bare notch needs an edge to read as an object, and
              the open pill has its own content to give it shape. */}
          <GlassSurface style={[styles.surface, { height, borderRadius: height / 2, borderWidth: collapsed ? 1 : 0 }]} intensity={75} tintColor={GLASS_TINT}>
            {collapsed ? (
              // Nothing of the bar's own UI survives the tuck: a clipped slice of it put
              // whichever control happened to land there under the notch, which read as
              // debris and fired on presses meant to bring the bar back. One mark instead,
              // sitting in the visible width at whichever end is still on screen.
              <View style={[styles.notch, { width: VISIBLE_PORTION }, side < 0 ? styles.notchRight : styles.notchLeft]}>{collapsedIcon}</View>
            ) : (
              <View style={styles.content}>{children}</View>
            )}
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
    borderColor: RIM,
  },
  // The visible width once tucked, pinned to whichever end is still on screen. It carries the
  // icon and nothing else: the colour is the material's, so the notch is the same glass as the
  // open pill rather than a filled view sitting on it.
  notch: {
    position: "absolute",
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  notchLeft: {
    left: 0,
  },
  notchRight: {
    right: 0,
  },
  // Horizontal padding replaces the grips that used to hold the children off the pill's ends.
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
});

export default DraggableToolbar;
