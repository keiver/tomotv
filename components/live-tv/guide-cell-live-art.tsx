import { COLORS } from "@/constants/colors";
import { useLiveFrame } from "@/hooks/useLiveFrame";
import { LIVE_FRAME_TRANSITION_MS } from "@/services/liveFrames";
import { artPin } from "@/utils/guide";
import { Image } from "expo-image";
import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { SharedValue, useAnimatedStyle } from "react-native-reanimated";

/** The art blends into the stand-in's sunken band on its left, so the quiet line reads over it. */
const ART_FADE = "linear-gradient(to right, " + COLORS.SURFACE_SUNKEN + " 0%, rgba(28, 28, 30, 0) 100%)";

interface GuideCellLiveArtProps {
  channelId: string;
  left: number;
  width: number;
  height: number;
  /** The canvas's horizontal offset and visible width; the art rides them to the visible right edge. */
  scrollX: SharedValue<number>;
  viewportW: SharedValue<number>;
}

/**
 * The channel's live burst on a stand-in cell, one frame at a time, held to the viewport's right
 * edge. Mounted only for stand-ins, so the canvas's other cells carry no frame subscription.
 */
export function GuideCellLiveArt({ channelId, left, width, height, scrollX, viewportW }: GuideCellLiveArtProps) {
  const frame = useLiveFrame(channelId);
  const artWidth = Math.round(height * (16 / 9));
  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateX: artPin(scrollX.value, left, width, artWidth, viewportW.value) }] }), [left, width, artWidth]);
  if (!frame) return null;
  return (
    <Animated.View style={[styles.art, { width: artWidth, height }, pinStyle]} pointerEvents="none" testID="guide-cell-live-art">
      <Image source={frame} style={styles.image} contentFit="cover" transition={LIVE_FRAME_TRANSITION_MS} recyclingKey={channelId} cachePolicy="none" />
      <View style={styles.fade} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  art: {
    position: "absolute",
    top: 0,
    left: 0,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  fade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    experimental_backgroundImage: ART_FADE,
  },
});
