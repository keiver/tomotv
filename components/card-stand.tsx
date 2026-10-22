import { GlassSurface } from "@/components/glass-surface";
import { LIVE_FRESH_MS } from "@/components/live-tv/live-freshness-badge";
import { MarqueeText } from "@/components/MarqueeText";
import { DESIGN, STAND_HEIGHT } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useLiveFrameAge } from "@/hooks/useLiveFrameAge";
import { isLowContrast } from "@/services/cardTheme";
import { LIVE_FRAME_REFRESH_MS, LIVE_FRAME_TRANSITION_MS } from "@/services/liveFrames";
import { withAlpha } from "@/utils/color";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, Text, useAnimatedValue, View } from "react-native";

const IS_TV = Platform.isTV;
/** How much of the card's colour tints a card's glass, shared by the base and the tab. */
export const CARD_GLASS_TINT_ALPHA = 0.3;
/** The stand's lettering, shared with the press sweep drawn over it. */
export const STAND_NAME_TEXT = {
  fontSize: IS_TV ? 15 : 9,
  fontWeight: "800",
  letterSpacing: IS_TV ? 1.5 : 0.8,
  textTransform: "uppercase",
} as const;
const LEAD_GAP = IS_TV ? 8 : 4;
const FADE_STEPS = 8;
const FADE_STEP_MS = 1_000;
/** LIVE's end, then the red's steps down to black by the refresh floor. */
const AGE_MARKS = [LIVE_FRESH_MS, ...Array.from({ length: FADE_STEPS }, (_, i) => LIVE_FRESH_MS + ((i + 1) * (LIVE_FRAME_REFRESH_MS - LIVE_FRESH_MS)) / FADE_STEPS)];

/** The fill's share in percent, floored at 5 so a just-started item still shows one. */
export function standFillPercent(fraction: number): number {
  return Math.max(Math.round(Math.min(Math.max(fraction, 0), 1) * 100), 5);
}

/** The red's opacity at an age step: full while LIVE, none with no picture or past the last mark. */
export function standRedOpacity(step: number): number {
  return step < 0 ? 0 : 1 - step / AGE_MARKS.length;
}

interface CardStandProps {
  name: string;
  icon?: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  offline?: boolean;
  /** The channel whose live picture ages the red; undefined for a card with no live mark. */
  liveChannelId?: string;
  /** Before the name, in its colour: the now-playing bars. */
  mark?: (color: string) => React.ReactNode;
  /** A watched fraction filling the base in the accent, the name inverting over it; undefined for none. */
  progress?: number | null;
  /** The name scrolls in full while the card holds focus. */
  scrolls?: boolean;
  /** No fill at rest: the name sits on whatever is behind the card, through glass on TV. */
  clear?: boolean;
  /** The card's own colour, which tints the glass. */
  surface?: string;
}

/**
 * A card's base: flush under the art, its full width, naming it. Dark or clear at rest, the accent on focus, or a progress fill.
 * A channel's fresh picture paints it LIVE red, which steps down to dark: native opacity fades, idle between steps.
 */
export function CardStand(props: CardStandProps) {
  return props.liveChannelId ? <LiveCardStand {...props} channelId={props.liveChannelId} /> : <StandBody {...props} fresh={false} />;
}

/** Only a channel with a live picture ages the red, so only it subscribes to the picture's age. */
function LiveCardStand({ channelId, ...props }: CardStandProps & { channelId: string }) {
  const step = useLiveFrameAge(channelId, AGE_MARKS);
  const target = standRedOpacity(step);
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
  return <StandBody {...props} fresh={step === 0} red={props.focused ? null : <Animated.View style={[styles.red, { opacity: red }]} testID="card-stand-red" />} />;
}

function StandBody({
  name,
  icon,
  focused,
  offline = false,
  mark,
  progress,
  scrolls = false,
  clear = false,
  surface = COLORS.SURFACE,
  fresh,
  red,
}: CardStandProps & { fresh: boolean; red?: React.ReactNode }) {
  const { accent, ink } = useCardPalette();
  const filled = progress != null;
  const full = filled && standFillPercent(progress) === 100;
  const resting = isLowContrast(accent) ? COLORS.TEXT_PRIMARY : accent;
  // White on the LIVE red reads; gold on it does not. Over a partial fill the accent runs through a difference blend; a full one takes the ink.
  const text = full || (focused && !filled) ? ink : filled ? accent : fresh ? COLORS.TEXT_PRIMARY : resting;
  const glyphSize = IS_TV ? 15 : 9;
  const nameStyle = StyleSheet.flatten([styles.name, { color: text }]);
  const lead =
    offline || icon || mark ? (
      <>
        {/* A glyph, not a colour, says offline. */}
        {offline ? <Ionicons name="cloud-offline" size={glyphSize} color={text} testID="card-stand-offline" /> : null}
        {icon ? <Ionicons name={icon} size={glyphSize} color={text} /> : null}
        {mark?.(text)}
      </>
    ) : null;
  const background = focused && !filled ? accent : clear ? "transparent" : COLORS.BACKGROUND_DEEP;
  return (
    <View style={[styles.base, { backgroundColor: background }]} pointerEvents="none" testID="card-stand">
      {IS_TV && background === "transparent" ? <GlassSurface style={StyleSheet.absoluteFill} tintColor={withAlpha(surface, CARD_GLASS_TINT_ALPHA)} pointerEvents="none" /> : null}
      {filled ? null : red}
      {/* An unpadded layer: an absolute child's percentage width resolves against its parent's padded inner width. */}
      {filled ? (
        <View style={StyleSheet.absoluteFill}>
          <View style={[styles.fill, { width: `${standFillPercent(progress)}%`, backgroundColor: accent }]} testID="card-stand-fill" />
        </View>
      ) : null}
      <View style={[styles.row, filled && !full && styles.blend]}>
        {scrolls ? (
          <>
            {/* The mark sits at the left edge and the name clears it on both sides, centred on TV. */}
            {lead ? <View style={styles.leadSlot}>{lead}</View> : null}
            <View style={[styles.scrollSlot, lead ? { marginHorizontal: glyphSize + LEAD_GAP } : null]}>
              <MarqueeText active={focused} style={StyleSheet.flatten([nameStyle, styles.scrollName])}>
                {name}
              </MarqueeText>
            </View>
          </>
        ) : (
          <>
            {lead}
            <Text style={nameStyle} numberOfLines={1}>
              {name}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The art's bottom corners go square, so the base carries the card's radius.
  base: {
    height: STAND_HEIGHT,
    paddingHorizontal: IS_TV ? 18 : 9,
    borderBottomLeftRadius: DESIGN.BORDER_RADIUS_CARD,
    borderBottomRightRadius: DESIGN.BORDER_RADIUS_CARD,
    overflow: "hidden",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: IS_TV ? "center" : "flex-start",
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
  // Clears the rounded bottom-left corner, so a just-started fill still shows.
  fill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    minWidth: DESIGN.BORDER_RADIUS_CARD + (IS_TV ? 20 : 12),
  },
  // Over the fill the accent cancels to black, over the base it stays the accent.
  blend: {
    mixBlendMode: "difference",
  },
  name: {
    flexShrink: 1,
    ...STAND_NAME_TEXT,
  },
  leadSlot: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: LEAD_GAP,
  },
  scrollSlot: {
    flex: 1,
    minWidth: 0,
  },
  scrollName: {
    width: "100%",
    textAlign: IS_TV ? "center" : "left",
  },
});
