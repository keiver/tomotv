import { MultiviewEmptySpot } from "@/components/live-tv/multiview-empty-spot";
import { MultiviewTile } from "@/components/live-tv/multiview-tile";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useChannelWall } from "@/hooks/useChannelWall";
import { useItemLongPress } from "@/hooks/useItemLongPress";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { t } from "@/services/i18n";
import type { StringKey } from "@/services/i18n/strings";
import { fetchChannelWindow } from "@/services/jellyfinApi";
import { setLiveFramesActive, setLiveFrameViewable } from "@/services/liveFrames";
import { liveTilesVersion, liveTileUnavailable, liveTileUrl, noteLiveTileFailed, setLiveTiles, subscribeLiveTiles } from "@/services/liveTiles";
import { updateLiveTvPreferences, type MultiviewArrangement } from "@/services/liveTvPreferences";
import type { JellyfinItem } from "@/types/jellyfin";
import { programTimes } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { clearSpot, dueQueue, liveOrder, placeChannel, promoteSpot, resizeArrangement, seedArrangement } from "@/utils/multiviewArrangement";
import { MULTIVIEW_ASPECT, MULTIVIEW_LAYOUTS, multiviewChannels, multiviewFeatured, multiviewSpots, multiviewSpotsBottom, type MultiviewLayoutName } from "@keiver/tomo-live";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useRouter, type NativeStackNavigationOptions } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Platform, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

const IS_TV = Platform.isTV;
/** The line between channels. */
const GAP = 2;
/** The channel strip's card height. */
const STRIP_HEIGHT = IS_TV ? 200 : 90;
const STRIP_WIDTH = STRIP_HEIGHT * MULTIVIEW_ASPECT;
/** Channels the strip offers past the spots. */
const STRIP_LIMIT = 30;
const CLOCK_MS = 30_000;
const LAYOUT_LABEL: Record<MultiviewLayoutName, StringKey> = {
  two: "liveTv.layoutTwo",
  twoFeatured: "liveTv.layoutTwoFeatured",
  onePlusTwo: "liveTv.layoutOnePlusTwo",
  onePlusThree: "liveTv.layoutOnePlusThree",
  grid4: "liveTv.layoutGrid4",
};

/**
 * Multiview: a fixed layout of up to four spots, the one with the sound the large one in a featured layout, the
 * viewer's arrangement kept per user. Under it, a strip of the group's other channels as clips, which open no stream.
 */
export default function MultiviewScreen() {
  const router = useRouter();
  const { channelId, channelName } = useLocalSearchParams<{ channelId?: string; channelName?: string }>();
  const preferences = useLiveTvPreferences();
  const arrangement = preferences.multiview;
  const { wall } = useChannelWall(preferences);
  const isFocused = useIsFocused();
  const headerHeight = useHeaderHeight();
  const openInfoPanel = useItemLongPress();
  const version = useSyncExternalStore(subscribeLiveTiles, liveTilesVersion);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);
  const [soundAt, setSoundAt] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  const ids = useMemo(() => wall.map((channel) => channel.Id), [wall]);
  const save = useCallback((next: MultiviewArrangement) => updateLiveTvPreferences({ multiview: next }), []);

  // Opened on a channel: it takes the big spot, the rest around it. Opened bare: the stored arrangement, else the group's first channel.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || ids.length === 0) return;
    seeded.current = true;
    const list = channelId && !ids.includes(channelId) ? [channelId, ...ids] : ids;
    const main = channelId ?? (arrangement.spots.some(Boolean) ? null : ids.find((id) => !liveTileUnavailable(id)));
    if (main) save(seedArrangement(arrangement.layout, list, main, liveTileUnavailable, arrangement.strip));
  }, [ids, channelId, arrangement, save]);

  // The spots' channels with the programme airing, re-read when one ends.
  const spotIds = useMemo(() => arrangement.spots.filter((id): id is string => !!id), [arrangement.spots]);
  const [airing, setAiring] = useState<Map<string, JellyfinItem>>(new Map());
  const spotKey = spotIds.join(",");
  const stale = spotIds.some((id) => {
    const program = airing.get(id)?.CurrentProgram;
    return !program || programTimes(program).endMs <= nowMs;
  });
  useEffect(() => {
    if (spotKey === "" || !stale) return;
    let current = true;
    fetchChannelWindow(spotKey.split(","))
      .then((items) => {
        if (current) setAiring(new Map(items.map((item) => [item.Id, item])));
      })
      .catch((error) => logger.warn("Multiview programmes unread", error, { screen: "Multiview" }));
    return () => {
      current = false;
    };
    // nowMs moves the check each half minute; stale says whether a read is due.
  }, [spotKey, stale]);
  const byId = useMemo(() => {
    const map = new Map<string, JellyfinItem>(wall.map((channel) => [channel.Id, channel]));
    for (const [id, item] of airing) map.set(id, { ...map.get(id), ...item });
    if (channelId && !map.has(channelId)) map.set(channelId, { Id: channelId, Name: channelName ?? "", Type: "TvChannel" } as JellyfinItem);
    return map;
  }, [wall, airing, channelId, channelName]);

  // The sessions follow the spots; the sound spot is the main.
  const sound = Math.min(soundAt, Math.max(0, arrangement.spots.length - 1));
  useEffect(() => {
    setLiveTiles(liveOrder(arrangement, sound), { chosen: arrangement.chosen });
  }, [arrangement, sound]);
  useEffect(() => () => setLiveTiles([]), []);

  // A queued programme that airs now takes the sound spot, while Multiview is open.
  const queue = preferences.multiviewQueue;
  useEffect(() => {
    const { due, rest, nextAt } = dueQueue(queue, nowMs);
    if (due.length > 0) {
      let next = arrangement;
      for (const entry of due) next = placeChannel(next, sound, entry.channelId);
      updateLiveTvPreferences({ multiview: next, multiviewQueue: rest });
      return;
    }
    if (nextAt === null) return;
    const timer = setTimeout(() => setNowMs(Date.now()), Math.max(0, nextAt - Date.now()));
    return () => clearTimeout(timer);
  }, [queue, nowMs, arrangement, sound]);

  // The spot with the sound fills the screen in place, its own player playing on, under /multiview-full, which holds
  // focus so Menu returns here; back here, the layout returns.
  const [fullAsked, setFullAsked] = useState(false);
  const full = fullAsked && !!arrangement.spots[sound];
  useFocusEffect(useCallback(() => setFullAsked(false), []));
  const pick = useCallback((index: number) => router.push({ pathname: "/multiview-pick", params: { spot: String(index) } }), [router]);
  const select = useCallback(
    (index: number) => {
      const id = arrangement.spots[index];
      if (!id) return pick(index);
      if (index === sound) {
        setFullAsked(true);
        router.push("/multiview-full");
        return;
      }
      const promoted = promoteSpot(arrangement, index);
      if (promoted.arrangement !== arrangement) save(promoted.arrangement);
      setSoundAt(promoted.soundAt);
    },
    [arrangement, sound, pick, save, router],
  );
  const changeLayout = useCallback(
    (layout: MultiviewLayoutName) => {
      const main = arrangement.spots[sound];
      const fresh = main ? multiviewChannels(ids, main, 4, liveTileUnavailable) : ids.filter((id) => !liveTileUnavailable(id));
      save(resizeArrangement(arrangement, layout, fresh));
      setSoundAt(0);
    },
    [arrangement, sound, ids, save],
  );
  const layoutSheet = useCallback(() => {
    Alert.alert(t("liveTv.multiviewLayout"), undefined, [
      ...MULTIVIEW_LAYOUTS.map((layout) => ({ text: t(LAYOUT_LABEL[layout]), onPress: () => changeLayout(layout) })),
      { text: t(arrangement.strip ? "liveTv.multiviewStripHide" : "liveTv.multiviewStripShow"), onPress: () => save({ ...arrangement, strip: !arrangement.strip }) },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }, [arrangement, changeLayout, save]);
  const spotSheet = useCallback(
    (index: number) => {
      const channel = byId.get(arrangement.spots[index] ?? "");
      if (!channel) return;
      Alert.alert(channel.Name ?? "", undefined, [
        { text: t("liveTv.multiviewChange"), onPress: () => pick(index) },
        { text: t("liveTv.multiviewClear"), onPress: () => save(clearSpot(arrangement, index)) },
        { text: t("liveTv.record"), onPress: () => openInfoPanel(channel) },
        { text: t("liveTv.multiviewLayout"), onPress: layoutSheet },
        { text: t("common.cancel"), style: "cancel" },
      ]);
    },
    [arrangement, byId, pick, save, openInfoPanel, layoutSheet],
  );
  // Phone, iPad and Mac: the layout sheet also sits in the native bar; Apple TV reaches it from a spot's long press.
  const { accent } = useCardPalette();
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () =>
      IS_TV
        ? {}
        : {
            headerShown: !full,
            unstable_headerRightItems: () => [
              { type: "button" as const, label: t("liveTv.multiviewLayout"), icon: { type: "sfSymbol" as const, name: "rectangle.split.2x2" as const }, tintColor: accent, onPress: layoutSheet },
            ],
          },
    [accent, layoutSheet, full],
  );
  // The strip: the group's other channels, the sampler reading those in view.
  const stripIds = useMemo(() => ids.filter((id) => !arrangement.spots.includes(id)).slice(0, STRIP_LIMIT), [ids, arrangement.spots]);
  const stripShown = !full && arrangement.strip && stripIds.length > 0;
  const stage = size ? { width: size.width, height: size.height - (stripShown ? STRIP_HEIGHT + GAP : 0), gap: GAP } : null;
  const rects = stage ? multiviewSpots(arrangement.layout, stage) : [];
  // A whole number of strip cards spans the first spot exactly, so the strip's lines meet the spots' lines.
  const lead = rects[0]?.width ?? 0;
  const perLead = Math.max(1, Math.round((lead + GAP) / (STRIP_WIDTH + GAP)));
  const stripCard = lead > 0 ? (lead - (perLead - 1) * GAP) / perLead : STRIP_WIDTH;
  const stripStep = stripCard + GAP;
  const [stripFrom, setStripFrom] = useState(0);
  const onStripScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => setStripFrom(Math.max(0, Math.floor(event.nativeEvent.contentOffset.x / stripStep))), [stripStep]);
  const stripVisible = useMemo(() => (stripShown && size ? stripIds.slice(stripFrom, stripFrom + Math.ceil(size.width / stripStep) + 1) : []), [stripShown, size, stripIds, stripFrom, stripStep]);
  const toSound = useCallback((id: string) => save(placeChannel(arrangement, sound, id)), [arrangement, sound, save]);

  const autoUpdate = preferences.autoUpdate;
  useEffect(() => {
    if (!autoUpdate) return;
    setLiveFramesActive("multiview", isFocused);
    return () => setLiveFramesActive("multiview", false);
  }, [autoUpdate, isFocused]);
  useEffect(() => {
    const spots = full ? [] : arrangement.spots.filter((id, index): id is string => !!id && index !== sound && !liveTileUrl(id));
    setLiveFrameViewable("multiview", [...spots, ...stripVisible]);
  }, [arrangement.spots, sound, stripVisible, version, full]);
  useEffect(() => () => setLiveFrameViewable("multiview", []), []);

  const stripTop = multiviewSpotsBottom(rects, GAP) + GAP / 2;
  const featured = multiviewFeatured(arrangement.layout);
  return (
    <View style={[styles.container, { paddingTop: IS_TV || full ? 0 : headerHeight }]}>
      <Stack.Screen options={screenOptions} />
      <View style={styles.stage} onLayout={onLayout}>
        {rects.map((spotRect, index) => {
          // Full: only the spot with the sound, at the stage's size; the others keep their sessions off screen.
          if (full && index !== sound) return null;
          const rect = full && size ? { x: 0, y: 0, width: size.width, height: size.height } : spotRect;
          const id = arrangement.spots[index];
          const channel = id ? byId.get(id) : undefined;
          if (!id) return <MultiviewEmptySpot key={`empty-${index}`} rect={rect} onPress={() => pick(index)} />;
          if (!channel) return null;
          return (
            <MultiviewTile
              key={id}
              channel={channel}
              rect={rect}
              main={index === sound}
              liveUrl={liveTileUrl(id)}
              visible={isFocused || full}
              bare={full}
              program={channel.CurrentProgram}
              nowMs={nowMs}
              hasTVPreferredFocus={featured ? index === 0 : index === sound}
              onSelect={() => select(index)}
              onFailed={noteLiveTileFailed}
              onLongPress={() => spotSheet(index)}
            />
          );
        })}
        {stripShown && rects.length > 0 ? (
          <ScrollView
            horizontal
            style={[styles.strip, { top: stripTop, height: STRIP_HEIGHT }]}
            contentContainerStyle={{ width: stripIds.length * stripStep - GAP, height: STRIP_HEIGHT }}
            onScroll={onStripScroll}
            scrollEventThrottle={250}
            showsHorizontalScrollIndicator={false}>
            {stripIds.map((id, index) => {
              const channel = byId.get(id);
              if (!channel) return null;
              return (
                <MultiviewTile
                  key={id}
                  channel={channel}
                  rect={{ x: index * stripStep, y: 0, width: stripCard, height: STRIP_HEIGHT }}
                  main={false}
                  liveUrl={null}
                  visible={isFocused}
                  program={channel.CurrentProgram}
                  nowMs={nowMs}
                  onSelect={toSound}
                  onFailed={noteLiveTileFailed}
                />
              );
            })}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND_DEEP,
  },
  stage: {
    flex: 1,
  },
  strip: {
    position: "absolute",
    left: 0,
    right: 0,
  },
});
