import { GRID } from "@/constants/app";
import { useCardZoom, useCardZoomCeiling } from "@/hooks/useCardZoom";
import { setCardZoom } from "@/services/cardZoom";
import { pinchedCardZoom } from "@/utils/cardZoom";
import React, { useCallback, useEffect, useMemo } from "react";
import { Platform, StyleSheet } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

const SETTLE = { duration: 180, easing: Easing.out(Easing.cubic) };
/** How far the cards swell (or shrink) when a pinch or key runs into a limit. */
const PULSE = 0.03;
const PULSE_OUT_MS = 70;
const PULSE_BACK_MS = 160;

type LimitSide = 1 | -1;
const limitListeners = new Set<(side: LimitSide) => void>();

/** A key press that hit a limit: every mounted card surface pulses toward it. */
export function pulseCardZoomLimit(side: LimitSide): void {
  for (const listener of limitListeners) listener(side);
}

/** The swell toward a limit and back. */
function limitPulse(side: LimitSide) {
  "worklet";
  return withSequence(withTiming(1 + PULSE * side, { duration: PULSE_OUT_MS }), withTiming(1, { duration: PULSE_BACK_MS }));
}

interface CardZoomPinchProps {
  children: React.ReactNode;
}

/** A pinch over the cards it wraps sets the card zoom every card surface draws at. TV has no pinch and gets the children alone. */
export function CardZoomPinch({ children }: CardZoomPinchProps) {
  if (Platform.isTV) return <>{children}</>;
  return <CardZoomPinchDetector>{children}</CardZoomPinchDetector>;
}

/**
 * The cards are laid out at the committed zoom and scaled on the UI thread by shown / committed, so a moving
 * finger never re-renders them; at rest the scale is exactly 1.
 */
function CardZoomPinchDetector({ children }: CardZoomPinchProps) {
  const zoom = useCardZoom();
  const ceiling = useCardZoomCeiling();
  const reducedMotion = useReducedMotion();
  // The zoom the fingers hold, the zoom the layout is at, and the limit swell.
  const shown = useSharedValue(zoom);
  const committed = useSharedValue(zoom);
  const pulse = useSharedValue(1);
  const base = useSharedValue(zoom);
  const side = useSharedValue(0);

  // The layout has committed at a new zoom: the cards ease from where the fingers left them to their own size.
  useEffect(() => {
    committed.set(zoom);
    if (reducedMotion || shown.get() === zoom) {
      shown.set(zoom);
      return;
    }
    shown.set(withTiming(zoom, SETTLE));
  }, [zoom, reducedMotion, shown, committed]);

  useEffect(() => {
    const listener = (at: LimitSide) => {
      if (!reducedMotion) pulse.set(limitPulse(at));
    };
    limitListeners.add(listener);
    return () => {
      limitListeners.delete(listener);
    };
  }, [pulse, reducedMotion]);

  const commit = useCallback(
    (value: number) => {
      const next = pinchedCardZoom(value, 1, ceiling);
      if (next !== zoom) setCardZoom(next);
      else shown.set(reducedMotion ? zoom : withTiming(zoom, SETTLE));
    },
    [ceiling, zoom, shown, reducedMotion],
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(() => {
          "worklet";
          base.set(shown.get());
          side.set(0);
        })
        .onUpdate((e) => {
          "worklet";
          const raw = base.get() * e.scale;
          shown.set(Math.min(Math.max(raw, GRID.CARD_ZOOM_MIN), ceiling));
          const at = raw > ceiling ? 1 : raw < GRID.CARD_ZOOM_MIN ? -1 : 0;
          if (at !== 0 && side.get() !== at && !reducedMotion) pulse.set(limitPulse(at));
          side.set(at);
        })
        .onFinalize(() => {
          "worklet";
          runOnJS(commit)(shown.get());
        }),
    [base, ceiling, commit, pulse, reducedMotion, shown, side],
  );

  const surface = useAnimatedStyle(() => ({ transform: [{ scale: (shown.get() / committed.get()) * pulse.get() }] }));

  return (
    <GestureHandlerRootView style={styles.fill}>
      <GestureDetector gesture={pinch}>
        <Animated.View style={[styles.fill, styles.surface, surface]} collapsable={false} testID="card-zoom-surface">
          {children}
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  surface: {
    transformOrigin: "0 0",
  },
});
