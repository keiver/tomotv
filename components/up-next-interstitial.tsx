import { FocusableButton } from "@/components/FocusableButton";
import { COLORS } from "@/constants/colors";
import { useItemPoster } from "@/hooks/useItemPoster";
import { getBackdropBlurUrl, hasPoster } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { formatSeasonEpisode } from "@/utils/seasonEpisode";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

interface UpNextInterstitialProps {
  nextVideo: JellyfinVideoItem;
  /**
   * False while this is only PREWARMING: mounted behind playback so its poster and backdrop
   * are fetched, decoded and laid out, but invisible, untouchable, silent to VoiceOver and
   * with no countdown running. True the instant playback ends, which is then a style flip
   * rather than a first render plus two network round trips.
   */
  armed: boolean;
  /** Advance the queue now (countdown expiry and the Play Now CTA both land here). */
  onPlayNext: () => void;
  /** Stop the binge: clear the queue and leave the player. */
  onClose: () => void;
}

const COUNTDOWN_MS = 5000;
// No entrance DELAY: the card is already on screen, under AVKit's presented player, and the
// dismissal slide-down (~0.4s, not configurable in the lib) is what reveals it. The fade only
// covers the case where nothing slides — it can never be the thing the viewer waits through.
const ENTRANCE_FADE_MS = 250;
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
 * (blur=20) scaled full screen — here at near-full strength under a gradient scrim, so
 * the next episode's artwork dominates the frame.
 */
export function UpNextInterstitial({ nextVideo, armed, onPlayNext, onClose }: UpNextInterstitialProps) {
  const seasonEpisode = useMemo(() => formatSeasonEpisode(nextVideo), [nextVideo]);

  const posterSource = useItemPoster(nextVideo, POSTER_HEIGHT * 2);

  // The server's blurred wash where it has a poster; a keyframe washes itself, blurred here.
  const serverPostered = hasPoster(nextVideo);
  const backdropSource = useMemo(() => {
    if (!serverPostered) return posterSource;
    const uri = getBackdropBlurUrl(nextVideo.Id);
    if (!uri) return undefined;
    return { uri, cacheKey: `${nextVideo.Id}-${nextVideo.ImageTags?.Primary}-backdrop` };
  }, [nextVideo, serverPostered, posterSource]);

  // Entrance fade, then a single countdown clock: the draining bar and the auto-advance
  // share one animation (photo-viewer slideshow pattern). Nothing runs while prewarming —
  // a clock started behind playback would advance the queue mid-episode. Cancelled on
  // unmount so a CTA press or a route change can never fire a stale advance.
  const appear = useSharedValue(0);
  const countdown = useSharedValue(0);
  useEffect(() => {
    if (!armed) return;
    appear.set(withTiming(1, { duration: ENTRANCE_FADE_MS }));
    countdown.set(
      withDelay(
        ENTRANCE_FADE_MS,
        withTiming(1, { duration: COUNTDOWN_MS, easing: Easing.linear }, (finished) => {
          if (finished) runOnJS(onPlayNext)();
        }),
      ),
    );
    return () => {
      cancelAnimation(appear);
      cancelAnimation(countdown);
    };
    // Restart only if the announced item changes (queue advance remounts the route anyway).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, nextVideo.Id]);

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
  }));

  const countdownStyle = useAnimatedStyle(() => ({
    width: (1 - countdown.value) * COUNTDOWN_WIDTH,
  }));

  useEffect(() => {
    if (!armed) return;
    AccessibilityInfo.announceForAccessibility(`Up next: ${nextVideo.Name}`);
  }, [armed, nextVideo.Name, nextVideo.Id]);

  return (
    <View
      style={[styles.container, !armed && styles.prewarming]}
      pointerEvents={armed ? "auto" : "none"}
      accessibilityElementsHidden={!armed}
      importantForAccessibility={armed ? "auto" : "no-hide-descendants"}>
      <Animated.View style={[styles.fill, fadeStyle]}>
        {backdropSource && (
          <Image source={backdropSource} style={styles.backdrop} contentFit="cover" transition={300} cachePolicy="memory-disk" blurRadius={serverPostered ? undefined : 24} accessible={false} />
        )}
        {/* Scrim keeps text/buttons legible over the full-strength poster wash — darker at the
            bottom where the CTAs sit, lighter up top so the artwork's color carries the frame. */}
        <LinearGradient colors={["rgba(20, 20, 20, 0.3)", "rgba(20, 20, 20, 0.82)"]} style={styles.fill} />

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
              icon={<Ionicons name="play" size={Platform.isTV ? 24 : 18} color={COLORS.SURFACE_SUNKEN} />}
              onPress={onPlayNext}
              style={styles.button}
            />
            <FocusableButton title="Close" variant="secondary" icon={<Ionicons name="close" size={Platform.isTV ? 24 : 18} color={COLORS.ACCENT} />} onPress={onClose} style={styles.button} />
          </View>
        </View>
      </Animated.View>
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
    backgroundColor: COLORS.BACKGROUND,
    zIndex: 200,
  },
  // Prewarming: laid out and loading, painting nothing. Not `display: none` — that skips
  // layout, and the images would only start fetching at the moment they are needed.
  prewarming: {
    opacity: 0,
  },
  fill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // The library-backdrop technique (tiny server-blurred poster upscaled full screen), but at
  // near-full strength — the gradient scrim above it restores legibility, so the artwork's
  // color can dominate the frame instead of being a faint wash.
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.85,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Platform.isTV ? 40 : "10%",
    gap: Platform.isTV ? 20 : 14,
  },
  eyebrow: {
    color: COLORS.TEXT_SECONDARY,
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
    color: COLORS.TEXT_SECONDARY,
    fontSize: Platform.isTV ? 24 : 15,
    fontWeight: "600",
  },
  episodeName: {
    color: COLORS.TEXT_PRIMARY,
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
    backgroundColor: COLORS.ACCENT,
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
