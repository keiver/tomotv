import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import React, { ReactNode } from "react";
import { StyleProp, StyleSheet, View, ViewProps, ViewStyle } from "react-native";

// Runtime constant: true only on tvOS/iOS 26+ builds where UIGlassEffect exists and the app
// hasn't opted into compatibility mode. Below that the surface renders the BlurView the cards
// always used, so pre-26 devices see a pixel-identical UI. The catch covers environments with
// no native module at all (Jest, a build made before the pod was installed).
const LIQUID_GLASS = (() => {
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

/**
 * expo-glass-effect declares borderRadius on the native view (GlassEffectModule.swift, Prop
 * "borderRadius" into UICornerConfiguration) but leaves it out of GlassViewProps, so the
 * shaping prop is reached through a widened type rather than left in `style`, where it would
 * only set layer.cornerRadius and mask the material.
 */
const ShapedGlassView = GlassView as unknown as React.ComponentType<React.ComponentProps<typeof GlassView> & { borderRadius?: number }>;

/** The neutral floor every card has always used. */
const NEUTRAL_TINT = "rgba(28, 28, 30, 0.75)";

interface GlassSurfaceProps {
  style?: StyleProp<ViewStyle>;
  /** BlurView fallback intensity. */
  intensity?: number;
  /** BlurView fallback tint. */
  tint?: "dark" | "light" | "default";
  /**
   * Colour of the material itself. On iOS 26 this is `UIGlassEffect`'s own tint, so the glass
   * still refracts what is behind it. Keep the alpha low: a high one turns the material into a
   * flat pane, which is the thing a tint is not for.
   */
  tintColor?: string;
  /**
   * UIGlassEffect.isInteractive: the material answers a press with Apple's own highlight.
   * For a control, not a panel. Nothing to forward on the pre-26 blur.
   */
  interactive?: boolean;
  /**
   * Corner radius. A PROP, not style: expo-glass-effect declares borderRadius on the native
   * view and drives UICornerConfiguration with it, so a radius left in `style` only sets
   * layer.cornerRadius and masks the material instead of shaping it.
   */
  radius?: number;
  pointerEvents?: ViewProps["pointerEvents"];
  children?: ReactNode;
}

/**
 * Frosted chrome surface: Liquid Glass where the OS provides it, the classic dark blur
 * elsewhere. Corner radii come through `style` — the glass view forwards them into its
 * native corner configuration, so the refractive rim follows the card's rounding.
 */
export function GlassSurface({ style, intensity = 60, tint = "dark", tintColor = NEUTRAL_TINT, interactive = false, radius, pointerEvents, children }: GlassSurfaceProps) {
  if (LIQUID_GLASS) {
    // colorScheme pinned dark: the surface sits on artwork inside a dark canvas, and an
    // auto scheme would flip it white under a light system appearance.
    // The tint is also what stops regular glass adapting to backdrop luminance, which turned
    // the bar light under white text over a bright poster.
    return (
      <ShapedGlassView glassEffectStyle="regular" colorScheme="dark" tintColor={tintColor} isInteractive={interactive} borderRadius={radius} pointerEvents={pointerEvents} style={style}>
        {children}
      </ShapedGlassView>
    );
  }
  // Below 26 there is no coloured blur to ask for: BlurView's `tint` is an enum of
  // UIBlurEffectStyle names, and UIVisualEffectView has no colour property either. A
  // translucent layer inside the material is the only mechanism UIKit offers here.
  return (
    <BlurView intensity={intensity} tint={tint} pointerEvents={pointerEvents} style={[style, radius !== undefined && { borderRadius: radius, overflow: "hidden" as const }]}>
      {tintColor !== NEUTRAL_TINT && <View style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]} pointerEvents="none" />}
      {children}
    </BlurView>
  );
}
