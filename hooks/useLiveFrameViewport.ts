import { setLiveFramesActive, setLiveFrameViewable, type LiveFrameSurface } from "@/services/liveFrames";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, type ViewabilityConfig, type ViewToken } from "react-native";

/**
 * Held a beat, so a fling past a row never asks for its frame. On a phone any visible pixel counts; on TV only a
 * row wholly on screen, so the rows a scroll leaves half shown wait their turn until they are in full view.
 */
export const LIVE_FRAME_VIEWABILITY = Platform.isTV ? { itemVisiblePercentThreshold: 100, minimumViewTime: 300 } : { viewAreaCoveragePercentThreshold: 0, minimumViewTime: 300 };
/** TV only: a row at least this much on screen is read once the whole rows have their clips; its clip stays paused. */
export const LIVE_FRAME_PART_VIEWABILITY = { itemVisiblePercentThreshold: 15, minimumViewTime: 300 };
/** Phone and Mac: the rows wholly on screen, read before a sliver row and the row read ahead. */
export const LIVE_FRAME_FULL_VIEWABILITY = { itemVisiblePercentThreshold: 100, minimumViewTime: 300 };
/** A card plays its clip while at least this much of its row is on screen, past the top edge or the bottom. */
export const LIVE_CLIP_VIEWABILITY = { itemVisiblePercentThreshold: 10, minimumViewTime: 300 };

/** The channels in the rows in view, in order, plus the row below the last one on a phone; on TV the rows in view alone. */
export function viewportChannelIds<T>(viewableItems: ViewToken<T>[], items: readonly T[], idsOf: (item: T) => string[], lookahead = !Platform.isTV): string[] {
  const ids = viewableItems.filter((token) => token.isViewable && token.index !== null).flatMap((token) => idsOf(token.item));
  const last = viewableItems.reduce((max, token) => Math.max(max, token.index ?? -1), -1);
  const next = lookahead && last >= 0 ? items[last + 1] : undefined;
  return next ? ids.concat(idsOf(next)) : ids;
}

/** The rows only partly on screen: those past the part threshold that are not wholly on screen. */
export function partlyShownChannelIds<T>(wholeItems: ViewToken<T>[], partItems: ViewToken<T>[], items: readonly T[], idsOf: (item: T) => string[]): string[] {
  const whole = new Set(viewportChannelIds(wholeItems, items, idsOf));
  return viewportChannelIds(partItems, items, idsOf, false).filter((channelId) => !whole.has(channelId));
}

export interface LiveFrameViewabilityPair<T> {
  viewabilityConfig: ViewabilityConfig;
  onViewableItemsChanged: (info: { viewableItems: ViewToken<T>[] }) => void;
}

/**
 * A list of channel rows feeding the live frame sampler as its surface: active while its screen
 * is on top and the setting allows, its rows in view reported as they change. The rows are
 * reported even while disabled, since a list only re-reports on a scroll: turning the setting on
 * activates the surface with the rows already in view. A list keeps the first viewability
 * pairs it is given, so the rows and the mapper reach them through refs.
 */
export function useLiveFrameViewport<T>(surface: LiveFrameSurface, enabled: boolean, items: readonly T[], idsOf: (item: T) => string[]) {
  const isScreenFocused = useIsFocused();
  const [visibleChannelIds, setVisibleChannelIds] = useState<ReadonlySet<string>>(() => new Set());
  const itemsRef = useRef(items);
  const idsOfRef = useRef(idsOf);
  const wholeRef = useRef<ViewToken<T>[]>([]);
  const partRef = useRef<ViewToken<T>[]>([]);
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
  const report = useCallback(() => {
    if (Platform.isTV) {
      const whole = viewportChannelIds(wholeRef.current, itemsRef.current, idsOfRef.current);
      setLiveFrameViewable(surface, whole, partlyShownChannelIds(wholeRef.current, partRef.current, itemsRef.current, idsOfRef.current));
      return;
    }
    // Phone and Mac: the part pair holds the rows wholly on screen; any visible pixel and the row after them read behind.
    const full = viewportChannelIds(partRef.current, itemsRef.current, idsOfRef.current, false);
    const fullIds = new Set(full);
    setLiveFrameViewable(
      surface,
      full,
      viewportChannelIds(wholeRef.current, itemsRef.current, idsOfRef.current).filter((channelId) => !fullIds.has(channelId)),
    );
  }, [surface]);
  // Stable for the list's life: a list refuses new viewability pairs once mounted.
  const viewabilityPairs = useMemo<LiveFrameViewabilityPair<T>[]>(() => {
    const whole: LiveFrameViewabilityPair<T> = {
      viewabilityConfig: LIVE_FRAME_VIEWABILITY,
      onViewableItemsChanged: ({ viewableItems }) => {
        wholeRef.current = viewableItems;
        report();
      },
    };
    const part: LiveFrameViewabilityPair<T> = {
      viewabilityConfig: Platform.isTV ? LIVE_FRAME_PART_VIEWABILITY : LIVE_FRAME_FULL_VIEWABILITY,
      onViewableItemsChanged: ({ viewableItems }) => {
        partRef.current = viewableItems;
        report();
      },
    };
    // Lookahead warms frames only; mounted rows outside the viewport must not own players.
    const clip: LiveFrameViewabilityPair<T> = {
      viewabilityConfig: LIVE_CLIP_VIEWABILITY,
      onViewableItemsChanged: ({ viewableItems }) => {
        setVisibleChannelIds(new Set(viewableItems.filter((token) => token.isViewable).flatMap((token) => idsOfRef.current(token.item))));
      },
    };
    return [whole, part, clip];
  }, [report]);
  return { viewabilityPairs, visibleChannelIds: isScreenFocused ? visibleChannelIds : EMPTY_CHANNEL_IDS };
}

const EMPTY_CHANNEL_IDS: ReadonlySet<string> = new Set();
