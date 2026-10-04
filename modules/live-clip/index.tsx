import { requireNativeViewManager } from "expo-modules-core";
import React from "react";
import { type StyleProp, type ViewStyle } from "react-native";

interface LiveClipViewProps {
  /** A local video-only file; it loops muted, a newer one taking over at the next seam. */
  uri: string;
  style?: StyleProp<ViewStyle>;
}

const NativeView = requireNativeViewManager<LiveClipViewProps & { pointerEvents?: "none" }>("LiveClip");

export function LiveClipView({ uri, style }: LiveClipViewProps) {
  return <NativeView uri={uri} style={style} pointerEvents="none" />;
}
