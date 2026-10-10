import { SLIM_BADGE_HEIGHT } from "@/components/card-badge";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { liveFrameDueAt, liveFrameReel, subscribeLiveFrame } from "@/services/liveFrames";
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type LayoutChangeEvent, Platform, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const IS_TV = Platform.isTV;
/** The picture is called LIVE this long after it last moved; past it the badge stops claiming. */
export const LIVE_FRESH_MS = 15_000;
const HEIGHT = SLIM_BADGE_HEIGHT;
const PIE_SIZE = IS_TV ? 14 : 10;
/** The wedge over the red circle; translucent, so completion reads as a lighter disc, not a new badge. */
const PIE_FILL = "rgba(255, 255, 255, 0.55)";

export interface FreshnessTimings {
  /** How much longer the LIVE pill may hold before the circle takes over. */
  liveRemainMs: number;
  /** Until the next grab is due; 0 for an overdue picture. */
  dueRemainMs: number;
  /** The pie's starting fill: how much of the capture-to-due span has passed. */
  startFraction: number;
}

/** The badge's timeline against the burst: capture at `at`, next grab at `dueAt`, picture last moved at `lastChangeMs`. */
export function freshnessTimings(nowMs: number, lastChangeMs: number, at: number, dueAt: number): FreshnessTimings {
  const span = Math.max(1, dueAt - at);
  return {
    liveRemainMs: Math.max(0, LIVE_FRESH_MS - (nowMs - lastChangeMs)),
    dueRemainMs: Math.max(0, dueAt - nowMs),
    startFraction: Math.min(1, Math.max(0, (nowMs - at) / span)),
  };
}

/**
 * A channel card's honest live mark, one red badge with two states. LIVE while the picture is
 * seconds old; then the text fades and the pill contracts to a circle whose pie drains toward the
 * next grab. The fresh burst, not the pie emptying, brings LIVE back: overdue it sits as a bare
 * red circle, never a full disc (a solid red dot is the REC glyph, and REC is a real state here).
 * One native animation per burst, no JS ticks.
 */
export function LiveFreshnessBadge({ channelId }: { channelId: string }) {
  const subscribe = useCallback((listener: () => void) => subscribeLiveFrame(channelId, listener), [channelId]);
  const reel = useSyncExternalStore(
    subscribe,
    useCallback(() => liveFrameReel(channelId), [channelId]),
  );
  const dueAt = useSyncExternalStore(
    subscribe,
    useCallback(() => liveFrameDueAt(channelId), [channelId]),
  );

  // The pill's natural width, measured once so the contraction has a number to leave from.
  const [pillWidth, setPillWidth] = useState(0);
  const measure = useCallback((e: LayoutChangeEvent) => {
    // Read before deferring: the event object is recycled once the handler returns.
    const { width } = e.nativeEvent.layout;
    setPillWidth((w) => w || width);
  }, []);

  /** 0 = LIVE pill, 1 = red circle with the pie. */
  const morph = useSharedValue(0);
  const elapsed = useSharedValue(0);
  /** Overdue: the drained circle's centre dot, breathing until the grab lands. */
  const dot = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  // The LIVE window follows the picture, not the grab: a frame appended mid-burst is a newer picture.
  const seen = useRef<{ reel: unknown; changedAt: number }>({ reel: undefined, changedAt: 0 });
  useEffect(() => {
    if (!reel) return;
    if (seen.current.reel !== reel) seen.current = { reel, changedAt: seen.current.reel ? Date.now() : reel.at };
    // An unchanged verify re-dates the burst in place: reel.at moves while the object stays, and it counts as fresh.
    const timings = freshnessTimings(Date.now(), Math.max(seen.current.changedAt, reel.at), reel.at, dueAt ?? reel.at);
    morph.value = timings.liveRemainMs > 0 ? withSequence(withTiming(0, { duration: 350 }), withDelay(timings.liveRemainMs, withTiming(1, { duration: 450 }))) : withTiming(1, { duration: 350 });
    elapsed.value = timings.startFraction;
    elapsed.value = withTiming(1, { duration: timings.dueRemainMs, easing: Easing.linear });
    dot.value = 0;
    dot.value = reducedMotion
      ? withDelay(timings.dueRemainMs, withTiming(0.55, { duration: 400 }))
      : withDelay(timings.dueRemainMs, withRepeat(withSequence(withTiming(0.9, { duration: 1_000 }), withTiming(0.15, { duration: 1_000 })), -1));
    return () => {
      cancelAnimation(morph);
      cancelAnimation(elapsed);
      cancelAnimation(dot);
    };
  }, [reel, dueAt, morph, elapsed, dot, reducedMotion]);

  const shape = useAnimatedStyle(() => (pillWidth ? { width: interpolate(morph.value, [0, 1], [pillWidth, HEIGHT]) } : {}));
  const textStyle = useAnimatedStyle(() => ({ opacity: interpolate(morph.value, [0, 0.4], [1, 0], "clamp") }));
  const pieStyle = useAnimatedStyle(() => ({ opacity: interpolate(morph.value, [0.5, 1], [0, 1], "clamp") }));
  const dotStyle = useAnimatedStyle(() => ({ opacity: dot.value }));

  if (!reel) return null;
  return (
    <Animated.View style={[styles.badge, shape]} onLayout={measure} pointerEvents="none">
      <Animated.Text style={[styles.text, textStyle]} numberOfLines={1}>
        {t("liveTv.live")}
      </Animated.Text>
      <Animated.View style={[styles.pieWrap, pieStyle]}>
        <FreshnessPie elapsed={elapsed} />
        <Animated.View style={[styles.dot, dotStyle]} />
      </Animated.View>
    </Animated.View>
  );
}

/** A draining wedge, its tail retreating to 12 as the due nears: two clipped half-discs, no SVG. */
function FreshnessPie({ elapsed }: { elapsed: SharedValue<number> }) {
  const rotRight = useAnimatedStyle(() => ({ transform: [{ rotate: `${Math.min(1 - elapsed.value, 0.5) * 360}deg` }] }));
  const rotLeft = useAnimatedStyle(() => ({ transform: [{ rotate: `${Math.max(1 - elapsed.value - 0.5, 0) * 360}deg` }] }));
  return (
    <View style={styles.pie}>
      <View style={styles.windowRight}>
        <Animated.View style={[styles.spinnerRight, rotRight]}>
          <View style={styles.halfLeft} />
        </Animated.View>
      </View>
      <View style={styles.windowLeft}>
        <Animated.View style={[styles.spinnerLeft, rotLeft]}>
          <View style={styles.halfRight} />
        </Animated.View>
      </View>
    </View>
  );
}

const HALF = PIE_SIZE / 2;
const styles = StyleSheet.create({
  // The LIVE pill's own look (see card-badge's live tone); overflow clips the text as it contracts.
  badge: {
    minWidth: HEIGHT,
    height: HEIGHT,
    borderRadius: 500,
    borderWidth: 1,
    backgroundColor: COLORS.DESTRUCTIVE_DEEP,
    borderColor: COLORS.DESTRUCTIVE_DEEP,
    paddingHorizontal: IS_TV ? 7 : 4,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  text: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 16 : 9,
    fontWeight: "700",
  },
  pieWrap: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  pie: {
    width: PIE_SIZE,
    height: PIE_SIZE,
    borderRadius: HALF,
  },
  // The pie's own circle, reborn as the waiting mark once the wedge has drained.
  dot: {
    position: "absolute",
    width: PIE_SIZE,
    height: PIE_SIZE,
    borderRadius: HALF,
    backgroundColor: PIE_FILL,
  },
  windowRight: {
    position: "absolute",
    left: HALF,
    width: HALF,
    height: PIE_SIZE,
    overflow: "hidden",
  },
  windowLeft: {
    position: "absolute",
    left: 0,
    width: HALF,
    height: PIE_SIZE,
    overflow: "hidden",
  },
  // Each spinner is a full-size transparent disc, so its rotation pivots on the pie's centre.
  spinnerRight: {
    position: "absolute",
    left: -HALF,
    width: PIE_SIZE,
    height: PIE_SIZE,
  },
  spinnerLeft: {
    position: "absolute",
    left: 0,
    width: PIE_SIZE,
    height: PIE_SIZE,
  },
  halfLeft: {
    width: HALF,
    height: PIE_SIZE,
    borderTopLeftRadius: HALF,
    borderBottomLeftRadius: HALF,
    backgroundColor: PIE_FILL,
  },
  halfRight: {
    position: "absolute",
    left: HALF,
    width: HALF,
    height: PIE_SIZE,
    borderTopRightRadius: HALF,
    borderBottomRightRadius: HALF,
    backgroundColor: PIE_FILL,
  },
});
