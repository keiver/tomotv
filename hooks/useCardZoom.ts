import { cardZoomCeiling } from "@/constants/app";
import { getCardZoom, subscribeCardZoom } from "@/services/cardZoom";
import { clampCardZoom } from "@/utils/cardZoom";
import { useMemo, useSyncExternalStore } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** The largest card zoom this window takes; 1 on TV, where nothing pinches. */
export function useCardZoomCeiling(): number {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useMemo(() => (IS_TV ? 1 : cardZoomCeiling(width, height, insets.left, insets.right)), [width, height, insets.left, insets.right]);
}

/** The card zoom to draw at: the saved size on TV; elsewhere the saved size or the pinch's choice, clamped to this window. */
export function useCardZoom(): number {
  const stored = useSyncExternalStore(subscribeCardZoom, getCardZoom);
  const ceiling = useCardZoomCeiling();
  return IS_TV ? stored : clampCardZoom(stored, ceiling);
}
