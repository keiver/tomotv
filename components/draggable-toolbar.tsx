import { GlassSurface } from "@/components/glass-surface";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/** The material carries the morph itself, so its corners stay the native ones the glass draws. */
const AnimatedGlassSurface = Animated.createAnimatedComponent(GlassSurface);

/**
 * Points of the bar left on screen once it is tucked against an edge.
 *
 * This is the touch target as well as the sliver, and the two cannot differ: the band clips,
 * so anything past the edge is not drawn AND not touchable, and a hitSlop cannot help because
 * the container is `box-none` and never receives the touch to forward. Well under Apple's 44pt
 * minimum, which the filled notch offsets by being unmissable rather than merely present.
 */
const VISIBLE_PORTION = 21;
/**
 * Height of the tucked notch, taller than the open pill: 25 points of width needs the length
 * to read as a handle rather than a chip, and it carries the target Apple asks for on one axis.
 */
const NOTCH_HEIGHT = 82;
/** Rounding of the tucked notch. Half its height would round it back into the pill it is not. */
const NOTCH_RADIUS = 18;
/** Gap between the bar and the band edges while it is expanded. */
const SIDE_MARGIN = 16;
/**
 * A pill, not a shelf. Without a cap it stretched to the window and looked worst on iPad.
 * The floor is what the content needs: 24 of padding, three 44pt targets, 40 of artwork and
 * a title column wide enough to read. It still fits a 320pt window inside SIDE_MARGIN.
 */
const MAX_WIDTH = 288;
/** Travel before the pan takes the touch away from the buttons inside. */
const ACTIVATION = 12;
const SETTLE = { duration: 260 } as const;
const RIM = "rgba(73, 64, 46, 0.5)";
/**
 * The wash behind the tucked notch's icon, densest at the pill's edge and gone by the far end
 * of its box. A light white rather than the card badge's black: it lifts the notch out of the
 * glass instead of sinking it. Kept faint on purpose, past roughly 0.3 it stops reading as a
 * highlight on the material and starts washing the glass out into a flat panel.
 */
const WASH_STOPS = "rgba(158, 51, 51, 0.10) 0%, rgba(255, 255, 255, 0.14) 35%, rgba(255, 255, 255, 0.08) 65%, rgba(255, 255, 255, 0.03) 85%, rgba(255, 255, 255, 0) 100%";
/** Multiples of the sliver the wash runs for. The extra is what fades, inside the pill. */
const SCRIM_REACH = 3;
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
   * Points kept clear top and bottom: safe-area insets plus whatever chrome the caller wants
   * cleared. The bar cannot be dragged into them.
   *
   * Horizontal insets are deliberately not honoured. Respecting them left the tucked notch
   * floating an inset's width off the side of the phone in landscape, which looked worse than
   * the thing it was avoiding; it anchors to the device edge instead.
   */
  bounds: { top: number; bottom: number };
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

  // The box holds the taller of the two states and centres the surface in it, so neither the
  // open pill nor the tucked notch can be left overhanging the caller's bounds.
  const box = Math.max(height, NOTCH_HEIGHT);

  const minY = bounds.top;
  const maxY = Math.max(minY, screenHeight - bounds.bottom - box);
  const travelY = Math.max(1, maxY - minY);
  const yAt = (fraction: number) => minY + clamp(fraction, 0, 1) * travelY;

  // The full window width, and it CLIPS: the tucked bar slides past the edge and the overhang
  // is cut, so the sliver on screen is the notch and nothing else. Anchored to the device edge
  // rather than to the safe area, so the notch reaches the side of the phone in landscape
  // instead of hovering an inset's width in from it.
  const band = screenWidth;
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

  // Size, corners and rim read off the horizontal travel rather than the collapsed flag: one
  // number drives both, so the shape is always the one that position calls for.
  const surfaceStyle = useAnimatedStyle(() => {
    const x = translateX.get();
    const travel = x < 0 ? tuckLeft : tuckRight;
    const t = travel === 0 ? 0 : clamp(x / travel, 0, 1);
    return {
      height: interpolate(t, [0, 1], [height, NOTCH_HEIGHT]),
      borderRadius: interpolate(t, [0, 1], [height / 2, NOTCH_RADIUS]),
      // A bare notch needs an edge to read as an object; the open pill has its own content
      // to give it shape.
      borderWidth: t,
    };
  });

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }, { translateX: translateX.get() }],
  }));

  if (Platform.isTV) return null;

  return (
    <GestureHandlerRootView style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.bar, { height: box, width: barWidth, left: barLeft }, barStyle]} pointerEvents="box-none">
        <GestureDetector gesture={gesture}>
          <AnimatedGlassSurface style={[styles.surface, surfaceStyle]} intensity={75} tintColor={GLASS_TINT}>
            {collapsed ? (
              // Nothing of the bar's own UI survives the tuck: a clipped slice of it put
              // whichever control happened to land there under the notch, which read as
              // debris and fired on presses meant to bring the bar back. One mark instead,
              // sitting in the visible width at whichever end is still on screen.
              <>
                {/* Anchored to the sliver's outer edge and fading inward, so the fade itself
                    happens inside the pill and the visible notch is evenly dark. Inside the
                    GlassSurface, which clips it: the wash bleeds into the panel, never out of
                    it. Contrast floor for the icon, the same job CardCornerScrim does for the
                    card badge, since glass takes its brightness from whatever is behind it. */}
                <View style={[styles.notchScrim, { width: VISIBLE_PORTION * SCRIM_REACH }, side < 0 ? styles.scrimFromRight : styles.scrimFromLeft]} pointerEvents="none" />
                <View style={[styles.notch, { width: VISIBLE_PORTION }, side < 0 ? styles.notchRight : styles.notchLeft]}>{collapsedIcon}</View>
              </>
            ) : (
              <View style={styles.content}>{children}</View>
            )}
          </AnimatedGlassSurface>
        </GestureDetector>
      </Animated.View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  // Inset to the safe area by the caller's bounds, and clipping: a tucked bar slides past this
  // edge and the overhang is cut, so the sliver on screen is the notch and nothing else.
  // Full window width, and clipping: a tucked bar slides past the device edge and the overhang
  // is cut, so the sliver on screen is the notch and nothing else.
  root: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    overflow: "hidden",
  },
  // No background and no shadow: either one puts an opaque layer under the glass, and the
  // material stops refracting the moment it has a solid backing. The rim is the edge.
  bar: {
    position: "absolute",
    top: 0,
    justifyContent: "center",
  },
  surface: {
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
  notchScrim: {
    position: "absolute",
    top: 0,
    bottom: 0,
  },
  // "to left" puts the first stop at the right edge, which is the pill's outer edge when the
  // bar is tucked left, and the fade then runs inward. Mirrored for the other side.
  scrimFromRight: {
    right: 0,
    experimental_backgroundImage: `linear-gradient(to left, ${WASH_STOPS})`,
  },
  scrimFromLeft: {
    left: 0,
    experimental_backgroundImage: `linear-gradient(to right, ${WASH_STOPS})`,
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
