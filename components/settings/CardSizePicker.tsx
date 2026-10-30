import { AVATAR_CAPTION_LINE, AVATAR_CELL_WIDTH, STRIP_INSET } from "@/components/settings/styles";
import { GRID } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { themedStyles } from "@/hooks/useCardPalette";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** A poster card at 100%, in points; every pick scales from it. */
const CARD_H = 48;
const RADIUS = 7;
/** The base under the art, in the real card's share of its height. */
const STAND_H = 9;
const RING = 2;

/** The miniature card's box for a size: a poster shape, its corners and stand scaled with it. */
export function previewMetrics(size: number) {
  return {
    width: Math.round(CARD_H * size * GRID.PORTRAIT_RATIO),
    height: Math.round(CARD_H * size),
    borderRadius: RADIUS * size,
    standHeight: Math.round(STAND_H * size),
  };
}

interface CardSizePickerProps {
  sizes: readonly number[];
  selected: number;
  format: (size: number) => string;
  onSelect: (size: number) => void;
}

/** A row of miniature cards, one per size, standing on a common baseline; a tap picks that size. */
export function CardSizePicker({ sizes, selected, format, onSelect }: CardSizePickerProps) {
  const themed = useThemedStyles();
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {sizes.map((size) => {
        const chosen = size === selected;
        const metrics = previewMetrics(size);
        return (
          <Pressable
            key={size}
            onPress={() => onSelect(size)}
            accessibilityRole="radio"
            accessibilityLabel={format(size)}
            accessibilityState={{ selected: chosen, checked: chosen }}
            style={styles.option}
            testID={`card-size-${Math.round(size * 100)}`}>
            <View style={[styles.card, { width: metrics.width, height: metrics.height, borderRadius: metrics.borderRadius }, chosen && [styles.cardChosen, themed.ring]]}>
              <View style={styles.art} />
              <View style={[styles.stand, { height: metrics.standHeight }]} />
            </View>
            <Text style={[styles.label, chosen && [styles.labelChosen, themed.accent]]}>{format(size)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-end",
    gap: 4,
    paddingHorizontal: STRIP_INSET,
    paddingTop: STRIP_INSET + 8,
    paddingBottom: STRIP_INSET,
  },
  option: {
    width: AVATAR_CELL_WIDTH,
    alignItems: "center",
    gap: 8,
  },
  // The art over its stand, as the real cards draw. The stand is lighter than the real one: the section card is the card surface, which would swallow it.
  card: {
    overflow: "hidden",
  },
  cardChosen: {
    borderWidth: RING,
  },
  art: {
    flex: 1,
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  stand: {
    backgroundColor: COLORS.TEXT_SECONDARY,
  },
  label: {
    width: AVATAR_CELL_WIDTH,
    textAlign: "center",
    fontSize: 13,
    lineHeight: AVATAR_CAPTION_LINE,
    fontWeight: "500",
    color: COLORS.TEXT_TERTIARY,
  },
  labelChosen: {
    fontWeight: "700",
  },
});

const useThemedStyles = themedStyles((palette) => ({
  ring: {
    borderColor: palette.accent,
  },
  accent: {
    color: palette.accent,
  },
}));
