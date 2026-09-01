import { GlassIconButton } from "@/components/glass-icon-button";
import React from "react";
import { type StyleProp, type ViewStyle } from "react-native";

interface CloseOverlayButtonProps {
  onPress: () => void;
  /** Placement (position/top/left/right) — the circle is GlassIconButton's. */
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

/**
 * Floating ✕ for the info panel, on the same material as the photo viewer's close and the mini
 * player's pill: it sits over the item's hero, which is the case the glass is for.
 * TV never renders it — the remote's Menu/back pops the screen natively.
 */
export function CloseOverlayButton({ onPress, style, accessibilityHint }: CloseOverlayButtonProps) {
  return <GlassIconButton icon="close" iconSize={26} style={style} onPress={onPress} accessibilityLabel="Close" accessibilityHint={accessibilityHint} />;
}
