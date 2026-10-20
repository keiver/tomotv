import { MarqueeText } from "@/components/MarqueeText";
import { CARD_META, GRID } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { isLowContrast } from "@/services/cardTheme";
import React from "react";
import { Dimensions, Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;
const SCREEN = Dimensions.get("screen");
const IS_TABLET = !IS_TV && Math.min(SCREEN.width, SCREEN.height) >= GRID.PHONE_WIDE_MIN_WIDTH;
/** The line's size; its tight line box and gap are CARD_META's, which the rows reserve room for. */
export const META_SIZE = IS_TV ? 17 : IS_TABLET ? 13 : 11;
const META_LINE = IS_TV ? CARD_META.line.tv : IS_TABLET ? CARD_META.line.tablet : CARD_META.line.phone;
const MARK_GAP = IS_TV ? 8 : 4;

interface CardMetaLineProps {
  /** The name. */
  text: string;
  focused: boolean;
  /** Centred (TV, and wide cards that ask for it) or flush left. */
  centered: boolean;
  /** Pinned at the line's start, out of the text's flow: the now-playing bars or a passed icon. */
  mark?: (color: string) => React.ReactNode;
}

/** The name under a card, mounted in the card's own view: the theme's accent, brighter on focus, scrolling the full name while focused. */
export function CardMetaLine({ text, focused, centered, mark }: CardMetaLineProps) {
  const { accent, accentFocused } = useCardPalette();
  const lowContrast = isLowContrast(accent);
  const color = lowContrast ? COLORS.TEXT_PRIMARY : focused ? accentFocused : accent;
  const markNode = mark?.(color);
  return (
    <View style={styles.line} pointerEvents="none" testID="card-meta-line">
      <View style={markNode ? (centered ? styles.insetBoth : styles.insetStart) : null}>
        {markNode ? <View style={styles.mark}>{markNode}</View> : null}
        <MarqueeText active={focused} style={StyleSheet.flatten([styles.text, { color, textAlign: centered ? "center" : "left" }])}>
          {text}
        </MarqueeText>
      </View>
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
    marginTop: CARD_META.offset,
  },
  text: {
    width: "100%",
    fontSize: META_SIZE,
    lineHeight: META_LINE,
    fontWeight: "800",
    letterSpacing: IS_TV ? 1.5 : 0.8,
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
