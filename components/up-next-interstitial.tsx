import { FocusableButton } from "@/components/FocusableButton";
import { getBackdropBlurUrl, getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { formatSeasonEpisode } from "@/utils/seasonEpisode";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useEffect, useMemo } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

interface UpNextInterstitialProps {
  nextVideo: JellyfinVideoItem;
  /** Advance the queue now (countdown expiry and the Play Now CTA both land here). */
  onPlayNext: () => void;
  /** Stop the binge: clear the queue and leave the player. */
  onClose: () => void;
}

const COUNTDOWN_MS = 5000;
const POSTER_HEIGHT = Platform.isTV ? 360 : 220;
const COUNTDOWN_WIDTH = Platform.isTV ? 360 : 240;

/**
 * Between-episodes "Up Next" screen for queue playback. Shown INSTEAD of advancing
 * immediately at video end — never over the player: on iPhone the presented AVKit player
 * owns the screen during playback and nothing RN-rendered can appear above it, so the
 * announcement moved to the gap between episodes where the RN layer is visible again
 * (the onEnd wrapper dismisses the presentation before this mounts).
 *
 * Background reuses the library-backdrop technique: the server-blurred 48px poster
 * (blur=20) scaled full screen at low opacity over the app canvas.
 */
export function UpNextInterstitial({ nextVideo, onPlayNext, onClose }: UpNextInterstitialProps) {
  const seasonEpisode = useMemo(() => formatSeasonEpisode(nextVideo), [nextVideo]);

  const posterSource = useMemo(() => {
    if (!hasPoster(nextVideo)) return undefined;
    const uri = getPosterUrl(nextVideo.Id, POSTER_HEIGHT * 2);
    if (!uri) return undefined;
    return { uri, cacheKey: `${nextVideo.Id}-${nextVideo.ImageTags?.Primary}-${POSTER_HEIGHT * 2}` };
  }, [nextVideo]);

  const backdropSource = useMemo(() => {
    if (!hasPoster(nextVideo)) return undefined;
    const uri = getBackdropBlurUrl(nextVideo.Id);
    if (!uri) return undefined;
    return { uri, cacheKey: `${nextVideo.Id}-${nextVideo.ImageTags?.Primary}-backdrop` };
  }, [nextVideo]);

  // Single clock: the draining bar and the auto-advance share one animation
  // (photo-viewer slideshow pattern). Cancelled on unmount so a CTA press or a
  // route change can never fire a stale advance.
  const countdown = useSharedValue(0);
  useEffect(() => {
    countdown.set(
      withTiming(1, { duration: COUNTDOWN_MS, easing: Easing.linear }, (finished) => {
        if (finished) runOnJS(onPlayNext)();
      }),
    );
    return () => cancelAnimation(countdown);
    // Restart only if the announced item changes (queue advance remounts the route anyway).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextVideo.Id]);

  const countdownStyle = useAnimatedStyle(() => ({
    width: (1 - countdown.value) * COUNTDOWN_WIDTH,
  }));

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`Up next: ${nextVideo.Name}`);
  }, [nextVideo.Name, nextVideo.Id]);

  return (
    <View style={styles.container}>
      {backdropSource && <Image source={backdropSource} style={styles.backdrop} contentFit="cover" transition={300} cachePolicy="memory-disk" accessible={false} />}

      <View style={styles.content}>
        <Text style={styles.eyebrow}>UP NEXT</Text>

        {posterSource && (
          <Image
            source={posterSource}
            style={[styles.poster, { aspectRatio: nextVideo.PrimaryImageAspectRatio || 2 / 3 }]}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
            accessible={true}
            accessibilityLabel={`${nextVideo.Name} poster`}
          />
        )}

        {nextVideo.SeriesName ? <Text style={styles.seriesName}>{nextVideo.SeriesName}</Text> : null}
        <Text style={styles.episodeName} numberOfLines={2}>
          {seasonEpisode ? `${seasonEpisode} · ${nextVideo.Name}` : nextVideo.Name}
        </Text>

        <View style={styles.countdownTrack}>
          <Animated.View style={[styles.countdownFill, countdownStyle]} />
        </View>

        <View style={styles.buttonRow}>
          <FocusableButton
            title="Play Now"
            variant="primary"
            hasTVPreferredFocus
            icon={<Ionicons name="play" size={Platform.isTV ? 24 : 18} color="#1C1C1E" />}
            onPress={onPlayNext}
            style={styles.button}
          />
          <FocusableButton title="Close" variant="secondary" icon={<Ionicons name="close" size={Platform.isTV ? 24 : 18} color="#FFC312" />} onPress={onClose} style={styles.button} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Opaque: covers the ended video underneath.
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#141414",
    zIndex: 200,
  },
  // Same low-opacity wash the library backdrop uses — the tiny server-blurred poster
  // upscaled to full screen; the base color does the rest.
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.3,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
    gap: Platform.isTV ? 20 : 14,
  },
  eyebrow: {
    color: "#98989D",
    fontSize: Platform.isTV ? 22 : 13,
    fontWeight: "700",
    letterSpacing: 3,
  },
  poster: {
    height: POSTER_HEIGHT,
    borderRadius: Platform.isTV ? 12 : 8,
    borderCurve: "continuous",
  },
  seriesName: {
    color: "#98989D",
    fontSize: Platform.isTV ? 24 : 15,
    fontWeight: "600",
  },
  episodeName: {
    color: "#FFFFFF",
    fontSize: Platform.isTV ? 32 : 19,
    fontWeight: "700",
    textAlign: "center",
    maxWidth: Platform.isTV ? 720 : 320,
  },
  countdownTrack: {
    width: COUNTDOWN_WIDTH,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    overflow: "hidden",
    marginTop: Platform.isTV ? 12 : 8,
  },
  countdownFill: {
    height: "100%",
    backgroundColor: "#FFC312",
  },
  buttonRow: {
    flexDirection: "row",
    gap: Platform.isTV ? 24 : 16,
    marginTop: Platform.isTV ? 16 : 10,
  },
  button: {
    minWidth: Platform.isTV ? 240 : 140,
  },
});
