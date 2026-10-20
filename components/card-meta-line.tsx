import { MarqueeText } from "@/components/MarqueeText";
import { GRID } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { isLowContrast } from "@/services/cardTheme";
import { withAlpha } from "@/utils/color";
import React from "react";
import { Dimensions, Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const SCREEN = Dimensions.get("screen");
const IS_TABLET = !IS_TV && Math.min(SCREEN.width, SCREEN.height) >= GRID.PHONE_WIDE_MIN_WIDTH;
/** The line's size and its tight line box: TV's two lines end 40pt under the card, the room a home shelf leaves before it clips. */
export const META_SIZE = IS_TV ? 17 : IS_TABLET ? 13 : 11;
const META_LINE = IS_TV ? 19 : IS_TABLET ? 15 : 13;
const SECONDARY_SIZE = 13;
const SECONDARY_LINE = 13;
/** Gap between the card's bottom edge and the line. */
export const META_OFFSET = IS_TV ? 8 : 6;
const MARK_GAP = IS_TV ? 8 : 4;

interface CardMetaLineProps {
  /** The line's text: a folder's count leads its name. */
  text: string;
  focused: boolean;
  /** Centred (TV, and wide cards that ask for it) or flush left. */
  centered: boolean;
  /** Pinned at the line's start, out of the text's flow: the now-playing bars, the watched eye, a passed icon. */
  mark?: (color: string) => React.ReactNode;
  /** Inline before the text: the favorite heart, and on phone the episode number. */
  lead?: (color: string, size: number) => React.ReactNode;
  /** TV only: a second line under the text, for the episode or track number. */
  secondary?: (color: string, size: number) => React.ReactNode;
}

/** The text under a card, mounted in the card's own view: the theme's accent, brighter on focus, scrolling the full name while focused. */
export function CardMetaLine({ text, focused, centered, mark, lead, secondary }: CardMetaLineProps) {
  const { accent, accentFocused } = useCardPalette();
  const lowContrast = isLowContrast(accent);
  const color = lowContrast ? COLORS.TEXT_PRIMARY : focused ? accentFocused : accent;
  const markNode = mark?.(color);
  const secondaryNode = IS_TV ? secondary?.(withAlpha(color, 0.75), SECONDARY_SIZE) : null;
  return (
    <View style={styles.line} pointerEvents="none" testID="card-meta-line">
      <View style={markNode ? (centered ? styles.insetBoth : styles.insetStart) : null}>
        {markNode ? <View style={styles.mark}>{markNode}</View> : null}
        <MarqueeText active={focused} style={StyleSheet.flatten([styles.text, { color, textAlign: centered ? "center" : "left" }])} lead={lead?.(color, META_SIZE)}>
          {text}
        </MarqueeText>
      </View>
      {secondaryNode ? (
        <Text style={[styles.secondary, { color: withAlpha(color, 0.75), textAlign: centered ? "center" : "left" }]} numberOfLines={1}>
          {secondaryNode}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The card's view has no padding, so 100% is its own bottom edge.
  line: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: META_OFFSET,
  },
  text: {
    width: "100%",
    fontSize: META_SIZE,
    lineHeight: META_LINE,
    fontWeight: "800",
    letterSpacing: IS_TV ? 1.5 : 0.8,
    textTransform: "uppercase",
  },
  secondary: {
    fontSize: SECONDARY_SIZE,
    lineHeight: SECONDARY_LINE,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  // Out of flow at the line's start; centred text clears it on both sides so it stays centred.
  mark: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  insetBoth: {
    paddingHorizontal: META_SIZE + MARK_GAP,
  },
  insetStart: {
    paddingLeft: META_SIZE + MARK_GAP,
  },
});
