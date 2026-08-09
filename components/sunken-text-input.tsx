import { settingsStyles } from "@/components/settings/styles";
import React, { forwardRef, useState } from "react";
import { Platform, StyleProp, StyleSheet, TextInput, TextInputProps, View, ViewStyle } from "react-native";

interface SunkenTextInputProps extends TextInputProps {
  /** Wrapper overrides: layout caps and any TV chrome the call site keeps. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Extra layers inside the wrapper, drawn above the inset shadow (e.g. the search loading bar). */
  children?: React.ReactNode;
}

/**
 * Text input in the settings cards' sunken-card treatment (phone): #2C2C2E
 * rounded card, the shared inset shadow, and a transparent border that turns
 * gold while the field is focused. On TV the wrapper adds no chrome of its
 * own; call sites pass any TV styling through containerStyle, so the connect
 * inputs keep their bare in-card look and search keeps its outlined field.
 */
export const SunkenTextInput = forwardRef<TextInput, SunkenTextInputProps>(function SunkenTextInput({ containerStyle, children, onFocus, onBlur, ...inputProps }, ref) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={[!Platform.isTV && styles.wrapper, containerStyle, isFocused && styles.wrapperFocused]}>
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
      {!Platform.isTV && <View style={settingsStyles.sectionInnerShadow} />}
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  // The resting border is transparent so the gold focus ring doesn't shift
  // layout; radius matches sectionInnerShadow's so the shadow follows the edge.
  wrapper: {
    width: "100%",
    borderRadius: 32,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "#2C2C2E",
  },
  wrapperFocused: {
    borderColor: "#FFC312",
  },
});
