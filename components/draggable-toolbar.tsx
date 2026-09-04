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
/** Closest the open bar rests to a band edge. */
const SIDE_MARGIN = 16;
/**
 * A pill, not a shelf. Without a cap it stretched to the window and looked worst on iPad.
 * The floor is what the content needs: 24 of padding, three 44pt targets, 40 of artwork and
 * a title column wide enough to read. It still fits a 320pt window inside SIDE_MARGIN.
 */
const MAX_WIDTH = 288;
/** Fraction of the bar's width that must hang off the screen at release before it tucks. */
const TUCK_FRACTION = 0.25;
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

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

/** Horizontal geometry of one band, symmetric about the centre; every value is a distance from x = 0. */
export interface Travel {
  /** Furthest the open bar rests from centre, still SIDE_MARGIN inside the band. */
  rest: number;
  /** Where the bar starts leaving the screen. */
  edge: number;
  /** Overhang past `edge` that commits a tuck. */
  commit: number;
  /** The tucked position, VISIBLE_PORTION left inside the band. */
  tuck: number;
}

/**
 * Where a released drag leaves the bar: tucked once more than `commit` of it hangs off the
 * screen, otherwise the nearest resting spot, so a bar let go short of the edge stays put.
 */
export function settleX(x: number, { rest, edge, commit, tuck }: Travel): number {
  "worklet";
  if (Math.abs(x) - edge > commit) return x < 0 ? -tuck : tuck;
  // A zero rest clamps to -0; normalised so the parked fraction stays a clean 0.
  const resting = clamp(x, -rest, rest);
  return resting === 0 ? 0 : resting;
}

/**
 * Where the bar was left, as fractions of the travel so a rotation while it is unmounted
 * re-resolves against the new window. Module scope: it remounts with every native player
 * presentation. yFraction 1 is the bottom, where the bar first appears.
 */
const parked: { yFraction: number; xFraction: number; collapsed: boolean; side: 1 | -1 } = { yFraction: 1, xFraction: 0, collapsed: false, side: -1 };

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
}

/**
 * Floating pill the user can move anywhere and tuck against either side.
 *
 * Renders nothing on tvOS: react-native-tvos forces `isUserInteractionEnabled` YES on plain
 * views, so an absolutely positioned view above focusables occludes the focus engine and
 * `pointerEvents` cannot opt out.
 */
export function DraggableToolbar({ children, height, bounds, collapsedIcon }: DraggableToolbarProps) {
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

  const travel = useMemo<Travel>(
    () => ({ rest: Math.max(0, barLeft - SIDE_MARGIN), edge: barLeft, commit: barWidth * TUCK_FRACTION, tuck: Math.max(0, band - VISIBLE_PORTION - barLeft) }),
    [band, barLeft, barWidth],
  );
  const restingX = () => (parked.collapsed ? parked.side * travel.tuck : clamp(parked.xFraction, -1, 1) * travel.rest);

  const translateY = useSharedValue(yAt(parked.yFraction));
  const translateX = useSharedValue(restingX());
  const startY = useSharedValue(0);
  const startX = useSharedValue(0);

  const [collapsed, setCollapsed] = useState(parked.collapsed);
  // Which end the notch shows at, and the edge the bar reopens beside.
  const [side, setSide] = useState<1 | -1>(parked.side);

  // Any window change (rotation, keyboard, Split View) re-resolves the remembered fractions
  // against the new range. No guard and no stored pixels, so there is nothing to go stale.
  useEffect(() => {
    translateY.set(withTiming(yAt(parked.yFraction), SETTLE));
    translateX.set(withTiming(restingX(), SETTLE));
    // yAt and restingX close over exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minY, travelY, travel, translateX, translateY]);

  const settle = useCallback(
    (target: number, yFraction: number) => {
      parked.yFraction = yFraction;
      parked.collapsed = Math.abs(target) > travel.rest;
      if (parked.collapsed) {
        parked.side = target < 0 ? -1 : 1;
        setSide(parked.side);
      } else {
        parked.xFraction = travel.rest === 0 ? 0 : target / travel.rest;
      }
      setCollapsed(parked.collapsed);
    },
    [travel],
  );

  // A tap on the notch brings the bar out beside the edge it was tucked into.
  const expand = useCallback(() => {
    translateX.set(withTiming(side * travel.rest, SETTLE));
    parked.collapsed = false;
    parked.xFraction = side;
    setCollapsed(false);
  }, [side, travel, translateX]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-ACTIVATION, ACTIVATION])
        .activeOffsetY([-ACTIVATION, ACTIVATION])
        .onBegin(() => {
          "worklet";
          startY.set(translateY.get());
          startX.set(translateX.get());
        })
        // Both axes, every frame: a pill you can put anywhere must not run on rails.
        .onUpdate((event) => {
          "worklet";
          translateX.set(clamp(startX.get() + event.translationX, -travel.tuck, travel.tuck));
          translateY.set(clamp(startY.get() + event.translationY, minY, maxY));
        })
        // Vertical stays where it was released; only the horizontal settles.
        .onEnd(() => {
          "worklet";
          const target = settleX(translateX.get(), travel);
          translateX.set(withTiming(target, SETTLE));
          runOnJS(settle)(target, (translateY.get() - minY) / travelY);
        }),
    [travel, maxY, minY, travelY, settle, startX, startY, translateX, translateY],
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

  // Shape reads off how far the bar hangs off the screen, never off the collapsed flag: a bar
  // resting anywhere on screen is the whole pill, and it morphs into the notch as it leaves.
  const surfaceStyle = useAnimatedStyle(() => {
    const overhang = Math.abs(translateX.get()) - travel.edge;
    const span = travel.tuck - travel.edge;
    const t = span <= 0 ? 0 : clamp(overhang / span, 0, 1);
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
              <View style={[styles.notch, { width: VISIBLE_PORTION }, side < 0 ? styles.notchRight : styles.notchLeft]}>{collapsedIcon}</View>
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
  // Horizontal padding holds the children off the pill's ends.
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
});

export default DraggableToolbar;
