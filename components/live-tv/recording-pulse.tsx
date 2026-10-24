import { swingStops } from "@/utils/swingStops";
import React, { useEffect, useMemo, type ReactNode } from "react";
import { Animated, Easing, useAnimatedValue } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/** One breath: the glyph dims over a second and comes back over the next. */
const CYCLE_MS = 2_000;
const DIM_OPACITY = 0.35;

/** Breathes its child slowly while `active`, the recording mark's second signal beside its red; still under reduced motion. */
export function RecordingPulse({ active, children }: { active: boolean; children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const pulsing = active && !reducedMotion;
  // phase loops 0 to 1 on the native driver; mix fades the breath in and out of full opacity.
  const phase = useAnimatedValue(0);
  const mix = useAnimatedValue(0);
  const opacity = useMemo(() => Animated.subtract(1, Animated.multiply(phase.interpolate(swingStops(0, 1 - DIM_OPACITY)), mix)), [phase, mix]);

  useEffect(() => {
    if (!pulsing) {
      const settle = Animated.timing(mix, { toValue: 0, duration: 200, useNativeDriver: true });
      settle.start();
      return () => settle.stop();
    }
    phase.setValue(0);
    mix.setValue(1);
    const loop = Animated.loop(Animated.timing(phase, { toValue: 1, duration: CYCLE_MS, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulsing, phase, mix]);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}
