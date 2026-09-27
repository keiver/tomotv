import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { liveFrameReel, subscribeLiveFrame } from "@/services/liveFrames";
import { formatClock } from "@/utils/guide";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useSyncExternalStore } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

const IS_TV = Platform.isTV;
/** Per-tile entrance offset: the reel unrolls left to right. */
const STAGGER_MS = 55;
const TEXT_SHADOW = { textShadowColor: "rgba(0, 0, 0, 0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: IS_TV ? 4 : 3 } as const;

interface GuideFocusReelProps {
  channelId: string;
  /** The stand-in spans the window, so x maps time as the canvas does. */
  windowStartMs: number;
  pxPerMinute: number;
  cellHeight: number;
}

function Tile({ uri, cacheKey, index, width, height }: { uri: string; cacheKey: string; index: number; width: number; height: number }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.set(withDelay(index * STAGGER_MS, withTiming(0.92, { duration: 260, easing: Easing.out(Easing.quad) })));
  }, [opacity, index]);
  return (
    <Animated.View style={[styles.tile, { width, height, opacity }]}>
      <Image source={{ uri, cacheKey }} style={styles.image} contentFit="cover" transition={0} cachePolicy="none" recyclingKey={cacheKey} />
    </Animated.View>
  );
}

/**
 * The channel's last burst unrolled flat on the timeline while its stand-in cell is focused:
 * anchored at the grab's own clock position, so where it sits says when it was sampled. History,
 * not "now": the title line says so, with the sample time beside it.
 */
export function GuideFocusReel({ channelId, windowStartMs, pxPerMinute, cellHeight }: GuideFocusReelProps) {
  const subscribe = useCallback((listener: () => void) => subscribeLiveFrame(channelId, listener), [channelId]);
  const read = useCallback(() => liveFrameReel(channelId), [channelId]);
  const reel = useSyncExternalStore(subscribe, read);
  if (!reel || reel.frames.length === 0 || reel.at < windowStartMs) return null;
  const anchorX = ((reel.at - windowStartMs) / 60_000) * pxPerMinute;
  const tileHeight = Math.round(cellHeight * (IS_TV ? 0.58 : 0.52));
  const tileWidth = Math.round(tileHeight * (16 / 9));
  return (
    <View style={[styles.reel, { left: anchorX }]} pointerEvents="none" testID="guide-focus-reel">
      <View style={styles.textRow}>
        <Text style={styles.title} numberOfLines={1}>
          {t("liveTv.lastSeen")}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatClock(reel.at)}
        </Text>
      </View>
      <View style={styles.strip}>
        {reel.frames.map((frame, index) => (
          <Tile key={frame.cacheKey} uri={frame.uri} cacheKey={frame.cacheKey} index={index} width={tileWidth} height={tileHeight} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  reel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    justifyContent: "flex-end",
    paddingBottom: IS_TV ? 12 : 6,
  },
  textRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: IS_TV ? 10 : 6,
    marginBottom: IS_TV ? 6 : 3,
  },
  title: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 19 : 11,
    fontWeight: "600",
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
});
