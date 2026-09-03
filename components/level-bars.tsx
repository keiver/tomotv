import { COLORS } from "@/constants/colors";
import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

const BAR = 3;
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
  size: number;
  playing: boolean;
  color: string;
}

function Bar({ index, size, playing, color }: BarProps) {
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
    const half = { duration: PERIODS[index] / 2, easing: Easing.inOut(Easing.quad) };
    level.set(withRepeat(withSequence(withTiming(PEAKS[index], half), withTiming(LOW, half)), -1, false));
    return () => cancelAnimation(level);
  }, [playing, reducedMotion, index, level]);

  const style = useAnimatedStyle(() => ({ height: level.get() * size }));

  return <Animated.View style={[{ width: BAR, borderRadius: BAR / 2, backgroundColor: color }, style]} />;
}

interface LevelBarsProps {
  size: number;
  /** Bars rise and fall while true, settle to a common stub while false. */
  playing: boolean;
  color?: string;
}

/** Three level bars, the mark for music that is playing. Plain views: the project carries no SVG. */
export function LevelBars({ size, playing, color = COLORS.ACCENT }: LevelBarsProps) {
  return (
    <View style={{ width: BAR * 3 + GAP * 2, height: size, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
      <Bar index={0} size={size} playing={playing} color={color} />
      <Bar index={1} size={size} playing={playing} color={color} />
      <Bar index={2} size={size} playing={playing} color={color} />
    </View>
  );
}
