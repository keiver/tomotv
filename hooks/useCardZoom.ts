import { cardZoomCeiling } from "@/constants/app";
import { getUiPreferences, subscribeUiPreferences } from "@/services/uiPreferences";
import { clampCardZoom } from "@/utils/cardZoom";
import { useMemo, useSyncExternalStore } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const storedZoom = () => getUiPreferences().cardZoom;

/** The largest card zoom this window takes; 1 on TV, where nothing pinches. */
export function useCardZoomCeiling(): number {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useMemo(() => (IS_TV ? 1 : cardZoomCeiling(width, height, insets.left, insets.right)), [width, height, insets.left, insets.right]);
}

/** The card zoom to draw at: the pinch's choice clamped to this window; always 1 on TV. */
export function useCardZoom(): number {
  const stored = useSyncExternalStore(subscribeUiPreferences, storedZoom);
  const ceiling = useCardZoomCeiling();
  return IS_TV ? 1 : clampCardZoom(stored, ceiling);
}
