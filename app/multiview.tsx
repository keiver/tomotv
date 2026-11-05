import { MultiviewTile } from "@/components/live-tv/multiview-tile";
import { COLORS } from "@/constants/colors";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { useChannelWall } from "@/hooks/useChannelWall";
import type { JellyfinItem } from "@/types/jellyfin";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { setLiveFramesActive, setLiveFrameViewable } from "@/services/liveFrames";
import { liveTileFrozen, liveTilesVersion, liveTileUnavailable, liveTileUrl, noteLiveTileFailed, noteLiveTileFrozen, pauseLiveTileMain, setLiveTiles, subscribeLiveTiles } from "@/services/liveTiles";
import { keepMultiviewOrder, multiviewCapacity, multiviewChannels, multiviewLayout, type MultiviewSpace } from "@keiver/tomo-live";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Platform, StyleSheet, useTVEventHandler, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
/** The narrowest a satellite is drawn, and the space between tiles. */
const MIN_TILE_WIDTH = IS_TV ? 384 : 160;
const TILE_GAP = IS_TV ? 24 : 8;

/**
 * Multiview: the chosen channel on the main stage with the sound, the channels around it in the picked group as
 * satellites. Selecting a satellite swaps it onto the main stage; selecting the main opens it full screen.
 */
export default function MultiviewScreen() {
  const router = useRouter();
  const { channelId, channelName } = useLocalSearchParams<{ channelId?: string; channelName?: string }>();
  const { showGlobalLoader } = useLoadingActions();
  const preferences = useLiveTvPreferences();
  const { wall } = useChannelWall(preferences);
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const version = useSyncExternalStore(subscribeLiveTiles, liveTilesVersion);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);
  const space = useMemo<MultiviewSpace | null>(() => (size ? { ...size, minTileWidth: MIN_TILE_WIDTH, gap: TILE_GAP } : null), [size]);
  const capacity = space ? multiviewCapacity(space) : 0;

  // A chosen channel the group's loaded list does not hold (another group, a later page) leads it, so it is still the main.
  const channels = useMemo(() => {
    if (!channelId || wall.some((channel) => channel.Id === channelId)) return wall;
    return [{ Id: channelId, Name: channelName ?? "", Type: "TvChannel" } as JellyfinItem, ...wall];
  }, [wall, channelId, channelName]);
  const ids = useMemo(() => channels.map((channel) => channel.Id), [channels]);
  const byId = useMemo(() => new Map(channels.map((channel) => [channel.Id, channel])), [channels]);
  // The viewer's arrangement once a satellite is swapped onto the main stage; until then, the tiles around the chosen channel.
  const [picked, setPicked] = useState<string[] | null>(null);
  const shown = useMemo(() => {
    if (capacity === 0 || ids.length === 0) return [];
    const main = picked?.[0] ?? (channelId && ids.includes(channelId) ? channelId : ids.find((id) => !liveTileUnavailable(id)));
    if (!main) return [];
    const fresh = multiviewChannels(ids, main, capacity, liveTileUnavailable);
    return keepMultiviewOrder(picked ?? fresh, fresh, capacity, (id) => id === main || (ids.includes(id) && !liveTileUnavailable(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version moves whenever a channel turns out unable to be a satellite
  }, [ids, capacity, channelId, picked, version]);

  // The tiles stay set while the player covers the screen: it takes the main's session, and hands it back.
  useEffect(() => {
    setLiveTiles(shown);
  }, [shown]);
  useEffect(() => () => setLiveTiles([]), []);

  // Tiles not playing live show the sampler's clip and picture; the main never asks for one.
  const autoUpdate = preferences.autoUpdate;
  useEffect(() => {
    if (!autoUpdate) return;
    setLiveFramesActive("multiview", isFocused);
    return () => setLiveFramesActive("multiview", false);
  }, [autoUpdate, isFocused]);
  useEffect(() => {
    setLiveFrameViewable(
      "multiview",
      shown.slice(1).filter((id) => !liveTileUrl(id)),
    );
  }, [shown, version]);
  useEffect(() => () => setLiveFrameViewable("multiview", []), []);

  const tune = useCallback(
    (id: string) => {
      showGlobalLoader();
      router.push({ pathname: "/player", params: { videoId: id, videoName: byId.get(id)?.Name, live: "1" } });
    },
    [router, showGlobalLoader, byId],
  );
  const select = useCallback(
    (id: string) => {
      if (id === shown[0]) {
        tune(id);
        return;
      }
      const at = shown.indexOf(id);
      if (at < 0) return;
      const next = [...shown];
      next[at] = shown[0];
      next[0] = id;
      setPicked(next);
    },
    [shown, tune],
  );
  const frozen = useCallback((id: string) => noteLiveTileFrozen(id), []);
  useTVEventHandler((event) => {
    if (isFocused && event.eventType === "playPause") pauseLiveTileMain();
  });

  const rects = space && shown.length > 0 ? multiviewLayout(shown.length, space) : null;
  return (
    <View style={[styles.container, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 8, paddingBottom: (IS_TV ? 40 : 8) + insets.bottom }]}>
      <View style={styles.stage} onLayout={onLayout}>
        {rects
          ? shown.map((id, index) => {
              const channel = byId.get(id);
              const rect = rects[index];
              if (!channel || !rect) return null;
              return (
                <MultiviewTile
                  key={id}
                  channel={channel}
                  rect={rect}
                  main={index === 0}
                  liveUrl={liveTileUrl(id)}
                  frozen={liveTileFrozen(id)}
                  visible={isFocused}
                  hasTVPreferredFocus={index === 0}
                  onSelect={select}
                  onFrozen={frozen}
                  onFailed={noteLiveTileFailed}
                  onLongPress={index === 0 ? pauseLiveTileMain : undefined}
                />
              );
            })
          : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND_DEEP,
    paddingHorizontal: IS_TV ? 80 : 8,
  },
  stage: {
    flex: 1,
  },
});
