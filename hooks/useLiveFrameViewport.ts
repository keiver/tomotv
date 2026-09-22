import { setLiveFramesActive, setLiveFrameViewable, type LiveFrameSurface } from "@/services/liveFrames";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import type { ViewToken } from "react-native";

/** Any visible pixel counts, held a beat so a fling past a row never asks for its frame. */
export const LIVE_FRAME_VIEWABILITY = { viewAreaCoveragePercentThreshold: 0, minimumViewTime: 300 };

/** The channels in the rows in view, in order, plus the row below the last one. */
export function viewportChannelIds<T>(viewableItems: ViewToken<T>[], items: readonly T[], idsOf: (item: T) => string[]): string[] {
  const ids = viewableItems.filter((token) => token.isViewable && token.index !== null).flatMap((token) => idsOf(token.item));
  const last = viewableItems.reduce((max, token) => Math.max(max, token.index ?? -1), -1);
  const lookahead = last >= 0 ? items[last + 1] : undefined;
  return lookahead ? ids.concat(idsOf(lookahead)) : ids;
}

/**
 * A list of channel rows feeding the live frame sampler as its surface: active while its screen
 * is on top and the setting allows, its rows in view reported as they change. The rows are
 * reported even while disabled, since a list only re-reports on a scroll: turning the setting on
 * activates the surface with the rows already in view. A list keeps the first viewability
 * callback it is given, so the rows and the mapper reach it through refs.
 */
export function useLiveFrameViewport<T>(surface: LiveFrameSurface, enabled: boolean, items: readonly T[], idsOf: (item: T) => string[]) {
  const isScreenFocused = useIsFocused();
  const itemsRef = useRef(items);
  const idsOfRef = useRef(idsOf);
  useEffect(() => {
    itemsRef.current = items;
    idsOfRef.current = idsOf;
  }, [items, idsOf]);
  useEffect(() => {
    if (!enabled) return;
    setLiveFramesActive(surface, isScreenFocused);
    return () => setLiveFramesActive(surface, false);
  }, [enabled, surface, isScreenFocused]);
  useEffect(() => () => setLiveFrameViewable(surface, []), [surface]);
  // Stable for the list's life: a list refuses a new viewability callback once mounted.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<T>[] }) => setLiveFrameViewable(surface, viewportChannelIds(viewableItems, itemsRef.current, idsOfRef.current)),
    [surface],
  );
  return { viewabilityConfig: LIVE_FRAME_VIEWABILITY, onViewableItemsChanged };
}
