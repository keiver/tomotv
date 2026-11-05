import { CARD_FOCUS, DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import type { StringKey } from "@/services/i18n/strings";
import { Ionicons } from "@expo/vector-icons";
import { MULTIVIEW_ASPECT, multiviewFit, multiviewGroupCard, multiviewGroupCount, type MultiviewLayoutName, type MultiviewRect } from "@keiver/tomo-live";
import React, { memo, useState } from "react";
import { Platform, StyleSheet, TouchableOpacity, View } from "react-native";

const IS_TV = Platform.isTV;
const LINE = IS_TV ? 3 : 2;
const SPEAKER = 26;
const SCREEN_RADIUS = IS_TV ? 24 : 14;
const CHECK = 26;
const SNAP = IS_TV ? 16 : 8;
/** The drawing's distance from the option's rounded edge. */
export const MULTIVIEW_LAYOUT_INSET = IS_TV ? 20 : 12;

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

/** A rect laid out with no gap, pulled in by one line and grown by one, so neighbours share one line and the outer ones meet the outline. */
const lineBox = (rect: MultiviewRect, shape: { width: number; height: number }) => {
  const sx = (shape.width - LINE) / shape.width;
  const sy = (shape.height - LINE) / shape.height;
  // An edge closer to the outline than SNAP moves onto it, so no line sits against the outline.
  const left = rect.x * sx < SNAP ? 0 : rect.x * sx;
  const top = rect.y * sy < SNAP ? 0 : rect.y * sy;
  const right = (rect.x + rect.width) * sx + LINE > shape.width - SNAP ? shape.width : (rect.x + rect.width) * sx + LINE;
  const bottom = (rect.y + rect.height) * sy + LINE > shape.height - SNAP ? shape.height : (rect.y + rect.height) * sy + LINE;
  return { left, top, width: right - left, height: bottom - top };
};

/** One layout as Multiview would fit it on this screen as held: a rounded screen outline with a line round every spot and the group's other channels, in the accent with a checkmark when current, grey otherwise. Its name is for accessibility only. */
function MultiviewLayoutOptionComponent({ layout, width: outer, stage, current, hasTVPreferredFocus, onPress }: MultiviewLayoutOptionProps) {
  const { accent } = useCardPalette();
  const width = outer - MULTIVIEW_LAYOUT_INSET * 2;
  const [focused, setFocused] = useState(false);
  const label = t(MULTIVIEW_LAYOUT_LABEL[layout]);
  const aspect = stage.width > 0 && stage.height > 0 ? stage.width / stage.height : MULTIVIEW_ASPECT;
  const shape = { width, height: width / aspect };
  const ink = current ? accent : COLORS.SURFACE_MUTED;
  const drawing = () => {
    const { spots, group } = multiviewFit(layout, { ...shape, gap: 0 });
    const cardHeight = group.width / group.columns / MULTIVIEW_ASPECT;
    // A row of the group is drawn only when at least half of it shows, so no line sits against the outline.
    const shown = multiviewGroupCount(group, Math.max(0, Math.ceil((shape.height - group.y - cardHeight / 2) / cardHeight)));
    const lined = [styles.box, { borderColor: ink }];
    return (
      <View style={[styles.screen, shape]} testID="multiview-layout-shape">
        {spots.map((rect, spot) => (
          <View key={spot} style={[lined, lineBox(rect, shape)]} testID="multiview-layout-spot">
            {IS_TV && spot === 0 ? <Ionicons name="volume-high" size={SPEAKER} color={COLORS.TEXT_PRIMARY} style={styles.speaker} testID="multiview-layout-sound" /> : null}
          </View>
        ))}
        {Array.from({ length: shown }, (_, rest) => {
          const card = multiviewGroupCard(rest, group, 0);
          return <View key={`rest-${rest}`} style={[lined, lineBox({ ...card, x: group.x + card.x, y: group.y + card.y }, shape)]} testID="multiview-layout-rest" />;
        })}
        <View style={[styles.outline, shape, { borderColor: ink }]} pointerEvents="none" testID="multiview-layout-outline" />
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
      style={[styles.option, { width: outer }]}>
      {drawing()}
      <View style={styles.check}>{current ? <Ionicons name="checkmark-circle" size={CHECK} color={accent} /> : null}</View>
      {focused ? <View style={[styles.ring, { borderColor: accent }]} pointerEvents="none" /> : null}
    </TouchableOpacity>
  );
}

export const MultiviewLayoutOption = memo(MultiviewLayoutOptionComponent);

const styles = StyleSheet.create({
  option: {
    gap: IS_TV ? 14 : 8,
    padding: MULTIVIEW_LAYOUT_INSET,
  },
  screen: {
    borderRadius: SCREEN_RADIUS,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  box: {
    position: "absolute",
    borderWidth: LINE,
  },
  outline: {
    position: "absolute",
    left: 0,
    top: 0,
    borderWidth: LINE,
    borderRadius: SCREEN_RADIUS,
    borderCurve: "continuous",
  },
  // Apple TV marks the spot with the sound with its speaker, as Multiview's label does; the accent is focus there.
  speaker: {
    position: "absolute",
    top: 8,
    left: 10,
  },
  check: {
    height: CHECK,
    alignItems: "center",
  },
  ring: {
    ...StyleSheet.absoluteFill,
    borderWidth: CARD_FOCUS.BORDER_WIDTH_FOCUSED,
    borderRadius: DESIGN.BORDER_RADIUS_CARD,
    borderCurve: "continuous",
  },
});
