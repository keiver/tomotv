import { useCardPalette } from "@/hooks/useCardPalette";
import { swingStops } from "@/utils/swingStops";
import React, { useEffect, useMemo } from "react";
import { Animated, Easing, useAnimatedValue, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

const BAR = 2;
const GAP = 2;
export const LEVEL_BARS_WIDTH = BAR * 3 + GAP * 2;
/** Each bar's own period, so the three never line up. */
const PERIODS = [620, 780, 540];
/** Fraction of the height each bar reaches. */
const PEAKS = [0.85, 1, 0.7];
const LOW = 0.25;
/** Paused: one common stub height, so a paused mark looks settled rather than stuck. */
const PAUSED = 0.3;
/** Reduced motion while playing: still, but staggered, so it still reads as music. */
const STILL = [0.5, 0.9, 0.65];
const SETTLE_MS = 220;

interface BarProps {
  index: number;
  /** Half the mark's height: the room one arm of the pair has to grow into. */
  half: number;
  playing: boolean;
  color: string;
}

/** A mirrored pair standing on the centre line, both arms carrying the same level. */
function Bar({ index, half, playing, color }: BarProps) {
  const reducedMotion = useReducedMotion();
  const swinging = playing && !reducedMotion;
  // phase loops 0 to 1 on the native driver; mix blends the swing (1) with the resting level (0).
  const phase = useAnimatedValue(0);
  const mix = useAnimatedValue(0);
  const rest = useAnimatedValue(PAUSED);
  const level = useMemo(() => Animated.add(Animated.multiply(phase.interpolate(swingStops(LOW, PEAKS[index])), mix), Animated.multiply(rest, Animated.subtract(1, mix))), [phase, mix, rest, index]);

  useEffect(() => {
    const settle = { duration: SETTLE_MS, useNativeDriver: true };
    if (!swinging) {
      const toRest = Animated.parallel([Animated.timing(mix, { ...settle, toValue: 0 }), Animated.timing(rest, { ...settle, toValue: playing ? STILL[index] : PAUSED })]);
      toRest.start();
      return () => toRest.stop();
    }
    const loop = Animated.loop(Animated.timing(phase, { toValue: 1, duration: PERIODS[index], easing: Easing.linear, useNativeDriver: true }));
    const toSwing = Animated.timing(mix, { ...settle, toValue: 1 });
    phase.setValue(0);
    loop.start();
    toSwing.start();
    return () => {
      toSwing.stop();
      loop.stop();
    };
  }, [swinging, playing, index, phase, mix, rest]);

  const scale = { transform: [{ scaleY: level }] };
  return (
    <View style={{ width: BAR }}>
      {/* Rounded at the outer end only, so a pair at full reach reads as one capsule rather
          than two bars pinched together where they meet. */}
      <Animated.View style={[{ width: BAR, height: half, borderTopLeftRadius: BAR / 2, borderTopRightRadius: BAR / 2, backgroundColor: color, transformOrigin: "bottom" }, scale]} />
      <Animated.View style={[{ width: BAR, height: half, borderBottomLeftRadius: BAR / 2, borderBottomRightRadius: BAR / 2, backgroundColor: color, transformOrigin: "top" }, scale]} />
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
export function LevelBars({ size, playing, color: colorProp }: LevelBarsProps) {
  const { accent } = useCardPalette();
  const color = colorProp ?? accent;
  const half = size / 2;

  return (
    <View style={{ width: LEVEL_BARS_WIDTH, height: size, flexDirection: "row", justifyContent: "space-between" }}>
      <Bar index={0} half={half} playing={playing} color={color} />
      <Bar index={1} half={half} playing={playing} color={color} />
      <Bar index={2} half={half} playing={playing} color={color} />
    </View>
  );
}
