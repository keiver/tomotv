import { CARD_FOCUS, DESIGN } from "@/constants/app";
import { useCardPalette } from "@/hooks/useCardPalette";
import { swingStops } from "@/utils/swingStops";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Animated, Easing, type LayoutChangeEvent, Platform, StyleSheet, useAnimatedValue } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/** How far the ring grows past the card on each side, inside the card's own padding (16 on TV, 8 elsewhere). */
export const BURST_OUTSET = Platform.isTV ? 12 : 6;
const BURST_MS = 420;
const FLASH_PEAK = 0.35;
const FLASH_IN_MS = 110;
const FLASH_OUT_MS = 300;
/** The arrival burst fits inside the nav state's linger, so it plays out before the overlay unmounts. */
const ARRIVAL_MS = 300;
const BREATH_MS = 1_100;

interface CardPressBurstProps {
  /** The press is loading its destination; false once it arrives (or was abandoned). */
  active: boolean;
  square?: boolean;
}

/**
 * A pressed card's ring bursts out from its border, the border breathes while the next screen loads,
 * and a last burst plays when it arrives. Reduce Motion holds a still border.
 */
export function CardPressBurst({ active, square = false }: CardPressBurstProps) {
  const { accent } = useCardPalette();
  const reducedMotion = useReducedMotion();
  // grow runs 0 to 1; the ring's measured size turns it into the same outset on every side.
  const grow = useAnimatedValue(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }), []);
  const ringTransform = useMemo(
    () => [
      { scaleX: grow.interpolate({ inputRange: [0, 1], outputRange: [1, size.width > 0 ? 1 + (2 * BURST_OUTSET) / size.width : 1] }) },
      { scaleY: grow.interpolate({ inputRange: [0, 1], outputRange: [1, size.height > 0 ? 1 + (2 * BURST_OUTSET) / size.height : 1] }) },
    ],
    [grow, size],
  );
  const ringOpacity = useAnimatedValue(0);
  const breath = useAnimatedValue(0);
  const breathing = useAnimatedValue(0);
  const borderOpacity = useMemo(() => Animated.multiply(breath.interpolate(swingStops(1, 0.35)), breathing), [breath, breathing]);

  useEffect(() => {
    if (reducedMotion) {
      breathing.setValue(active ? 1 : 0);
      return;
    }
    const native = { useNativeDriver: true };
    if (active) {
      grow.setValue(0);
      ringOpacity.setValue(1);
      breath.setValue(0);
      const burst = Animated.parallel([
        Animated.timing(grow, { ...native, toValue: 1, duration: BURST_MS, easing: Easing.out(Easing.cubic) }),
        Animated.timing(ringOpacity, { ...native, toValue: 0, duration: BURST_MS, easing: Easing.out(Easing.quad) }),
        Animated.timing(breathing, { ...native, toValue: 1, duration: BURST_MS }),
      ]);
      const loop = Animated.loop(Animated.timing(breath, { ...native, toValue: 1, duration: BREATH_MS, easing: Easing.linear }));
      burst.start();
      loop.start();
      return () => {
        burst.stop();
        loop.stop();
      };
    }
    grow.setValue(0);
    ringOpacity.setValue(1);
    const arrival = Animated.parallel([
      Animated.timing(grow, { ...native, toValue: 1, duration: ARRIVAL_MS, easing: Easing.out(Easing.cubic) }),
      Animated.timing(ringOpacity, { ...native, toValue: 0, duration: ARRIVAL_MS, easing: Easing.out(Easing.quad) }),
      Animated.timing(breathing, { ...native, toValue: 0, duration: ARRIVAL_MS / 2 }),
    ]);
    arrival.start();
    return () => arrival.stop();
  }, [active, reducedMotion, grow, ringOpacity, breath, breathing]);

  const shape = [styles.ring, { borderColor: accent }, square && styles.square];
  return (
    <>
      <Animated.View style={[shape, { opacity: borderOpacity }]} pointerEvents="none" onLayout={onLayout} testID="card-press-border" />
      {reducedMotion ? null : <Animated.View style={[shape, { opacity: ringOpacity, transform: ringTransform }]} pointerEvents="none" testID="card-press-ring" />}
    </>
  );
}

/** The tint flash over the art, inside its clip: up to FLASH_PEAK on the press and once more, softer, on arrival. */
export function CardPressFlash({ active }: { active: boolean }) {
  const { accent } = useCardPalette();
  const reducedMotion = useReducedMotion();
  const opacity = useAnimatedValue(0);

  useEffect(() => {
    if (reducedMotion) return;
    const peak = active ? FLASH_PEAK : FLASH_PEAK / 2;
    const flash = Animated.sequence([
      Animated.timing(opacity, { toValue: peak, duration: FLASH_IN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: active ? FLASH_OUT_MS : ARRIVAL_MS - FLASH_IN_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]);
    flash.start();
    return () => flash.stop();
  }, [active, reducedMotion, opacity]);

  if (reducedMotion) return null;
  return <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: accent, opacity }]} pointerEvents="none" testID="card-press-flash" />;
}

const styles = StyleSheet.create({
  ring: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: DESIGN.BORDER_RADIUS_CARD,
    borderWidth: CARD_FOCUS.BORDER_WIDTH_FOCUSED,
  },
  square: {
    borderRadius: 0,
  },
});
