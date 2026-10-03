import { COLORS } from "@/constants/colors";
import { liveFrameReel, subscribeLiveFrame } from "@/services/liveFrames";
import { pinOffset } from "@/components/live-tv/guide-pin";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { LayoutChangeEvent, Platform, Animated as RNAnimated, StyleSheet, useAnimatedValue, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

const IS_TV = Platform.isTV;
/** Per-tile offset of the focus brightening: the reel unrolls left to right. */
const STAGGER_MS = 55;
/** A resting reel is texture; the focused one is the subject. */
const REST_OPACITY = 0.35;
const ACTIVE_OPACITY = 0.92;
/** A strip longer than its cell runs out at the cell's edge, into the cell's own colour. */
const CUT_FADE = "linear-gradient(to right, rgba(28, 28, 30, 0) 0%, " + COLORS.SURFACE_SUNKEN + " 100%)";
const CUT_FADE_COMPACT = "linear-gradient(to right, rgba(44, 44, 46, 0) 0%, " + COLORS.SURFACE + " 100%)";
const PAD_LEFT = IS_TV ? 16 : 10;
const GAP = 2;
/** The stand-in's stair: each frame laps over the one before by a few pixels. */
const STAIR_OVERLAP = IS_TV ? 6 : 3;

/** Each tile's box: the compact strip sits flat with a gap, the stand-in's stair overlaps. */
export function reelTiles(count: number, width: number, height: number, stair: boolean): { width: number; height: number; marginLeft: number }[] {
  return Array.from({ length: count }, (_, index) => ({ width, height, marginLeft: index === 0 ? 0 : stair ? -STAIR_OVERLAP : GAP }));
}

interface GuideFocusReelProps {
  channelId: string;
  left: number;
  width: number;
  cellHeight: number;
  /** The canvas's native-driven horizontal offset; the reel rides it so it stays on the visible edge, label-style. */
  scrollX: RNAnimated.Value;
  /** The rows' visible width: the pinned strip runs out at the screen's edge when the cell runs past it. */
  viewportWidth?: number;
  /** The row holds focus (its cell or its channel card): full strength and the one-shot drift. */
  active: boolean;
  /** A programme cell's variant: smaller tiles, under the cell's own lines. */
  compact?: boolean;
}

function Tile({
  uri,
  cacheKey,
  index,
  width,
  height,
  marginLeft,
  stair,
  active,
}: {
  uri: string;
  cacheKey: string;
  index: number;
  width: number;
  height: number;
  marginLeft: number;
  stair: boolean;
  active: boolean;
}) {
  // Mounted at rest (or invisible when born focused); only the focus transition animates,
  // so scrolling rows in never plays the stagger. Off TV every row shows at full strength.
  const opacity = useSharedValue(!IS_TV ? ACTIVE_OPACITY : active ? 0 : REST_OPACITY);
  useEffect(() => {
    if (!IS_TV) return;
    if (active) opacity.set(withDelay(index * STAGGER_MS, withTiming(ACTIVE_OPACITY, { duration: 220, easing: Easing.out(Easing.quad) })));
    else opacity.set(withTiming(REST_OPACITY, { duration: 200 }));
  }, [opacity, index, active]);
  const enter = useAnimatedStyle(() => ({ opacity: opacity.value }));
  // A stair step is opaque in the cell's colour, so a faded frame never shows the one it overlaps.
  return (
    <View style={[{ width, height, marginLeft }, stair && styles.stairStep]}>
      <Animated.View style={[styles.tile, enter]}>
        <Image source={{ uri, cacheKey }} style={styles.image} contentFit="cover" transition={0} cachePolicy="none" recyclingKey={cacheKey} />
      </Animated.View>
    </View>
  );
}

/**
 * The channel's last burst unrolled on its row as an overlapping stair, dressed as the cell's one
 * programme: resting faded as texture, brightening while the row holds focus. History, not "now":
 * the cell's corner box says so, with the sample's clock time in it.
 */
export function GuideFocusReel({ channelId, left, width, cellHeight, scrollX, viewportWidth = 0, active, compact = false }: GuideFocusReelProps) {
  const subscribe = useCallback((listener: () => void) => subscribeLiveFrame(channelId, listener), [channelId]);
  const read = useCallback(() => liveFrameReel(channelId), [channelId]);
  const reel = useSyncExternalStore(subscribe, read);
  const reelWidth = useAnimatedValue(0);
  const handleLayout = useCallback((event: LayoutChangeEvent) => reelWidth.setValue(event.nativeEvent.layout.width), [reelWidth]);
  const pinStyle = useMemo(() => ({ transform: [{ translateX: pinOffset(scrollX, left, width, reelWidth) }] }), [scrollX, left, width, reelWidth]);
  if (!reel || reel.frames.length === 0) return null;
  // Phone rows are short: 4pt off the strip keeps it clear of the cell's last text line.
  const tileHeight = Math.round(cellHeight * (compact ? 0.42 : IS_TV ? 0.55 : 0.5)) - (IS_TV ? 0 : 4);
  const tileWidth = Math.round(tileHeight * (16 / 9));
  const room = Math.max(0, (viewportWidth > 0 ? Math.min(width, viewportWidth) : width) - PAD_LEFT);
  const tiles = reelTiles(reel.frames.length, tileWidth, tileHeight, !compact);
  const cut = tiles.reduce((sum, tile) => sum + tile.width + tile.marginLeft, 0) > room;
  return (
    <RNAnimated.View style={[styles.reel, pinStyle]} onLayout={handleLayout} pointerEvents="none" testID="guide-focus-reel">
      <View style={[styles.strip, cut && { width: room, overflow: "hidden" }]}>
        {reel.frames.map((frame, index) => (
          <Tile key={frame.cacheKey} uri={frame.uri} cacheKey={frame.cacheKey} index={index} {...tiles[index]} stair={!compact} active={active} />
        ))}
        {cut ? <View style={[styles.cutFade, { width: Math.min(tileWidth, room), experimental_backgroundImage: compact ? CUT_FADE_COMPACT : CUT_FADE }]} /> : null}
      </View>
    </RNAnimated.View>
  );
}

const styles = StyleSheet.create({
  reel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    alignSelf: "flex-start",
    justifyContent: "flex-end",
    paddingLeft: PAD_LEFT,
    paddingBottom: IS_TV ? 12 : 6,
  },
  strip: {
    flexDirection: "row",
  },
  // Its border draws the GAP line the flat strip leaves between tiles.
  stairStep: {
    borderRadius: 3 + GAP,
    borderWidth: GAP,
    borderColor: COLORS.SURFACE_SUNKEN,
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
  tile: {
    flex: 1,
    overflow: "hidden",
    borderRadius: 3,
    backgroundColor: COLORS.SURFACE,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  cutFade: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
  },
});
