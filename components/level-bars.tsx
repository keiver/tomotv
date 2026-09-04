import { COLORS } from "@/constants/colors";
import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

const BAR = 2;
const GAP = 2;
/** Each bar's own period, so the three never line up. */
const PERIODS = [620, 780, 540];
/** Fraction of the height each bar reaches. */
const PEAKS = [0.85, 1, 0.7];
const LOW = 0.25;
/** Paused: one common stub height, so a paused mark looks settled rather than stuck. */
const PAUSED = 0.3;
/** Reduced motion while playing: still, but staggered, so it still reads as music. */
const STILL = [0.5, 0.9, 0.65];

interface BarProps {
  index: number;
  /** Half the mark's height: the room one arm of the pair has to grow into. */
  half: number;
  playing: boolean;
  color: string;
}

/** A mirrored pair standing on the centre line, both arms carrying the same level. */
function Bar({ index, half, playing, color }: BarProps) {
  const level = useSharedValue(PAUSED);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    cancelAnimation(level);
    if (!playing) {
      level.set(withTiming(PAUSED, { duration: 220 }));
      return;
    }
    if (reducedMotion) {
      level.set(withTiming(STILL[index], { duration: 220 }));
      return;
    }
    const swing = { duration: PERIODS[index] / 2, easing: Easing.inOut(Easing.quad) };
    level.set(withRepeat(withSequence(withTiming(PEAKS[index], swing), withTiming(LOW, swing)), -1, false));
    return () => cancelAnimation(level);
  }, [playing, reducedMotion, index, level]);

  // One style per view: an animated style belongs to the view it is passed to.
  const up = useAnimatedStyle(() => ({ height: level.get() * half }));
  const down = useAnimatedStyle(() => ({ height: level.get() * half }));

  return (
    <View style={{ width: BAR }}>
      {/* Rounded at the outer end only, so a pair at full reach reads as one capsule rather
          than two bars pinched together where they meet. */}
      <View style={{ height: half, justifyContent: "flex-end" }}>
        <Animated.View style={[{ width: BAR, borderTopLeftRadius: BAR / 2, borderTopRightRadius: BAR / 2, backgroundColor: color }, up]} />
      </View>
      <View style={{ height: half }}>
        <Animated.View style={[{ width: BAR, borderBottomLeftRadius: BAR / 2, borderBottomRightRadius: BAR / 2, backgroundColor: color }, down]} />
      </View>
    </View>
  );
}

interface LevelBarsProps {
  size: number;
  /** Bars rise and fall while true, settle to a common stub while false. */
  playing: boolean;
  color?: string;
}

/** Three level bars mirrored about their centre, the mark for music that is playing. Plain views: the project carries no SVG. */
export function LevelBars({ size, playing, color = COLORS.ACCENT }: LevelBarsProps) {
  const half = size / 2;

  return (
    <View style={{ width: BAR * 3 + GAP * 2, height: size, flexDirection: "row", justifyContent: "space-between" }}>
      <Bar index={0} half={half} playing={playing} color={color} />
      <Bar index={1} half={half} playing={playing} color={color} />
      <Bar index={2} half={half} playing={playing} color={color} />
    </View>
  );
}
