import { FocusableButton } from "@/components/FocusableButton";
import { GlassSurface } from "@/components/glass-surface";
import React, { forwardRef, type ComponentProps } from "react";
import { StyleSheet, View } from "react-native";

const PILL_HEIGHT = 52;
const CAPSULE_PADDING = 6;
const CAPSULE_RADIUS = PILL_HEIGHT / 2 + CAPSULE_PADDING;

/** No focus lift inside glass: a scaled pill grows with its width, so the rim stops being concentric. */
export const GLASS_PILL_PARALLAX = { magnification: 1.0, pressMagnification: 1.0 };

type GlassButtonProps = Omit<ComponentProps<typeof FocusableButton>, "ref" | "tvParallaxProperties">;

/** tvOS CTA: a compact FocusableButton pill inside a glass capsule, the tab bar's shape. */
export const GlassButton = forwardRef<View, GlassButtonProps>(function GlassButton({ variant = "link", style, textStyle, ...buttonProps }, ref) {
  return (
    <GlassSurface style={styles.capsule} radius={CAPSULE_RADIUS}>
      <FocusableButton
        ref={ref}
        variant={variant}
        tvParallaxProperties={GLASS_PILL_PARALLAX}
        style={StyleSheet.flatten([styles.pill, style])}
        textStyle={StyleSheet.flatten([styles.text, textStyle])}
        {...buttonProps}
      />
    </GlassSurface>
  );
});

const styles = StyleSheet.create({
  // Shape comes from GlassSurface's radius: a borderRadius or overflow here masks the material.
  capsule: {
    padding: CAPSULE_PADDING,
  },
  pill: {
    minWidth: 0,
    minHeight: PILL_HEIGHT,
    paddingVertical: 8,
    paddingHorizontal: 28,
  },
  text: {
    fontSize: 22,
  },
});
