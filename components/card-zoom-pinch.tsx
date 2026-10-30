import { GRID } from "@/constants/app";
import { useCardZoom, useCardZoomCeiling } from "@/hooks/useCardZoom";
import { setCardZoom } from "@/services/cardZoom";
import { pinchedCardZoom } from "@/utils/cardZoom";
import { THIS_DEVICE } from "@/utils/hostEnvironment";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useReducedMotion, useSharedValue } from "react-native-reanimated";

const SETTLE_MS = 180;
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

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Calls `step` with the eased progress (0 to 1) on each frame for `ms`; returns the cancel. */
function tween(ms: number, step: (progress: number) => void): () => void {
  let start = -1;
  let frame = requestAnimationFrame(function tick(now: number) {
    if (start < 0) start = now;
    const t = Math.min((now - start) / ms, 1);
    step(easeOut(t));
    if (t < 1) frame = requestAnimationFrame(tick);
  });
  return () => cancelAnimationFrame(frame);
}

interface CardZoomPinchProps {
  children: React.ReactNode;
}

/** A pinch over the cards it wraps sets the card zoom every card surface draws at. TV and iPhone have no pinch and get the children alone. */
export function CardZoomPinch({ children }: CardZoomPinchProps) {
  if (Platform.isTV || THIS_DEVICE === "iPhone") return <>{children}</>;
  return <CardZoomPinchDetector>{children}</CardZoomPinchDetector>;
}

/**
 * `shown` is the zoom on screen; the cards are laid out at the committed zoom and scaled by shown / committed. Both live in
 * React, so a new layout and its scale land in one commit, and at rest the scale is exactly 1 and no transform is drawn.
 */
function CardZoomPinchDetector({ children }: CardZoomPinchProps) {
  const zoom = useCardZoom();
  const ceiling = useCardZoomCeiling();
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(zoom);
  const [pinching, setPinching] = useState(false);
  const [pulse, setPulse] = useState(1);
  const [limitHit, setLimitHit] = useState({ side: 1 as LimitSide, count: 0 });
  // Mutable gesture state for the handlers; the children never read it.
  const shownNow = useSharedValue(zoom);
  const base = useSharedValue(zoom);
  const side = useSharedValue(0);

  // Released, or a new zoom committed: the cards ease from where they are on screen to the layout's own size.
  useEffect(() => {
    if (pinching) return;
    const from = shownNow.get();
    if (from === zoom) return;
    const show = (value: number) => {
      shownNow.set(value);
      setShown(value);
    };
    if (reducedMotion) {
      show(zoom);
      return;
    }
    return tween(SETTLE_MS, (progress) => show(progress === 1 ? zoom : from + (zoom - from) * progress));
  }, [pinching, zoom, reducedMotion, shownNow]);

  useEffect(() => {
    if (limitHit.count === 0 || reducedMotion) return;
    const peak = 1 + PULSE * limitHit.side;
    const total = PULSE_OUT_MS + PULSE_BACK_MS;
    const cancel = tween(total, (progress) => {
      const elapsed = progress * total;
      setPulse(progress === 1 ? 1 : elapsed < PULSE_OUT_MS ? 1 + (peak - 1) * (elapsed / PULSE_OUT_MS) : peak + (1 - peak) * ((elapsed - PULSE_OUT_MS) / PULSE_BACK_MS));
    });
    return () => {
      cancel();
      setPulse(1);
    };
  }, [limitHit, reducedMotion]);

  useEffect(() => {
    const listener = (at: LimitSide) => setLimitHit((hit) => ({ side: at, count: hit.count + 1 }));
    limitListeners.add(listener);
    return () => {
      limitListeners.delete(listener);
    };
  }, []);

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onStart(() => {
          base.set(shownNow.get());
          side.set(0);
          setPinching(true);
        })
        .onUpdate((e) => {
          const raw = base.get() * e.scale;
          const value = Math.min(Math.max(raw, GRID.CARD_ZOOM_MIN), ceiling);
          shownNow.set(value);
          setShown(value);
          const at = raw > ceiling ? 1 : raw < GRID.CARD_ZOOM_MIN ? -1 : 0;
          if (at !== 0 && side.get() !== at) setLimitHit((hit) => ({ side: at, count: hit.count + 1 }));
          side.set(at);
        })
        .onFinalize(() => {
          setPinching(false);
          const next = pinchedCardZoom(shownNow.get(), 1, ceiling);
          if (next !== zoom) setCardZoom(next);
        }),
    [base, ceiling, shownNow, side, zoom],
  );

  const scale = (shown * pulse) / zoom;

  return (
    <GestureHandlerRootView style={styles.fill}>
      <GestureDetector gesture={pinch}>
        <View style={[styles.fill, scale !== 1 && { transformOrigin: "0 0", transform: [{ scale }] }]} collapsable={false} testID="card-zoom-surface">
          {children}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
