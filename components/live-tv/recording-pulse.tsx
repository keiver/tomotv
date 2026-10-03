import React, { useEffect, type ReactNode } from "react";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

/** Half a cycle: the glyph dims over a second and comes back over the next. */
const HALF_CYCLE_MS = 1_000;
const DIM_OPACITY = 0.35;

/** Breathes its child slowly while `active`, the recording mark's second signal beside its red; still under reduced motion. */
export function RecordingPulse({ active, children }: { active: boolean; children: ReactNode }) {
  const opacity = useSharedValue(1);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!active || reducedMotion) {
      cancelAnimation(opacity);
      opacity.value = withTiming(1, { duration: 200 });
      return;
    }
    opacity.value = withRepeat(withTiming(DIM_OPACITY, { duration: HALF_CYCLE_MS, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(opacity);
  }, [active, reducedMotion, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
