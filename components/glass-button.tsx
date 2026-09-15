import { FocusableButton } from "@/components/FocusableButton";
import { GlassSurface } from "@/components/glass-surface";
import React, { forwardRef, type ComponentProps } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

const PILL_HEIGHT = 52;
const CAPSULE_PADDING = 6;

/** No focus lift inside glass: a scaled pill grows with its width, so the rim stops being concentric. */
export const GLASS_PILL_PARALLAX = { magnification: 1.0, pressMagnification: 1.0 };

type GlassButtonProps = Omit<ComponentProps<typeof FocusableButton>, "ref" | "tvParallaxProperties">;

/** CTA: a compact FocusableButton pill inside a glass capsule, the tab bar's shape. */
export const GlassButton = forwardRef<View, GlassButtonProps>(function GlassButton({ variant = "link", style, textStyle, ...buttonProps }, ref) {
  const pillStyle: ViewStyle = StyleSheet.flatten([styles.pill, style]);
  // Concentric rim: half the pill's fixed height (a circle passes its diameter) plus the padding.
  const pillHeight = typeof pillStyle.height === "number" ? pillStyle.height : typeof pillStyle.minHeight === "number" ? pillStyle.minHeight : PILL_HEIGHT;
  return (
    <GlassSurface style={styles.capsule} radius={pillHeight / 2 + CAPSULE_PADDING}>
      <FocusableButton ref={ref} variant={variant} tvParallaxProperties={GLASS_PILL_PARALLAX} style={pillStyle} textStyle={StyleSheet.flatten([styles.text, textStyle])} {...buttonProps} />
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
