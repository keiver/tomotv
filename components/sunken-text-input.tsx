import { CONTROL_HEIGHT } from "@/constants/app";
import React, { forwardRef, useState } from "react";
import { Platform, StyleProp, StyleSheet, TextInput, TextInputProps, View, ViewStyle } from "react-native";

interface SunkenTextInputProps extends TextInputProps {
  /** Wrapper overrides: layout caps and any TV chrome the call site keeps. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Extra layers inside the wrapper, drawn above the inset shadow (e.g. the search loading bar). */
  children?: React.ReactNode;
}

/**
 * Text input in the settings cards' sunken-card treatment, on every platform:
 * a #2C2C2E rounded card, an inset shadow, and a transparent border that turns
 * gold while the field is focused. The same visual language as the section
 * cards and the Quick Connect code container.
 *
 * The shadow is painted BY THE WRAPPER, not by an overlay child, which is what
 * lets this work on tvOS. The previous version used settingsStyles'
 * sectionInnerShadow — an absolutely positioned view laid over the field — and
 * an overlay above a focusable occludes it on tvOS, so the focus engine refuses
 * to enter. Rather than accept that, it switched all of its chrome off on TV
 * and left every call site to hand-roll its own, which is why the connect
 * inputs had no container there at all.
 *
 * settingsStyles.section solves the same problem the same way: inset boxShadow
 * on the container, transparent children so it shows through. The one
 * requirement that follows is that the field must NOT paint its own background,
 * or it covers the shadow (that is precisely what the overlay existed to work
 * around).
 */
export const SunkenTextInput = forwardRef<TextInput, SunkenTextInputProps>(function SunkenTextInput({ containerStyle, children, onFocus, onBlur, ...inputProps }, ref) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={[styles.wrapper, containerStyle, isFocused && styles.wrapperFocused]}>
      <TextInput
        ref={ref}
        {...inputProps}
        onFocus={(e) => {
          setIsFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setIsFocused(false);
          onBlur?.(e);
        }}
      />
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  // The resting border is transparent so the gold focus ring doesn't shift
  // layout. Same inset-shadow recipe as settingsStyles.section, one step tighter
  // for the smaller surface: it reads as a well cut into the card rather than as
  // a vignette across a field this shallow.
  wrapper: {
    width: "100%",
    // Matches a FocusableButton, so a field and a CTA on one screen are the same
    // size of control. The field inside flexes to fill it.
    height: CONTROL_HEIGHT,
    borderRadius: Platform.isTV ? 28 : 32,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "#2C2C2E",
    boxShadow: Platform.isTV
      ? "inset 0 10px 10px rgba(0,0,0,0.55), inset 0 -8px 7px rgba(0,0,0,0.35), inset 0 0 3px rgba(0,0,0,0.5)"
      : "inset 0 6px 6px rgba(0,0,0,0.55), inset 0 -4px 4px rgba(0,0,0,0.35), inset 0 0 2px rgba(0,0,0,0.5)",
  },
  wrapperFocused: {
    borderColor: "#FFC312",
  },
});
