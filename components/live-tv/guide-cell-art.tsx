import { COLORS } from "@/constants/colors";
import { Image, type ImageSource } from "expo-image";
import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/** The poster steps back while the channel's grabbed frames show over it. */
const ART_UNDER_REEL_OPACITY = 0.12;

/** Clear over the floor, the cell's black at the poster's edge, clear again at its right end. */
export function artFadeGradient(lead: number, artWidth: number): string {
  const edge = Math.round((lead / (lead + artWidth)) * 100);
  return `linear-gradient(to right, rgba(20, 20, 20, 0) 0%, ${COLORS.BACKGROUND} ${edge}%, rgba(20, 20, 20, 0) 100%)`;
}

interface GuideCellArtProps {
  source: ImageSource;
  /** The poster's box at the cell's right end. */
  width: number;
  /** How far the fade reaches over the floor left of the poster. */
  lead: number;
  reelShown: boolean;
}

/** A programme's poster bled in from the cell's right, under one fade spanning the floor before it and the poster. */
export function GuideCellArt({ source, width, lead, reelShown }: GuideCellArtProps) {
  const opacity = useSharedValue(reelShown ? ART_UNDER_REEL_OPACITY : 1);
  // Born at its resting opacity; only a reel arriving or leaving animates.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    opacity.set(withTiming(reelShown ? ART_UNDER_REEL_OPACITY : 1, { duration: 200 }));
  }, [opacity, reelShown]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[styles.art, { width }, fadeStyle]} pointerEvents="none" testID="guide-cell-art">
      <View style={styles.clip}>
        <Image source={source} style={styles.image} contentFit="cover" contentPosition="right" transition={150} />
      </View>
      <View style={[styles.fade, { width: lead + width, experimental_backgroundImage: artFadeGradient(lead, width) }]} testID="guide-cell-art-fade" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  art: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
  },
  clip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  // Reaches left past the poster's box over the floor; the cell's own bounds hold it.
  fade: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
  },
});
