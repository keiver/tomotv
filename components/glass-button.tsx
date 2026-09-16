import { FocusableButton } from "@/components/FocusableButton";
import { GlassSurface } from "@/components/glass-surface";
import React, { forwardRef, useState, type ComponentProps } from "react";
import { StyleSheet, View, type NativeSyntheticEvent, type TargetedEvent, type ViewStyle } from "react-native";

const PILL_HEIGHT = 52;
const CAPSULE_PADDING = 6;

// Yellow material: ACCENT (#FFC312) at a low alpha so the glass still refracts; focus deepens it.
const TINT_REST = "rgba(255, 195, 18, 0.067)";
const TINT_FOCUSED = "rgba(255, 195, 18, 0.4)";

/** No focus lift inside glass: a scaled pill grows with its width, so the rim stops being concentric. */
export const GLASS_PILL_PARALLAX = { magnification: 1.0, pressMagnification: 1.0 };

type GlassButtonProps = Omit<ComponentProps<typeof FocusableButton>, "ref" | "tvParallaxProperties">;

/** CTA: a compact FocusableButton pill inside a glass capsule, the tab bar's shape. */
export const GlassButton = forwardRef<View, GlassButtonProps>(function GlassButton({ variant = "link", style, textStyle, icon, onFocus, onBlur, ...buttonProps }, ref) {
  const [focused, setFocused] = useState(false);
  // Focus turns the glyph white; the icon carries its own resting color prop.
  const focusedIcon = focused && React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<{ color?: string }>, { color: "#FFFFFF" }) : icon;
  const pillStyle: ViewStyle = StyleSheet.flatten([styles.pill, style]);
  // Concentric rim: half the pill's fixed height (a circle passes its diameter) plus the padding.
  const pillHeight = typeof pillStyle.height === "number" ? pillStyle.height : typeof pillStyle.minHeight === "number" ? pillStyle.minHeight : PILL_HEIGHT;
  const handleFocus = (e: NativeSyntheticEvent<TargetedEvent>) => {
    setFocused(true);
    onFocus?.(e);
  };
  const handleBlur = (e: NativeSyntheticEvent<TargetedEvent>) => {
    setFocused(false);
    onBlur?.(e);
  };
  return (
    <GlassSurface style={styles.capsule} radius={pillHeight / 2 + CAPSULE_PADDING} tintColor={focused ? TINT_FOCUSED : TINT_REST}>
      <FocusableButton
        ref={ref}
        variant={variant}
        icon={focusedIcon}
        tvParallaxProperties={GLASS_PILL_PARALLAX}
        style={pillStyle}
        textStyle={StyleSheet.flatten([styles.text, textStyle, focused && styles.textFocused])}
        onFocus={handleFocus}
        onBlur={handleBlur}
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
  textFocused: {
    color: "#FFFFFF",
  },
});
