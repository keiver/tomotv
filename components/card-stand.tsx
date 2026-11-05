import { MarqueeText } from "@/components/MarqueeText";
import { CARD_CHROME, DESIGN, STAND_HEIGHT } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useCardZoom } from "@/hooks/useCardZoom";
import { isLowContrast } from "@/services/cardTheme";
import { THIS_DEVICE } from "@/utils/hostEnvironment";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const IS_PHONE = THIS_DEVICE === "iPhone";
/** The stand's lettering, shared with the press sweep drawn over it. */
export const STAND_NAME_TEXT = {
  fontFamily: "ui-rounded",
  fontSize: IS_TV ? 18 : IS_PHONE ? 11 : 13,
  fontWeight: "800",
  letterSpacing: IS_TV ? 1.7 : IS_PHONE ? 1 : 1.2,
  textTransform: "uppercase",
} as const;

/** The stand's lettering at a card zoom: its size and tracking grow with the card. */
export function standNameText(zoom: number): { fontSize: number; letterSpacing: number } {
  return { fontSize: STAND_NAME_TEXT.fontSize * zoom, letterSpacing: STAND_NAME_TEXT.letterSpacing * zoom };
}
const STAND_PADDING = IS_TV ? 18 : 9;
const LEAD_GAP = IS_TV ? 8 : 4;

/** The fill's share in percent, floored at 5 so a just-started item still shows one. */
export function standFillPercent(fraction: number): number {
  return Math.max(Math.round(Math.min(Math.max(fraction, 0), 1) * 100), 5);
}

interface CardStandProps {
  name: string;
  icon?: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  offline?: boolean;
  /** Before the name, in its colour: the now-playing bars. */
  mark?: (color: string) => React.ReactNode;
  /** A watched fraction filling the base in the accent, the name inverting over it; undefined for none. */
  progress?: number | null;
  /** The name scrolls in full while the card holds focus. */
  scrolls?: boolean;
}

/** A card's base: flush under the art, its full width, naming it. The card colour at rest, the accent on focus, or a progress fill. */
export function CardStand({ name, icon, focused, offline = false, mark, progress, scrolls = false }: CardStandProps) {
  const { accent, ink } = useCardPalette();
  const zoom = useCardZoom();
  const filled = progress != null;
  const full = filled && standFillPercent(progress) === 100;
  const resting = isLowContrast(accent) ? COLORS.TEXT_PRIMARY : accent;
  // Over a partial fill the accent runs through a difference blend; a full one takes the ink.
  const text = full || (focused && !filled) ? ink : filled ? accent : resting;
  const glyphSize = STAND_NAME_TEXT.fontSize * zoom;
  const leadGap = LEAD_GAP * zoom;
  const nameStyle = StyleSheet.flatten([styles.name, standNameText(zoom), { color: text }]);
  const lead =
    offline || icon || mark ? (
      <>
        {/* A glyph, not a colour, says offline. */}
        {offline ? <Ionicons name="cloud-offline" size={glyphSize} color={text} testID="card-stand-offline" /> : null}
        {icon ? <Ionicons name={icon} size={glyphSize} color={text} /> : null}
        {mark?.(text)}
      </>
    ) : null;
  const background = focused && !filled ? accent : CARD_CHROME;
  return (
    <View style={[styles.base, zoom !== 1 && { height: STAND_HEIGHT * zoom, paddingHorizontal: STAND_PADDING * zoom }, { backgroundColor: background }]} pointerEvents="none" testID="card-stand">
      {/* An unpadded layer: an absolute child's percentage width resolves against its parent's padded inner width. */}
      {filled ? (
        <View style={StyleSheet.absoluteFill}>
          <View style={[styles.fill, { width: `${standFillPercent(progress)}%`, backgroundColor: accent }]} testID="card-stand-fill" />
        </View>
      ) : null}
      <View style={[styles.row, zoom !== 1 && { gap: leadGap }, filled && !full && styles.blend]}>
        {scrolls ? (
          <>
            {/* The mark sits at the left edge and the name clears it on both sides, centred on TV. */}
            {lead ? <View style={[styles.leadSlot, zoom !== 1 && { gap: leadGap }]}>{lead}</View> : null}
            <View style={[styles.scrollSlot, lead ? { marginHorizontal: glyphSize + leadGap } : null]}>
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
    paddingHorizontal: STAND_PADDING,
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
