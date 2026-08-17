import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import React, { ReactNode } from "react";
import { StyleProp, ViewStyle } from "react-native";

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

interface GlassSurfaceProps {
  style?: StyleProp<ViewStyle>;
  /** BlurView fallback intensity. */
  intensity?: number;
  /** BlurView fallback tint. */
  tint?: "dark" | "light" | "default";
  children?: ReactNode;
}

/**
 * Frosted chrome surface: Liquid Glass where the OS provides it, the classic dark blur
 * elsewhere. Corner radii come through `style` — the glass view forwards them into its
 * native corner configuration, so the refractive rim follows the card's rounding.
 */
export function GlassSurface({ style, intensity = 60, tint = "dark", children }: GlassSurfaceProps) {
  if (LIQUID_GLASS) {
    // colorScheme pinned dark: the surface sits on artwork inside a dark canvas, and an
    // auto scheme would flip it white under a light system appearance.
    // tintColor pinned dark too: regular glass adapts to backdrop luminance, so a bright
    // poster bottom turned the bar light under white text. The tint fixes the floor the
    // way the dark BlurView fallback always did.
    return (
      <GlassView glassEffectStyle="regular" colorScheme="dark" tintColor="rgba(28, 28, 30, 0.75)" style={style}>
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView intensity={intensity} tint={tint} style={style}>
      {children}
    </BlurView>
  );
}
