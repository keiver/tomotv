import { SLIM_BADGE_HEIGHT } from "@/components/card-badge";
import { COLORS } from "@/constants/colors";
import { useLiveFrameAge } from "@/hooks/useLiveFrameAge";
import { t } from "@/services/i18n";
import { LIVE_FRAME_REFRESH_MS, LIVE_FRAME_TRANSITION_MS } from "@/services/liveFrames";
import React, { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, Text, useAnimatedValue } from "react-native";

const IS_TV = Platform.isTV;
/** The picture is called LIVE at full strength this long after it last moved; past it the badge fades out. */
export const LIVE_FRESH_MS = 15_000;
const FADE_STEPS = 8;
const FADE_STEP_MS = 1_000;
/** LIVE's end, then the badge's steps down to nothing by the refresh floor. */
const AGE_MARKS = [LIVE_FRESH_MS, ...Array.from({ length: FADE_STEPS }, (_, i) => LIVE_FRESH_MS + ((i + 1) * (LIVE_FRAME_REFRESH_MS - LIVE_FRESH_MS)) / FADE_STEPS)];
const HEIGHT = SLIM_BADGE_HEIGHT;

/** The badge's opacity at an age step: full while fresh, none with no picture or past the last mark. */
export function liveBadgeOpacity(step: number): number {
  return step < 0 ? 0 : 1 - step / AGE_MARKS.length;
}

/**
 * A channel card's live mark: LIVE at full strength while the picture is seconds old, then stepping down to
 * nothing until a fresh burst brings it back. Native opacity fades, idle between steps.
 */
export function LiveFreshnessBadge({ channelId }: { channelId: string }) {
  const step = useLiveFrameAge(channelId, AGE_MARKS);
  const target = liveBadgeOpacity(step);
  const opacity = useAnimatedValue(target);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    // Rising arrives with the new picture's crossfade; each step down takes a second.
    const fade = Animated.timing(opacity, { toValue: target, duration: target === 1 ? LIVE_FRAME_TRANSITION_MS : FADE_STEP_MS, useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [opacity, target]);
  if (step < 0) return null;
  return (
    <Animated.View style={[styles.badge, { opacity }]} pointerEvents="none" testID="live-freshness-badge">
      <Text style={styles.text} numberOfLines={1}>
        {t("liveTv.live")}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The LIVE pill's own look (see card-badge's live tone).
  badge: {
    minWidth: HEIGHT,
    height: HEIGHT,
    borderRadius: 500,
    borderWidth: 1,
    backgroundColor: COLORS.DESTRUCTIVE_DEEP,
    borderColor: COLORS.DESTRUCTIVE_DEEP,
    paddingHorizontal: IS_TV ? 7 : 4,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  text: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 16 : 9,
    fontWeight: "700",
  },
});
