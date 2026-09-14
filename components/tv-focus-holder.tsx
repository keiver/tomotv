import React from "react";
import { Platform, Pressable, StyleSheet } from "react-native";

interface TVFocusHolderProps {
  /** Claims focus while true; pass the screen's focus so a covered screen never takes the slot. */
  preferred?: boolean;
}

/**
 * tvOS: an invisible focusable filling its parent, for a screen state with nothing else to focus.
 * With no focusable on screen, Menu reaches nothing that pops and the system backgrounds the app.
 */
export function TVFocusHolder({ preferred = true }: TVFocusHolderProps) {
  if (!Platform.isTV) return null;
  return <Pressable isTVSelectable hasTVPreferredFocus={preferred} onPress={() => {}} style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
