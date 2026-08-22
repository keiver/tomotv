import React, { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, ViewStyle } from "react-native";

interface InfoFocusRowProps {
  children: ReactNode;
  style?: ViewStyle;
  /** tvOS: claim focus on mount, for a screen whose real focusables load later. */
  hasTVPreferredFocus?: boolean;
}

/**
 * Read-only content block that is a focusable stop on tvOS — a ScrollView
 * cannot scroll there without focusable children, so each block becomes a
 * DPAD landing that pulls itself into view. Plain View on phone.
 */
export function InfoFocusRow({ children, style, hasTVPreferredFocus = false }: InfoFocusRowProps) {
  if (!Platform.isTV) {
    return <View style={style}>{children}</View>;
  }
  return (
    <Pressable
      isTVSelectable
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={({ focused }) => [styles.row, style, focused && styles.rowFocused]}
      tvParallaxProperties={{ magnification: 1.0, pressMagnification: 1.0 }}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Negative-space hit slop: the highlight breathes past the content without
  // shifting the column's layout when focus arrives.
  row: {
    borderRadius: 16,
    paddingHorizontal: 16,
    marginHorizontal: -16,
    paddingVertical: 8,
    marginVertical: -8,
  },
  rowFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
});
