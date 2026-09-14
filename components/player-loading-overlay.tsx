import { COLORS } from "@/constants/colors";
import { STAGE_HINT_AFTER_SECONDS, stageHint, stageLabel, usePlaybackStage } from "@/hooks/usePlaybackStage";
import type { PlaybackStage } from "@/services/playbackStage";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

/**
 * The player's black loading canvas, and on tvOS the screen's focus anchor.
 *
 * The anchor cannot be a sibling of this overlay. react-native-tvos Fabric
 * forces `isUserInteractionEnabled = YES` on plain views, so an opaque absolute
 * overlay occludes UIKit focus for everything beneath it (`pointerEvents` cannot
 * opt out), which is every focusable the player has while it loads: AVKit's
 * transport bar, and the invisible holders this component replaces. With focus
 * stranded outside the pushed screen, Menu finds no responder chain to the
 * navigation controller and the system backgrounds the app instead of popping
 * (see memories/CLAUDE-lessons-learned.md: the audio-player Menu case and the
 * PR #61 overlay case).
 *
 * So the topmost view IS the focusable: by construction nothing can occlude it,
 * and no future overlay can silently break Menu by out-stacking a holder's
 * zIndex. Menu handling stays zero-JS.
 */
export function PlayerLoadingOverlay() {
  // Equal flex halves above and below keep the spinner at the exact centre whatever the line holds.
  const body = (
    <>
      <View style={styles.above} />
      <ActivityIndicator size="large" color={COLORS.TEXT_PRIMARY} />
      <View style={styles.below}>
        <PlaybackStageLine />
      </View>
    </>
  );
  if (Platform.isTV) {
    return (
      <Pressable isTVSelectable hasTVPreferredFocus onPress={() => {}} style={styles.overlay} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {body}
      </Pressable>
    );
  }

  return <View style={styles.overlay}>{body}</View>;
}

/** A load that settles sooner shows the bare spinner. */
export const REVEAL_AFTER_MS = 1000;
/** A label stays at least this long before the line moves on to the current stage. */
export const DWELL_MS = 700;
export const OUT_MS = 150;
const IN_MS = 200;
const ENTER = FadeIn.duration(IN_MS);

/** The current stage as one line under the spinner, swapped in place; its clock and, once it runs long, its hint follow it. */
function PlaybackStageLine() {
  const { stage, elapsedSeconds } = usePlaybackStage();
  const reducedMotion = useReducedMotion();
  const [revealed, setRevealed] = useState(false);
  const [shown, setShown] = useState<PlaybackStage | null>(null);
  const shownAt = useRef(0);
  const fading = useRef(false);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), REVEAL_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const fadeIn = () => opacity.set(reducedMotion ? 1 : withTiming(1, { duration: IN_MS, easing: Easing.out(Easing.quad) }));
    const wanted = revealed ? stage : null;
    if (wanted === shown) {
      // The stage came back while its label was fading out.
      if (fading.current) {
        fading.current = false;
        fadeIn();
      }
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const swap = () => {
      fading.current = false;
      shownAt.current = Date.now();
      setShown(wanted);
      if (wanted) fadeIn();
    };
    const leave = () => {
      if (!shown || reducedMotion) return swap();
      fading.current = true;
      opacity.set(withTiming(0, { duration: OUT_MS, easing: Easing.in(Easing.quad) }));
      timer = setTimeout(swap, OUT_MS);
    };
    const wait = shown ? shownAt.current + DWELL_MS - Date.now() : 0;
    if (wait > 0) timer = setTimeout(leave, wait);
    else leave();
    return () => clearTimeout(timer);
  }, [revealed, stage, shown, reducedMotion, opacity]);

  const slotStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!shown) return null;
  const live = shown === stage;
  const clock = live && elapsedSeconds >= 2 ? `${elapsedSeconds}s` : null;
  return (
    <Animated.View pointerEvents="none" style={[styles.slot, slotStyle]}>
      <View style={styles.line}>
        {/* An invisible twin of the clock keeps the label centred when the clock appears. */}
        {clock ? <Text style={[styles.clock, styles.clockTwin]}>{clock}</Text> : null}
        <Text style={styles.label} numberOfLines={1}>
          {stageLabel(shown)}
        </Text>
        {clock ? (
          <Animated.Text entering={ENTER} style={styles.clock}>
            {clock}
          </Animated.Text>
        ) : null}
      </View>
      {live && elapsedSeconds >= STAGE_HINT_AFTER_SECONDS ? (
        <Animated.Text entering={ENTER} style={styles.hint} numberOfLines={2}>
          {stageHint(shown)}
        </Animated.Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    backgroundColor: COLORS.MEDIA_BACKGROUND,
    zIndex: 100,
  },
  above: {
    flex: 1,
    paddingBottom: Platform.isTV ? 36 : 20,
  },
  below: {
    flex: 1,
    alignItems: "center",
    paddingTop: Platform.isTV ? 36 : 20,
  },
  slot: {
    alignItems: "center",
    maxWidth: Platform.isTV ? 760 : 320,
  },
  line: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  label: {
    flexShrink: 1,
    fontSize: Platform.isTV ? 26 : 15,
    lineHeight: Platform.isTV ? 32 : 20,
    fontWeight: "600",
    color: COLORS.TEXT_PRIMARY,
  },
  clock: {
    marginLeft: Platform.isTV ? 14 : 8,
    fontSize: Platform.isTV ? 22 : 13,
    lineHeight: Platform.isTV ? 32 : 20,
    fontVariant: ["tabular-nums"],
    color: COLORS.TEXT_SECONDARY,
  },
  clockTwin: {
    marginLeft: 0,
    marginRight: Platform.isTV ? 14 : 8,
    opacity: 0,
  },
  hint: {
    marginTop: Platform.isTV ? 6 : 4,
    fontSize: Platform.isTV ? 21 : 13,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: Platform.isTV ? 28 : 18,
    textAlign: "center",
  },
});
