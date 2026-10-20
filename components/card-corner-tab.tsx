import { type BadgeSegment } from "@/components/card-badge";
import { STAND_NAME_TEXT } from "@/components/card-stand";
import { GlassSurface } from "@/components/glass-surface";
import { CARD_FOCUS, DESIGN, STAND_HEIGHT } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { isLowContrast } from "@/services/cardTheme";
import { withAlpha } from "@/utils/color";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const GLASS_TINT_ALPHA = 0.3;

interface CardCornerTabProps {
  segments: BadgeSegment[];
  /** The card's own back colour, which the tab is cut from. */
  surface?: string;
  /** "live": the broadcast red, for a programme's NOW, REC or start time. */
  tone?: "plain" | "live";
}

/** A tab flush in the art's top-left corner: the art's own corner rounds its top-left, its bottom-right takes the card's radius. */
export function CardCornerTab({ segments, surface = COLORS.SURFACE, tone = "plain" }: CardCornerTabProps) {
  const { accent } = useCardPalette();
  const live = tone === "live";
  // Lettered like the name under the card: the accent, white when the accent is too dark to read.
  const color = live || isLowContrast(accent) ? COLORS.TEXT_PRIMARY : accent;
  const content = segments.map(({ icon, label }, index) => (
    // Index keys: the array is rebuilt whole on every render and never reordered.
    <View key={index} style={styles.segment}>
      {icon ? <Ionicons name={icon} size={STAND_NAME_TEXT.fontSize} color={color} /> : null}
      {label != null ? (
        <Text style={[styles.label, { color }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </View>
  ));
  // TV: glass tinted with the card's colour, clipped to the solid tab's own rounding; the live red stays solid.
  if (IS_TV && !live) {
    return (
      <View style={[styles.anchor, styles.solid, styles.clip]} pointerEvents="none" testID="card-corner-tab">
        <GlassSurface style={styles.body} tintColor={withAlpha(surface, GLASS_TINT_ALPHA)} pointerEvents="none">
          {content}
        </GlassSurface>
      </View>
    );
  }
  return (
    <View style={[styles.anchor, styles.body, styles.solid, { backgroundColor: live ? COLORS.DESTRUCTIVE_DEEP : surface }]} pointerEvents="none" testID="card-corner-tab">
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  body: {
    // The focus border's width above the label, so the focused ring never crowds it.
    height: STAND_HEIGHT + CARD_FOCUS.BORDER_WIDTH_FOCUSED,
    paddingTop: CARD_FOCUS.BORDER_WIDTH_FOCUSED,
    paddingLeft: IS_TV ? 14 : 8,
    paddingRight: IS_TV ? 20 : 11,
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 9 : 5,
  },
  solid: {
    borderBottomRightRadius: DESIGN.BORDER_RADIUS_CARD,
  },
  clip: {
    overflow: "hidden",
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 4 : 2,
  },
  label: {
    ...STAND_NAME_TEXT,
  },
});
