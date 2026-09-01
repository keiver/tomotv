import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import React, { ReactNode } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

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
  children?: ReactNode;
}

/**
 * Frosted chrome surface: Liquid Glass where the OS provides it, the classic dark blur
 * elsewhere. Corner radii come through `style` — the glass view forwards them into its
 * native corner configuration, so the refractive rim follows the card's rounding.
 */
export function GlassSurface({ style, intensity = 60, tint = "dark", tintColor = NEUTRAL_TINT, interactive = false, children }: GlassSurfaceProps) {
  if (LIQUID_GLASS) {
    // colorScheme pinned dark: the surface sits on artwork inside a dark canvas, and an
    // auto scheme would flip it white under a light system appearance.
    // The tint is also what stops regular glass adapting to backdrop luminance, which turned
    // the bar light under white text over a bright poster.
    return (
      <GlassView glassEffectStyle="regular" colorScheme="dark" tintColor={tintColor} isInteractive={interactive} style={style}>
        {children}
      </GlassView>
    );
  }
  // Below 26 there is no coloured blur to ask for: BlurView's `tint` is an enum of
  // UIBlurEffectStyle names, and UIVisualEffectView has no colour property either. A
  // translucent layer inside the material is the only mechanism UIKit offers here.
  return (
    <BlurView intensity={intensity} tint={tint} style={style}>
      {tintColor !== NEUTRAL_TINT && <View style={[StyleSheet.absoluteFill, { backgroundColor: tintColor }]} pointerEvents="none" />}
      {children}
    </BlurView>
  );
}
