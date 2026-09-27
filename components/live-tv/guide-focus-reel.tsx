import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { liveFrameReel, subscribeLiveFrame } from "@/services/liveFrames";
import { formatClock, labelPin } from "@/utils/guide";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useSyncExternalStore } from "react";
import { LayoutChangeEvent, Platform, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, SharedValue, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

const IS_TV = Platform.isTV;
/** Per-tile offset of the focus brightening: the reel unrolls left to right. */
const STAGGER_MS = 55;
/** A resting reel is texture; the focused one is the subject. */
const REST_OPACITY = 0.35;
const ACTIVE_OPACITY = 0.92;
const TEXT_SHADOW = { textShadowColor: "rgba(0, 0, 0, 0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: IS_TV ? 4 : 3 } as const;
/** A strip longer than its cell runs out at the cell's edge, into the cell's own colour. */
const CUT_FADE = "linear-gradient(to right, rgba(28, 28, 30, 0) 0%, " + COLORS.SURFACE_SUNKEN + " 100%)";
const CUT_FADE_COMPACT = "linear-gradient(to right, rgba(44, 44, 46, 0) 0%, " + COLORS.SURFACE + " 100%)";
const PAD_LEFT = IS_TV ? 16 : 10;
const GAP = 2;

interface GuideFocusReelProps {
  channelId: string;
  left: number;
  width: number;
  cellHeight: number;
  /** The canvas's horizontal offset; the reel rides it so it stays on the visible edge, label-style. */
  scrollX: SharedValue<number>;
  /** The rows' visible width: the pinned strip runs out at the screen's edge when the cell runs past it. */
  viewportWidth?: number;
  /** The row holds focus (its cell or its channel card): full strength and the one-shot drift. */
  active: boolean;
  /** A programme cell's variant: smaller tiles, no caption, under the cell's own three lines. */
  compact?: boolean;
}

function Tile({ uri, cacheKey, index, width, height, active }: { uri: string; cacheKey: string; index: number; width: number; height: number; active: boolean }) {
  // Mounted at rest (or invisible when born focused); only the focus transition animates,
  // so scrolling rows in never plays the stagger.
  const opacity = useSharedValue(active ? 0 : REST_OPACITY);
  useEffect(() => {
    if (active) opacity.set(withDelay(index * STAGGER_MS, withTiming(ACTIVE_OPACITY, { duration: 220, easing: Easing.out(Easing.quad) })));
    else opacity.set(withTiming(REST_OPACITY, { duration: 200 }));
  }, [opacity, index, active]);
  const enter = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[styles.tile, { width, height }, enter]}>
      <Image source={{ uri, cacheKey }} style={styles.image} contentFit="cover" transition={0} cachePolicy="none" recyclingKey={cacheKey} />
    </Animated.View>
  );
}

/**
 * The channel's last burst unrolled flat on its row, dressed as the cell's one programme: resting
 * faded as texture, brightening while the row holds focus. History, not "now": the caption says
 * so, with the sample's clock time in it.
 */
export function GuideFocusReel({ channelId, left, width, cellHeight, scrollX, viewportWidth = 0, active, compact = false }: GuideFocusReelProps) {
  const subscribe = useCallback((listener: () => void) => subscribeLiveFrame(channelId, listener), [channelId]);
  const read = useCallback(() => liveFrameReel(channelId), [channelId]);
  const reel = useSyncExternalStore(subscribe, read);
  const reelWidth = useSharedValue(0);
  const handleLayout = useCallback((event: LayoutChangeEvent) => reelWidth.set(event.nativeEvent.layout.width), [reelWidth]);
  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateX: labelPin(scrollX.value, left, width, reelWidth.value) }] }), [left, width]);
  if (!reel || reel.frames.length === 0) return null;
  const tileHeight = Math.round(cellHeight * (compact ? 0.42 : IS_TV ? 0.55 : 0.5));
  const tileWidth = Math.round(tileHeight * (16 / 9));
  const room = Math.max(0, (viewportWidth > 0 ? Math.min(width, viewportWidth) : width) - PAD_LEFT);
  const cut = reel.frames.length * (tileWidth + GAP) - GAP > room;
  return (
    <Animated.View style={[styles.reel, pinStyle]} onLayout={handleLayout} pointerEvents="none" testID="guide-focus-reel">
      {compact ? null : (
        <Text style={styles.title} numberOfLines={1}>
          {t("liveTv.lastSeen").replace("{time}", formatClock(reel.at))}
        </Text>
      )}
      <View style={[styles.strip, cut && { width: room, overflow: "hidden" }]}>
        {reel.frames.map((frame, index) => (
          <Tile key={frame.cacheKey} uri={frame.uri} cacheKey={frame.cacheKey} index={index} width={tileWidth} height={tileHeight} active={active} />
        ))}
        {cut ? <View style={[styles.cutFade, { width: Math.min(tileWidth, room), experimental_backgroundImage: compact ? CUT_FADE_COMPACT : CUT_FADE }]} /> : null}
      </View>
    </Animated.View>
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
  // The programme cell's second row: its subtitle face.
  title: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 19 : 11,
    marginBottom: IS_TV ? 8 : 4,
    ...TEXT_SHADOW,
  },
  strip: {
    flexDirection: "row",
    gap: GAP,
  },
  tile: {
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
