import { CARD_CHROME, CARD_FOCUS, RAISED_EDGE } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import type { StringKey } from "@/services/i18n/strings";
import { Ionicons } from "@expo/vector-icons";
import { MULTIVIEW_ASPECT, multiviewFit, multiviewGroupCard, multiviewGroupCount, type MultiviewLayoutName, type MultiviewRect } from "@keiver/tomo-live";
import React, { memo, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const IS_TV = Platform.isTV;
const LINE = IS_TV ? 3 : 2;
const SHAPE_GAP = 8;

export const MULTIVIEW_LAYOUT_LABEL: Record<MultiviewLayoutName, StringKey> = {
  bigThree: "liveTv.layoutOnePlusThree",
  bigTwo: "liveTv.layoutOnePlusTwo",
  grid4: "liveTv.layoutGrid4",
  rowThree: "liveTv.layoutThreeAcross",
  halvesTwo: "liveTv.layoutTwoLargeTwoSmall",
  halvesThree: "liveTv.layoutThreeLargeOneSmall",
};

interface MultiviewLayoutOptionProps {
  layout: MultiviewLayoutName;
  /** The option's width; its drawings keep the Multiview screen's shape. */
  width: number;
  /** The Multiview screen's size, so the layout is drawn as it would fit there. */
  stage: { width: number; height: number };
  current: boolean;
  hasTVPreferredFocus?: boolean;
  onPress: (layout: MultiviewLayoutName) => void;
}

const box = (rect: MultiviewRect) => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });

/** One layout as Multiview would fit it on this screen and turned: a box per spot with the Live TV card's edge, the sound spot boxed, the group's other channels dimmer after them. */
function MultiviewLayoutOptionComponent({ layout, width, stage, current, hasTVPreferredFocus, onPress }: MultiviewLayoutOptionProps) {
  const { accent } = useCardPalette();
  const [focused, setFocused] = useState(false);
  const label = t(MULTIVIEW_LAYOUT_LABEL[layout]);
  // Apple TV has one shape. Elsewhere the screen turned is drawn too: below when held upright, beside when turned.
  const aspect = stage.width > 0 && stage.height > 0 ? stage.width / stage.height : MULTIVIEW_ASPECT;
  const tall = aspect < 1;
  const shapes = IS_TV
    ? [{ width, height: width / aspect }]
    : tall
      ? [
          { width, height: width / aspect },
          { width, height: width * aspect },
        ]
      : (() => {
          const height = (width - SHAPE_GAP) / (aspect + 1 / aspect);
          return [
            { width: height * aspect, height },
            { width: height / aspect, height },
          ];
        })();
  const drawing = (shape: { width: number; height: number }, index: number) => {
    const { spots, group } = multiviewFit(layout, { ...shape, gap: LINE });
    const cardHeight = group.width / group.columns / MULTIVIEW_ASPECT;
    const shown = multiviewGroupCount(group, Math.max(0, Math.ceil((shape.height - group.y) / cardHeight)));
    return (
      <View key={index} style={[styles.screen, shape]} testID="multiview-layout-shape">
        {spots.map((rect, spot) => (
          <View key={spot} style={[styles.box, box(rect), spot === 0 && [styles.sound, { borderColor: accent }]]} testID="multiview-layout-spot" />
        ))}
        {Array.from({ length: shown }, (_, rest) => {
          const card = multiviewGroupCard(rest, group, LINE);
          return <View key={`rest-${rest}`} style={[styles.box, styles.rest, box({ ...card, x: group.x + card.x, y: group.y + card.y })]} testID="multiview-layout-rest" />;
        })}
      </View>
    );
  };
  return (
    <TouchableOpacity
      onPress={() => onPress(layout)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      activeOpacity={0.9}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: current }}
      style={[styles.option, { width }]}>
      <View style={[styles.shapes, tall ? styles.stacked : styles.beside]}>
        {shapes.map(drawing)}
        {focused ? <View style={[styles.ring, { borderColor: accent }]} pointerEvents="none" /> : null}
      </View>
      <View style={styles.caption}>
        {current ? <Ionicons name="checkmark-circle" size={IS_TV ? 26 : 16} color={accent} /> : null}
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export const MultiviewLayoutOption = memo(MultiviewLayoutOptionComponent);

const styles = StyleSheet.create({
  option: {
    gap: IS_TV ? 14 : 8,
  },
  screen: {
    backgroundColor: COLORS.BACKGROUND_DEEP,
    overflow: "hidden",
  },
  // A spot: the Live TV card's fill and lit edge, square.
  box: {
    position: "absolute",
    backgroundColor: CARD_CHROME,
    boxShadow: RAISED_EDGE,
  },
  rest: {
    opacity: 0.4,
  },
  // The spot with the sound: the box Multiview draws round it.
  sound: {
    borderWidth: LINE,
  },
  shapes: {
    gap: SHAPE_GAP,
  },
  stacked: {
    flexDirection: "column",
  },
  beside: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  ring: {
    ...StyleSheet.absoluteFill,
    borderWidth: CARD_FOCUS.BORDER_WIDTH_FOCUSED,
  },
  caption: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 8 : 4,
  },
  label: {
    flexShrink: 1,
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 24 : 13,
    fontWeight: "600",
  },
});
