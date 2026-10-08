import { CONTROL_HEIGHT } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { themedStyles, useCardPalette } from "@/hooks/useCardPalette";
import { withAlpha } from "@/utils/color";
import React, { forwardRef } from "react";
import { ActivityIndicator, Platform, Pressable, PressableProps, StyleSheet, Text, TextStyle, View, ViewStyle } from "react-native";

export type ButtonVariant = "primary" | "secondary" | "record" | "destructive" | "debug" | "retry" | "link";

/** Transparent ring the pill reserves so a focus border costs no layout shift. */
export const BUTTON_BORDER_WIDTH = Platform.isTV ? 4 : 3;

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
  const palette = useCardPalette();
  const themed = useThemedStyles();
  const getButtonStyle = (focused: boolean): ViewStyle => {
    const baseStyle = [
      styles.button,
      // Variant-specific styles
      variant === "primary" && themed.primaryButton,
      variant === "primary" && focused && themed.primaryButtonFocused,
      variant === "secondary" && themed.secondaryButton,
      variant === "secondary" && focused && themed.secondaryButtonFocused,
      variant === "record" && themed.secondaryButton,
      variant === "record" && focused && themed.secondaryButtonFocused,
      variant === "destructive" && styles.destructiveButton,
      variant === "destructive" && focused && styles.destructiveButtonFocused,
      variant === "debug" && styles.debugButton,
      variant === "debug" && focused && styles.debugButtonFocused,
      variant === "retry" && themed.primaryButton,
      variant === "retry" && focused && themed.primaryButtonFocused,
      variant === "link" && styles.linkButton,
      variant === "link" && focused && themed.linkButtonFocused,
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
      variant === "primary" && themed.primaryButtonText,
      variant === "secondary" && themed.secondaryButtonText,
      variant === "record" && themed.secondaryButtonText,
      variant === "destructive" && styles.destructiveButtonText,
      variant === "debug" && styles.debugButtonText,
      variant === "retry" && themed.primaryButtonText,
      variant === "link" && [styles.linkButtonText, themed.secondaryButtonText],
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
      // Caller state first: a toggle's selected/checked has to survive, and a caller's disabled
      // (a spent control that keeps focus) adds to the two the button owns.
      accessibilityState={{
        ...pressableProps.accessibilityState,
        disabled: !!pressableProps.accessibilityState?.disabled || !!disabled || !!isLoading,
        busy: isLoading,
      }}
      tvParallaxProperties={pressableProps.tvParallaxProperties ?? { magnification: 1.05, pressMagnification: 1.0 }}>
      {/* Kept in the native tree: flattened, the spinner swap and optional title renumber the focusable's children. */}
      <View style={styles.buttonContent} collapsable={false}>
        {isLoading ? (
          <ActivityIndicator color={variant === "primary" ? palette.onAccent : variant === "record" ? COLORS.DESTRUCTIVE : palette.accent} size={"small"} />
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
    borderWidth: BUTTON_BORDER_WIDTH,
    borderColor: "transparent",
    // Use consistent shadowRadius to prevent layout shift when focus changes
    shadowColor: COLORS.SHADOW,
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
  // No scale on TV: a JS transform replaces the layer transform the native focus lift lives on.
  buttonPressed: {
    opacity: 0.8,
    ...(Platform.isTV ? null : { transform: [{ scale: 0.98 }] }),
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

  // Destructive variant (Red text)
  destructiveButton: {
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  destructiveButtonFocused: {
    backgroundColor: "rgba(255, 59, 48, 0.15)",
    borderColor: COLORS.DESTRUCTIVE,
    shadowColor: COLORS.DESTRUCTIVE,
    shadowOpacity: 0.4,
    elevation: 6,
  },
  destructiveButtonText: {
    color: COLORS.DESTRUCTIVE,
    fontSize: Platform.isTV ? 24 : 17,
  },

  // Debug variant (Gray border)
  debugButton: {
    backgroundColor: "transparent",
    borderColor: COLORS.TEXT_TERTIARY,
  },
  debugButtonFocused: {
    backgroundColor: "rgba(142, 142, 147, 0.15)",
    borderColor: COLORS.BORDER_FOCUSED,
    shadowColor: COLORS.TEXT_TERTIARY,
    shadowOpacity: 0.4,
    elevation: 6,
  },
  debugButtonText: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: Platform.isTV ? 24 : 17,
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
  // The accent, not gray (themed.secondaryButtonText): these are the alternate actions on a screen,
  // not disabled ones, and at TV viewing distance a muted label reads as unavailable. The pill fill
  // still separates them from the primary; the color is shared.
  linkButtonText: {
    fontSize: Platform.isTV ? 24 : 15,
    fontWeight: "600",
  },
});

// The accent-bearing variants. Retry wears the primary's; record wears the secondary's outline (the
// caller's icon carries the recording red).
const useThemedStyles = themedStyles((palette) => ({
  // Primary: the accent fill, its ink.
  primaryButton: {
    backgroundColor: palette.accent,
    borderColor: "transparent",
  },
  primaryButtonFocused: {
    backgroundColor: palette.accentFocused,
    borderColor: COLORS.BORDER_FOCUSED,
    shadowColor: palette.accent,
    shadowOpacity: 0.5,
    elevation: 8,
  },
  primaryButtonText: {
    color: palette.onAccent,
  },
  // Secondary: transparent with an accent border.
  secondaryButton: {
    backgroundColor: "transparent",
    borderColor: palette.accent,
  },
  secondaryButtonFocused: {
    backgroundColor: withAlpha(palette.accent, 0.15),
    borderColor: palette.accentFocused,
    shadowColor: palette.accent,
    shadowOpacity: 0.4,
    elevation: 6,
  },
  secondaryButtonText: {
    color: palette.accent,
  },
  // Focus is a tinted rounded field behind the text, the way ServerRow carries it.
  linkButtonFocused: {
    backgroundColor: withAlpha(palette.accent, 0.15),
    borderColor: "transparent",
  },
}));
