import { LIVE_FRESH_MS } from "@/components/live-tv/live-freshness-badge";
import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useLiveFrameAge } from "@/hooks/useLiveFrameAge";
import { LIVE_FRAME_REFRESH_MS, LIVE_FRAME_TRANSITION_MS } from "@/services/liveFrames";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, Text, useAnimatedValue, View } from "react-native";

const IS_TV = Platform.isTV;
/** The height the stand adds under the picture, for the grid's row math. */
export const STAND_HEIGHT = IS_TV ? 34 : 24;
/** The stand's lettering, shared with the press sweep drawn over it. */
export const STAND_NAME_TEXT = {
  fontSize: IS_TV ? 15 : 9,
  fontWeight: "800",
  letterSpacing: IS_TV ? 1.5 : 0.8,
  textTransform: "uppercase",
} as const;
const FADE_STEPS = 8;
const FADE_STEP_MS = 1_000;
/** LIVE's end, then the red's steps down to black by the refresh floor. */
const AGE_MARKS = [LIVE_FRESH_MS, ...Array.from({ length: FADE_STEPS }, (_, i) => LIVE_FRESH_MS + ((i + 1) * (LIVE_FRAME_REFRESH_MS - LIVE_FRESH_MS)) / FADE_STEPS)];

/** The red's opacity at an age step: full while LIVE, none with no picture or past the last mark. */
export function standRedOpacity(step: number): number {
  return step < 0 ? 0 : 1 - step / AGE_MARKS.length;
}

interface ChannelStandProps {
  name: string;
  icon?: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  offline: boolean;
  /** The channel whose live picture ages the red; undefined for a card with no live mark. */
  liveChannelId?: string;
}

/**
 * A wall card's base: flush under the picture, its full width, naming the channel. Black at rest, gold on focus.
 * A fresh picture paints it LIVE red, which steps down to black: native opacity fades, idle between steps.
 */
export function ChannelStand({ name, icon, focused, offline, liveChannelId }: ChannelStandProps) {
  const { accent, ink } = useCardPalette();
  const step = useLiveFrameAge(liveChannelId ?? "", AGE_MARKS);
  const target = liveChannelId ? standRedOpacity(step) : 0;
  const red = useAnimatedValue(target);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    // Rising arrives with the new picture's crossfade; each step down takes a second.
    const fade = Animated.timing(red, { toValue: target, duration: target === 1 ? LIVE_FRAME_TRANSITION_MS : FADE_STEP_MS, useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [red, target]);
  // White on the LIVE red reads; gold on it does not.
  const text = focused ? ink : step === 0 && liveChannelId ? COLORS.TEXT_PRIMARY : accent;
  return (
    <View style={[styles.base, { backgroundColor: focused ? accent : COLORS.MEDIA_BACKGROUND }]} pointerEvents="none" testID="channel-stand">
      {focused ? null : <Animated.View style={[styles.red, { opacity: red }]} testID="channel-stand-red" />}
      {/* A glyph, not a colour, says offline. */}
      {offline ? <Ionicons name="cloud-offline" size={IS_TV ? 15 : 9} color={text} testID="channel-stand-offline" /> : null}
      {icon ? <Ionicons name={icon} size={IS_TV ? 15 : 9} color={text} /> : null}
      <Text style={[styles.name, { color: text }]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // The picture's bottom corners go square, so the base carries the card's radius.
  base: {
    height: STAND_HEIGHT,
    paddingHorizontal: IS_TV ? 18 : 9,
    borderBottomLeftRadius: DESIGN.BORDER_RADIUS_CARD,
    borderBottomRightRadius: DESIGN.BORDER_RADIUS_CARD,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: IS_TV ? 8 : 4,
  },
  // Under the name in the tree; its own radius, so the base needs no clip.
  red: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.DESTRUCTIVE_DEEP,
    borderBottomLeftRadius: DESIGN.BORDER_RADIUS_CARD,
    borderBottomRightRadius: DESIGN.BORDER_RADIUS_CARD,
  },
  name: {
    flexShrink: 1,
    ...STAND_NAME_TEXT,
  },
});
