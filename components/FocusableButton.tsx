import { CONTROL_HEIGHT } from "@/constants/app";
import React, { forwardRef } from "react";
import { ActivityIndicator, Platform, Pressable, PressableProps, StyleSheet, Text, TextStyle, View, ViewStyle } from "react-native";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "debug" | "retry" | "link";

interface FocusableButtonProps extends Omit<PressableProps, "style"> {
  /** Button text label. Omit for an icon-only button — pass `accessibilityLabel` instead. */
  title?: string;
  /** Visual variant of the button */
  variant?: ButtonVariant;
  /** Whether button is in loading state */
  isLoading?: boolean;
  /** Optional icon to display before text */
  icon?: React.ReactNode;
  /** Whether this button should have TV preferred focus */
  hasTVPreferredFocus?: boolean;
  /** Custom styles for the button container */
  style?: ViewStyle;
  /** Custom styles for the button text */
  textStyle?: TextStyle;
}

/**
 * FocusableButton - A reusable button component with enhanced TV focus styling
 *
 * Features:
 * - Clear visual focus indication for TV navigation
 * - Multiple visual variants (primary, secondary, destructive, etc.)
 * - Loading state with spinner
 * - Icon support
 * - Platform-specific sizing (larger on TV)
 * - Proper accessibility with isTVSelectable
 * - Forwards its ref to the underlying Pressable so it can be a TVFocusGuideView destination
 *
 * NOTE: bare `forwardRef<...>` (not `React.forwardRef<...>`) — Metro's Babel fails to parse
 * type arguments on a member-expression call ("Missing initializer in const declaration").
 */
export const FocusableButton = forwardRef<View, FocusableButtonProps>(function FocusableButton(
  { title, variant = "primary", isLoading = false, icon, hasTVPreferredFocus = false, disabled = false, style, textStyle, ...pressableProps }: FocusableButtonProps,
  ref,
) {
  const getButtonStyle = (focused: boolean): ViewStyle => {
    const baseStyle = [
      styles.button,
      // Variant-specific styles
      variant === "primary" && styles.primaryButton,
      variant === "primary" && focused && styles.primaryButtonFocused,
      variant === "secondary" && styles.secondaryButton,
      variant === "secondary" && focused && styles.secondaryButtonFocused,
      variant === "destructive" && styles.destructiveButton,
      variant === "destructive" && focused && styles.destructiveButtonFocused,
      variant === "debug" && styles.debugButton,
      variant === "debug" && focused && styles.debugButtonFocused,
      variant === "retry" && styles.retryButton,
      variant === "retry" && focused && styles.retryButtonFocused,
      variant === "link" && styles.linkButton,
      variant === "link" && focused && styles.linkButtonFocused,
      // Disabled state
      (disabled || isLoading) && styles.buttonDisabled,
      // Custom styles
      style,
    ].filter(Boolean) as ViewStyle[];

    return StyleSheet.flatten(baseStyle);
  };

  const getTextStyle = (): TextStyle => {
    const baseStyle = [
      styles.buttonText,
      // Variant-specific text styles
      variant === "primary" && styles.primaryButtonText,
      variant === "secondary" && styles.secondaryButtonText,
      variant === "destructive" && styles.destructiveButtonText,
      variant === "debug" && styles.debugButtonText,
      variant === "retry" && styles.retryButtonText,
      variant === "link" && styles.linkButtonText,
      // Disabled state
      (disabled || isLoading) && styles.buttonTextDisabled,
      // Custom text styles
      textStyle,
    ].filter(Boolean) as TextStyle[];

    return StyleSheet.flatten(baseStyle);
  };

  return (
    <Pressable
      {...pressableProps}
      ref={ref}
      style={({ pressed, focused }) => [getButtonStyle(focused || false), pressed && styles.buttonPressed]}
      disabled={disabled || isLoading}
      isTVSelectable={!disabled && !isLoading}
      hasTVPreferredFocus={hasTVPreferredFocus}
      // An explicitly passed label wins: a title can carry punctuation that is meant to be seen and
      // not spoken. Falls back to the title, which is what an icon-less button usually wants.
      accessibilityLabel={pressableProps.accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{
        disabled: disabled || isLoading,
        busy: isLoading,
      }}
      tvParallaxProperties={{
        magnification: 1.05,
        pressMagnification: 1.0,
      }}>
      <View style={styles.buttonContent}>
        {isLoading ? (
          <ActivityIndicator color={variant === "primary" ? "#000000" : "#FFC312"} size={"small"} />
        ) : (
          <>
            {icon}
            {title != null && <Text style={getTextStyle()}>{title}</Text>}
          </>
        )}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: {
    paddingVertical: Platform.isTV ? 20 : 14,
    paddingHorizontal: Platform.isTV ? 48 : 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    minHeight: CONTROL_HEIGHT,
    minWidth: Platform.isTV ? 300 : 200,
    // Add transparent border to prevent layout shift on focus
    borderWidth: Platform.isTV ? 4 : 3,
    borderColor: "transparent",
    // Use consistent shadowRadius to prevent layout shift when focus changes
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: Platform.isTV ? 20 : 12,
    elevation: 2,
    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Platform.isTV ? 12 : 8,
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: Platform.isTV ? 28 : 18,
    fontWeight: "600",
    // The pill centres the text block; without this a label that wraps sets its
    // own lines flush left inside it.
    textAlign: "center",
  },
  buttonTextDisabled: {
    opacity: 0.6,
  },

  // Primary variant (Yellow background, black text)
  primaryButton: {
    backgroundColor: "#FFC312",
    borderColor: "transparent",
  },
  primaryButtonFocused: {
    backgroundColor: "#FFD54F",
    borderColor: "#FFFFFF",
    shadowColor: "#FFC312",
    shadowOpacity: 0.5,
    elevation: 8,
  },
  primaryButtonText: {
    color: "#000000",
  },

  // Secondary variant (Transparent with yellow border)
  secondaryButton: {
    backgroundColor: "transparent",
    borderColor: "#FFC312",
  },
  secondaryButtonFocused: {
    backgroundColor: "rgba(255, 195, 18, 0.15)",
    borderColor: "#FFD54F",
    shadowColor: "#FFC312",
    shadowOpacity: 0.4,
    elevation: 6,
  },
  secondaryButtonText: {
    color: "#FFC312",
  },

  // Destructive variant (Red text)
  destructiveButton: {
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  destructiveButtonFocused: {
    backgroundColor: "rgba(255, 59, 48, 0.15)",
    borderColor: "#FF3B30",
    shadowColor: "#FF3B30",
    shadowOpacity: 0.4,
    elevation: 6,
  },
  destructiveButtonText: {
    color: "#FF3B30",
    fontSize: Platform.isTV ? 24 : 17,
  },

  // Debug variant (Gray border)
  debugButton: {
    backgroundColor: "transparent",
    borderColor: "#8E8E93",
  },
  debugButtonFocused: {
    backgroundColor: "rgba(142, 142, 147, 0.15)",
    borderColor: "#FFFFFF",
    shadowColor: "#8E8E93",
    shadowOpacity: 0.4,
    elevation: 6,
  },
  debugButtonText: {
    color: "#98989D",
    fontSize: Platform.isTV ? 24 : 17,
  },

  // Retry variant (Yellow background)
  retryButton: {
    backgroundColor: "#FFC312",
    borderColor: "transparent",
  },
  retryButtonFocused: {
    backgroundColor: "#FFD54F",
    borderColor: "#FFFFFF",
    shadowColor: "#FFC312",
    shadowOpacity: 0.5,
    elevation: 8,
  },
  retryButtonText: {
    color: "#000000",
  },

  // Link variant (bare text, for the alternates under a primary CTA)
  // Sheds every pill affordance — fill, border, shadow, minimum size — so a row
  // of these reads as text, not as more buttons competing with the CTA above.
  linkButton: {
    backgroundColor: "transparent",
    borderColor: "transparent",
    minWidth: 0,
    minHeight: 0,
    paddingVertical: Platform.isTV ? 10 : 8,
    paddingHorizontal: Platform.isTV ? 20 : 10,
    shadowOpacity: 0,
    elevation: 0,
    boxShadow: "none",
  },
  // Focus is a tinted rounded field behind the text, the way ServerRow carries
  // it: getTextStyle() takes no focus argument, so the state can't live on the
  // glyphs without changing the primitive's signature for one variant.
  linkButtonFocused: {
    backgroundColor: "rgba(255, 195, 18, 0.15)",
    borderColor: "transparent",
  },
  // Gold, not gray: these are the alternate actions on a screen, not disabled
  // ones, and at TV viewing distance a muted label reads as unavailable. The
  // pill fill still separates them from the primary — the color is shared.
  linkButtonText: {
    color: "#FFC312",
    fontSize: Platform.isTV ? 24 : 15,
    fontWeight: "600",
  },
});
