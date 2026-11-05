import { requireNativeViewManager } from "expo-modules-core";
import React from "react";
import { type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";

interface LiveClipViewProps {
  /** A local video-only file; it loops muted, a newer one taking over at the next seam. A live tile's engine session URL. */
  uri: string | null;
  /** The uri is an engine session played as it is cut, never looped. */
  live?: boolean;
  /** A live tile plays with sound only when false. */
  muted?: boolean;
  /** A live tile holds its last frame; `onFrozen` says it does. */
  frozen?: boolean;
  onFrozen?: (event: NativeSyntheticEvent<{ held: boolean }>) => void;
  style?: StyleProp<ViewStyle>;
}

const NativeView = requireNativeViewManager<LiveClipViewProps & { pointerEvents?: "none" }>("LiveClip");

export function LiveClipView({ uri, live, muted, frozen, onFrozen, style }: LiveClipViewProps) {
  return <NativeView uri={uri} live={live} muted={muted} frozen={frozen} onFrozen={onFrozen} style={style} pointerEvents="none" />;
}
