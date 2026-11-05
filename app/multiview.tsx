import { MultiviewEmptySpot } from "@/components/live-tv/multiview-empty-spot";
import { MultiviewTile } from "@/components/live-tv/multiview-tile";
import { COLORS } from "@/constants/colors";
import { PinnedCornerButtons } from "@/components/live-tv/pinned-corner-buttons";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useChannelWall } from "@/hooks/useChannelWall";
import { useItemLongPress } from "@/hooks/useItemLongPress";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { useMultiviewPlayer } from "@/hooks/useMultiviewPlayer";
import { usePinnedRecordButton } from "@/hooks/usePinnedRecordButton";
import { t } from "@/services/i18n";
import { fetchChannelWindow } from "@/services/jellyfinApi";
import { setLiveFramesActive, setLiveFrameViewable } from "@/services/liveFrames";
import { liveTileFailed, liveTilesVersion, liveTileUnavailable, liveTileUrl, noteLiveTileFailed, setLiveTiles, subscribeLiveTiles } from "@/services/liveTiles";
import { updateLiveTvPreferences, type MultiviewArrangement } from "@/services/liveTvPreferences";
import type { JellyfinItem } from "@/types/jellyfin";
import { programTimes } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { clearSpot, dueQueue, liveOrder, placeChannel, placeDue, promoteSpot, seedArrangement } from "@/utils/multiviewArrangement";
import {
  MULTIVIEW_ASPECT,
  multiviewCut,
  multiviewFeatured,
  multiviewFit,
  multiviewGroupCard,
  multiviewGroupCount,
  multiviewGroupRows,
  multiviewLiveCount,
  multiviewSpots,
  multiviewStripCard,
  type MultiviewRect,
} from "@keiver/tomo-live";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useRouter, type NativeStackNavigationOptions } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Platform, ScrollView, StyleSheet, useTVEventHandler, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
/** The line between channels. */
const GAP = 2;
/** Channels the strip offers past the spots. */
const STRIP_LIMIT = 30;
const CLOCK_MS = 30_000;
/** The buttons over the spot with the sound, from its top and right edges. */
const ACTIONS_INSET = { top: 12, right: 12 };
const ignore = () => {};

/**
 * Multiview: a fixed layout of whole 16:9 spots, its live spots first, then the viewer's picture spots, and in most
 * layouts a row where the group's other channels scroll as clips. The arrangement is kept per user.
 */
export default function MultiviewScreen() {
  const router = useRouter();
  const { channelId, channelName } = useLocalSearchParams<{ channelId?: string; channelName?: string }>();
  const preferences = useLiveTvPreferences();
  const arrangement = preferences.multiview;
  const { wall } = useChannelWall(preferences);
  const isFocused = useIsFocused();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const openInfoPanel = useItemLongPress();
  const version = useSyncExternalStore(subscribeLiveTiles, liveTilesVersion);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);
  // The spot with the sound, for the layout it was picked in; another layout starts at its first spot.
  const [soundPick, setSoundPick] = useState({ layout: arrangement.layout, at: 0 });
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
    if (main) save(seedArrangement(arrangement.layout, list, main, liveTileUnavailable));
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

  // The sessions follow the live spots; the sound spot is the main.
  const liveCount = multiviewLiveCount(arrangement.layout);
  const sound = soundPick.layout === arrangement.layout ? Math.min(soundPick.at, liveCount - 1) : 0;
  const setSoundAt = useCallback((at: number) => setSoundPick({ layout: arrangement.layout, at }), [arrangement.layout]);
  useEffect(() => {
    setLiveTiles(liveOrder(arrangement, sound), { chosen: arrangement.chosen, mainInPlayer: !IS_TV });
  }, [arrangement, sound]);
  useEffect(() => () => setLiveTiles([]), []);

  // iPhone, iPad and Mac: the app's player plays the spot with the sound inline, as the guide's pinned channel, so a
  // press presents that same player full screen. Apple TV keeps the spot's own player.
  const soundId = arrangement.spots[sound] ?? null;
  const soundChannel = (soundId && byId.get(soundId)) || null;
  const player = useMultiviewPlayer(IS_TV ? null : soundChannel, isFocused);
  const { recordButton } = usePinnedRecordButton({
    channel: IS_TV ? null : soundChannel,
    program: soundChannel?.CurrentProgram,
    nowMs,
    playsRecording: false,
    onRecordStart: ignore,
    onRecordSettled: ignore,
  });

  // Queued programmes that air now take spots, the latest start the sound spot, while Multiview is open.
  const queue = preferences.multiviewQueue;
  useEffect(() => {
    const { due, rest, nextAt } = dueQueue(queue, nowMs);
    if (due.length > 0) {
      updateLiveTvPreferences({ multiview: placeDue(arrangement, sound, due), multiviewQueue: rest });
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
  const openLayouts = useCallback(() => router.push("/multiview-layout"), [router]);
  // Apple TV: the spot fills the screen in place. iPhone, iPad and Mac: the same player goes to AVKit's presented player.
  const { open: presentSound } = player;
  const openFull = useCallback(() => {
    if (Platform.isTV) {
      setFullAsked(true);
      router.push("/multiview-full");
      return;
    }
    presentSound();
  }, [router, presentSound]);
  const select = useCallback(
    (index: number) => {
      const id = arrangement.spots[index];
      if (!id) return pick(index);
      if (index === sound) return openFull();
      const promoted = promoteSpot(arrangement, index, sound);
      if (promoted.arrangement !== arrangement) save(promoted.arrangement);
      setSoundAt(promoted.soundAt);
    },
    [arrangement, sound, pick, save, openFull, setSoundAt],
  );
  const spotSheet = useCallback(
    (index: number) => {
      const channel = byId.get(arrangement.spots[index] ?? "");
      if (!channel) return;
      Alert.alert(channel.Name ?? "", undefined, [
        { text: t("liveTv.multiviewChange"), onPress: () => pick(index) },
        { text: t("liveTv.multiviewClear"), onPress: () => save(clearSpot(arrangement, index)) },
        { text: t("liveTv.record"), onPress: () => openInfoPanel(channel) },
        { text: t("liveTv.multiviewLayout"), onPress: openLayouts },
        { text: t("common.cancel"), style: "cancel" },
      ]);
    },
    [arrangement, byId, pick, save, openInfoPanel, openLayouts],
  );
  // Phone, iPad and Mac: the layouts open from the native bar; Apple TV opens them with Play/Pause.
  const { accent } = useCardPalette();
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () =>
      IS_TV
        ? {}
        : {
            headerShown: !full,
            unstable_headerRightItems: () => [
              { type: "button" as const, label: t("liveTv.multiviewLayout"), icon: { type: "sfSymbol" as const, name: "rectangle.split.2x2" as const }, tintColor: accent, onPress: openLayouts },
            ],
          },
    [accent, openLayouts, full],
  );
  useTVEventHandler((event) => {
    if (isFocused && event.eventType === "playPause") openLayouts();
  });

  // Apple TV: the 16:9 cut with its strip row. Elsewhere: the cut fit to the screen's shape, the group below or beside.
  const placement = IS_TV && size ? multiviewSpots(arrangement.layout, { width: size.width, height: size.height, gap: GAP }) : null;
  const fit = !IS_TV && size ? multiviewFit(arrangement.layout, { width: size.width, height: size.height, gap: GAP }) : null;
  const grid = multiviewCut(arrangement.layout).grid;
  // The group's other channels, the sampler reading those in view.
  const stripIds = useMemo(() => ids.filter((id) => !arrangement.spots.includes(id)).slice(0, STRIP_LIMIT), [ids, arrangement.spots]);
  const strip = !full && placement?.strip ? placement.strip : null;
  const cell = placement?.cell ?? 0;
  const [stripFrom, setStripFrom] = useState(0);
  const onStripScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => setStripFrom(cell > 0 ? Math.max(0, Math.floor(event.nativeEvent.contentOffset.x / cell)) : 0);
  const [stageY, setStageY] = useState(0);
  const onStageScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => setStageY(event.nativeEvent.contentOffset.y);
  // While the stage moves, the player parks, still playing, and the spot shows its picture until the scroll stops.
  const [scrolling, setScrolling] = useState(false);
  const onStageDragEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onStageScroll(event);
    if (!event.nativeEvent.velocity?.y) setScrolling(false);
  };
  const onStageMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onStageScroll(event);
    setScrolling(false);
  };
  // The stage's top-left corner in the window, where the player's frame is measured from.
  const containerRef = useRef<View>(null);
  const [stageOrigin, setStageOrigin] = useState<{ x: number; y: number } | null>(null);
  const measureStage = useCallback(() => {
    containerRef.current?.measureInWindow((x, y) => setStageOrigin((prev) => (prev && prev.x === x + insets.left && prev.y === y + headerHeight ? prev : { x: x + insets.left, y: y + headerHeight })));
  }, [insets.left, headerHeight]);
  useEffect(() => {
    if (!IS_TV && isFocused) measureStage();
  }, [isFocused, measureStage, size]);
  const soundRect = fit?.spots[sound] ?? null;
  const { setSlot } = player;
  const slot =
    !IS_TV && isFocused && !scrolling && soundRect && stageOrigin && soundId
      ? { x: stageOrigin.x + soundRect.x, y: stageOrigin.y + soundRect.y - stageY, width: soundRect.width, height: soundRect.height }
      : null;
  const slotKey = slot ? `${slot.x},${slot.y},${slot.width},${slot.height}` : "";
  useEffect(() => {
    if (IS_TV) return;
    const [x, y, width, height] = slotKey ? slotKey.split(",").map(Number) : [];
    setSlot(slotKey ? { x, y, width, height } : null);
  }, [slotKey, setSlot]);
  const group = !full && fit ? fit.group : null;
  const groupCardHeight = group ? group.width / group.columns / MULTIVIEW_ASPECT : 0;
  const groupFrom = group && groupCardHeight > 0 ? multiviewGroupCount(group, Math.max(0, Math.floor((stageY - group.y) / groupCardHeight))) : 0;
  const groupTo = group && groupCardHeight > 0 && size ? multiviewGroupCount(group, Math.floor((stageY - group.y + size.height) / groupCardHeight) + 1) : 0;
  const stripVisible = strip && cell > 0 ? stripIds.slice(stripFrom, stripFrom + Math.ceil(strip.width / cell) + 1) : group ? stripIds.slice(groupFrom, groupTo) : [];
  const stripKey = stripVisible.join(",");
  const toSound = useCallback((id: string) => save(placeChannel(arrangement, sound, id)), [arrangement, sound, save]);

  const autoUpdate = preferences.autoUpdate;
  useEffect(() => {
    if (!autoUpdate) return;
    setLiveFramesActive("multiview", isFocused);
    return () => setLiveFramesActive("multiview", false);
  }, [autoUpdate, isFocused]);
  useEffect(() => {
    const spots = full ? [] : arrangement.spots.filter((id, index): id is string => !!id && index !== sound && !liveTileUrl(id));
    setLiveFrameViewable("multiview", [...spots, ...(stripKey ? stripKey.split(",") : [])]);
  }, [arrangement.spots, sound, stripKey, version, full]);
  useEffect(() => () => setLiveFrameViewable("multiview", []), []);

  // The spot's label, ring and buttons, drawn by the player host over the inline picture, which covers the tile.
  const { setOverlay, muted, toggleMute } = player;
  const soundWidth = soundRect?.width ?? 0;
  const soundHeight = soundRect?.height ?? 0;
  // Only while this screen shows: another screen's inline session draws its own copy.
  useEffect(() => {
    if (!isFocused) return;
    setOverlay(
      IS_TV || !soundChannel || soundWidth === 0 ? null : (
        <MultiviewTile
          channel={soundChannel}
          rect={{ x: 0, y: 0, width: soundWidth, height: soundHeight }}
          main
          liveUrl={null}
          visible
          program={soundChannel.CurrentProgram}
          nowMs={nowMs}
          onSelect={() => select(sound)}
          onFailed={ignore}
          onLongPress={() => spotSheet(sound)}
          overlay={{ actions: <PinnedCornerButtons accent={accent} muted={muted} onToggleMute={toggleMute} record={recordButton} inset={ACTIONS_INSET} /> }}
        />
      ),
    );
  }, [isFocused, setOverlay, soundChannel, soundWidth, soundHeight, nowMs, select, sound, spotSheet, accent, muted, toggleMute, recordButton]);

  const featured = multiviewFeatured(arrangement.layout);
  const lastCard = stripIds.length > 0 ? multiviewStripCard(stripIds.length - 1, grid, cell, GAP) : null;
  const groupTile = (id: string, rect: MultiviewRect) => {
    const channel = byId.get(id);
    if (!channel) return null;
    return (
      <MultiviewTile
        key={id}
        channel={channel}
        rect={rect}
        main={false}
        liveUrl={null}
        visible={isFocused}
        program={channel.CurrentProgram}
        nowMs={nowMs}
        onSelect={toSound}
        onFailed={noteLiveTileFailed}
      />
    );
  };
  const stageHeight = group && size ? Math.max(size.height, group.y + multiviewGroupRows(group, stripIds.length) * groupCardHeight) : (size?.height ?? 0);
  const Stage = IS_TV ? View : ScrollView;
  const stageProps = IS_TV
    ? {}
    : {
        scrollEnabled: !full,
        contentContainerStyle: { height: stageHeight },
        onScroll: onStageScroll,
        onScrollBeginDrag: () => setScrolling(true),
        onScrollEndDrag: onStageDragEnd,
        onMomentumScrollEnd: onStageMomentumEnd,
        scrollEventThrottle: 250,
        showsVerticalScrollIndicator: false,
      };
  return (
    <View
      ref={containerRef}
      onLayout={IS_TV ? undefined : measureStage}
      style={[styles.container, IS_TV ? null : { paddingTop: full ? 0 : headerHeight, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <Stack.Screen options={screenOptions} />
      <Stage style={styles.stage} onLayout={onLayout} {...stageProps}>
        {(placement?.spots ?? fit?.spots ?? []).map((spotRect, index) => {
          // Full: only the spot with the sound, at the stage's size where the stage stands; the others keep their sessions off screen.
          if (full && index !== sound) return null;
          const rect = full && size ? { x: 0, y: IS_TV ? 0 : stageY, width: size.width, height: size.height } : spotRect;
          const id = arrangement.spots[index];
          const channel = id ? byId.get(id) : undefined;
          if (!id) return <MultiviewEmptySpot key={`empty-${index}`} rect={rect} onPress={() => pick(index)} />;
          if (!channel) return null;
          const inPlayer = !IS_TV && index === sound;
          return (
            <MultiviewTile
              key={id}
              channel={channel}
              rect={rect}
              main={index === sound}
              liveUrl={index < liveCount && !inPlayer ? liveTileUrl(id) : null}
              inPlayer={inPlayer ? { playing: player.playing } : undefined}
              failed={index === sound && (inPlayer ? player.failed : liveTileFailed(id))}
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
        {strip && lastCard ? (
          <ScrollView
            horizontal
            style={[styles.strip, { left: strip.x, top: strip.y, width: strip.width, height: strip.height }]}
            contentContainerStyle={{ width: lastCard.x + lastCard.width, height: strip.height }}
            onScroll={onStripScroll}
            scrollEventThrottle={250}
            showsHorizontalScrollIndicator={false}>
            {stripIds.map((id, index) => {
              const card = multiviewStripCard(index, grid, cell, GAP);
              return groupTile(id, { x: card.x, y: 0, width: card.width, height: strip.height });
            })}
          </ScrollView>
        ) : null}
        {group
          ? stripIds.map((id, index) => {
              const card = multiviewGroupCard(index, group, GAP);
              return groupTile(id, { ...card, x: group.x + card.x, y: group.y + card.y });
            })
          : null}
      </Stage>
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
  },
});
