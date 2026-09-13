import { COLORS } from "@/constants/colors";
import { STAGE_HINT_AFTER_SECONDS, stageHint, stageLabel, usePlaybackStage } from "@/hooks/usePlaybackStage";
import type { PlaybackStage } from "@/services/playbackStage";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * The player's black loading canvas, and on tvOS the screen's focus anchor.
 *
 * The anchor cannot be a sibling of this overlay. react-native-tvos Fabric
 * forces `isUserInteractionEnabled = YES` on plain views, so an opaque absolute
 * overlay occludes UIKit focus for everything beneath it (`pointerEvents` cannot
 * opt out) — which is every focusable the player has while it loads: AVKit's
 * transport bar, and the invisible holders this component replaces. With focus
 * stranded outside the pushed screen, Menu finds no responder chain to the
 * navigation controller and the system backgrounds the app instead of popping
 * (see memories/CLAUDE-lessons-learned.md — the audio-player Menu case and the
 * PR #61 overlay case).
 *
 * So the topmost view IS the focusable: by construction nothing can occlude it,
 * and no future overlay can silently break Menu by out-stacking a holder's
 * zIndex. Menu handling stays zero-JS.
 */
export function PlayerLoadingOverlay({ title }: { title?: string }) {
  const body = (
    <>
      <ActivityIndicator size="large" color={COLORS.TEXT_PRIMARY} />
      <PlaybackStageToasts title={title} />
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

/** A passed stage's pill stays this long before it fades. */
const DONE_HOLD_MS = 2500;
const FADE_MS = 400;
/** Passed stages still on their way out, at most; the running one is always shown. */
const PASSED_SHOWN = 4;

/**
 * The stages as corner pills, newest lowest: each arrives when its stage begins and fades
 * once the stage has passed, so the centre keeps the spinner alone and nothing reflows.
 */
function PlaybackStageToasts({ title }: { title?: string }) {
  const { stage, passed, elapsedSeconds } = usePlaybackStage();
  const insets = useSafeAreaInsets();
  if (!stage) return null;
  // Keyed by position in the attempt, so a pill keeps its identity (and its fade) as the list grows.
  const first = Math.max(0, passed.length - PASSED_SHOWN);
  const pills = passed.slice(first).map((done, index) => ({ key: `${first + index}-${done}`, stage: done, done: true }));
  pills.push({ key: `${passed.length}-${stage}`, stage, done: false });
  return (
    <View pointerEvents="none" style={[styles.corner, { top: (Platform.isTV ? 60 : 16) + insets.top, left: (Platform.isTV ? 80 : 16) + insets.left }]}>
      {title ? (
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      {pills.map((pill) => (
        <StagePill key={pill.key} stage={pill.stage} done={pill.done} elapsedSeconds={pill.done ? 0 : elapsedSeconds} />
      ))}
    </View>
  );
}

function StagePill({ stage, done, elapsedSeconds }: { stage: PlaybackStage; done: boolean; elapsedSeconds: number }) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  const slide = useSharedValue(reducedMotion ? 0 : -14);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (reducedMotion) return;
    opacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) });
    slide.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [reducedMotion, opacity, slide]);

  useEffect(() => {
    if (!done) return;
    const fade = setTimeout(() => {
      if (!reducedMotion) opacity.value = withTiming(0, { duration: FADE_MS });
    }, DONE_HOLD_MS);
    const remove = setTimeout(() => setGone(true), DONE_HOLD_MS + (reducedMotion ? 0 : FADE_MS));
    return () => {
      clearTimeout(fade);
      clearTimeout(remove);
    };
  }, [done, reducedMotion, opacity]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateX: slide.value }] }));
  if (gone) return null;
  const hint = !done && elapsedSeconds >= STAGE_HINT_AFTER_SECONDS ? stageHint(stage) : null;
  return (
    <Animated.View style={[styles.pill, done && styles.pillDone, animated]}>
      <Text style={[styles.pillText, done && styles.pillTextDone]} numberOfLines={1}>
        {stageLabel(stage)}
        {!done && elapsedSeconds >= 2 ? <Text style={styles.elapsed}>{`  ${elapsedSeconds}s`}</Text> : null}
      </Text>
      {hint ? (
        <Text style={styles.hint} numberOfLines={2}>
          {hint}
        </Text>
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
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.MEDIA_BACKGROUND,
    zIndex: 100,
  },
  corner: {
    position: "absolute",
    alignItems: "flex-start",
    maxWidth: Platform.isTV ? 760 : 320,
  },
  title: {
    fontSize: Platform.isTV ? 24 : 13,
    fontWeight: "600",
    color: COLORS.TEXT_TERTIARY,
    marginBottom: Platform.isTV ? 14 : 8,
    marginLeft: Platform.isTV ? 4 : 2,
  },
  pill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(28, 28, 30, 0.92)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Platform.isTV ? 16 : 10,
    paddingHorizontal: Platform.isTV ? 22 : 12,
    paddingVertical: Platform.isTV ? 12 : 7,
    marginBottom: Platform.isTV ? 10 : 6,
  },
  pillDone: {
    backgroundColor: "rgba(28, 28, 30, 0.6)",
  },
  pillText: {
    fontSize: Platform.isTV ? 26 : 15,
    fontWeight: "600",
    color: COLORS.TEXT_PRIMARY,
  },
  pillTextDone: {
    fontWeight: "400",
    color: COLORS.TEXT_TERTIARY,
  },
  elapsed: {
    fontWeight: "400",
    color: COLORS.TEXT_SECONDARY,
  },
  hint: {
    marginTop: Platform.isTV ? 6 : 4,
    fontSize: Platform.isTV ? 21 : 13,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: Platform.isTV ? 28 : 18,
  },
});
