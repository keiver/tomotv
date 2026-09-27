import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { liveFrameReel, subscribeLiveFrame } from "@/services/liveFrames";
import { formatClock, labelPin } from "@/utils/guide";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useSyncExternalStore } from "react";
import { LayoutChangeEvent, Platform, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, SharedValue, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

const IS_TV = Platform.isTV;
/** Per-tile entrance offset: the reel unrolls left to right. */
const STAGGER_MS = 55;
const TEXT_SHADOW = { textShadowColor: "rgba(0, 0, 0, 0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: IS_TV ? 4 : 3 } as const;
/** The strip runs out through this, film trailing off the spool. */
const TAIL_FADE = "linear-gradient(to right, rgba(28, 28, 30, 0) 70%, rgba(28, 28, 30, 0.9) 100%)";

interface GuideFocusReelProps {
  channelId: string;
  left: number;
  width: number;
  cellHeight: number;
  /** The canvas's horizontal offset; the reel rides it so it stays on the visible edge, label-style. */
  scrollX: SharedValue<number>;
  /** A programme cell's variant: smaller tiles, no caption, under the cell's own three lines. */
  compact?: boolean;
}

function Tile({ uri, cacheKey, index, width, height }: { uri: string; cacheKey: string; index: number; width: number; height: number }) {
  const opacity = useSharedValue(0);
  const drift = useSharedValue(14);
  useEffect(() => {
    opacity.set(withDelay(index * STAGGER_MS, withTiming(0.92, { duration: 260, easing: Easing.out(Easing.quad) })));
    drift.set(withDelay(index * STAGGER_MS, withTiming(0, { duration: 260, easing: Easing.out(Easing.quad) })));
  }, [opacity, drift, index]);
  const enter = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateX: drift.value }] }));
  return (
    <Animated.View style={[styles.tile, { width, height }, enter]}>
      <Image source={{ uri, cacheKey }} style={styles.image} contentFit="cover" transition={0} cachePolicy="none" recyclingKey={cacheKey} />
    </Animated.View>
  );
}

/**
 * The channel's last burst unrolled flat while its stand-in cell is focused, dressed as the cell's
 * one programme: the cell's own title and meta type over a strip of stills. History, not "now":
 * the title says so, with the sample's clock time beside it.
 */
export function GuideFocusReel({ channelId, left, width, cellHeight, scrollX, compact = false }: GuideFocusReelProps) {
  const subscribe = useCallback((listener: () => void) => subscribeLiveFrame(channelId, listener), [channelId]);
  const read = useCallback(() => liveFrameReel(channelId), [channelId]);
  const reel = useSyncExternalStore(subscribe, read);
  const reelWidth = useSharedValue(0);
  const handleLayout = useCallback((event: LayoutChangeEvent) => reelWidth.set(event.nativeEvent.layout.width), [reelWidth]);
  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateX: labelPin(scrollX.value, left, width, reelWidth.value) }] }), [left, width]);
  if (!reel || reel.frames.length === 0) return null;
  const tileHeight = Math.round(cellHeight * (compact ? 0.42 : IS_TV ? 0.55 : 0.5));
  const tileWidth = Math.round(tileHeight * (16 / 9));
  return (
    <Animated.View style={[styles.reel, pinStyle]} onLayout={handleLayout} pointerEvents="none" testID="guide-focus-reel">
      {compact ? null : (
        <View style={styles.textRow}>
          <Text style={styles.title} numberOfLines={1}>
            {t("liveTv.lastSeen")}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {formatClock(reel.at)}
          </Text>
        </View>
      )}
      <View style={styles.strip}>
        {reel.frames.map((frame, index) => (
          <Tile key={frame.cacheKey} uri={frame.uri} cacheKey={frame.cacheKey} index={index} width={tileWidth} height={tileHeight} />
        ))}
        <View style={styles.tailFade} />
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
    paddingLeft: IS_TV ? 16 : 10,
    paddingBottom: IS_TV ? 12 : 6,
  },
  textRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: IS_TV ? 10 : 6,
    marginBottom: IS_TV ? 8 : 4,
  },
  // The programme cell's second row: its subtitle face, the clock in its meta face.
  title: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 19 : 11,
    ...TEXT_SHADOW,
  },
  meta: {
    color: COLORS.TEXT_TERTIARY,
    fontSize: IS_TV ? 17 : 10,
    ...TEXT_SHADOW,
  },
  strip: {
    flexDirection: "row",
    gap: 2,
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
  tailFade: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: "22%",
    experimental_backgroundImage: TAIL_FADE,
  },
});
