import { type BadgeSegment } from "@/components/card-badge";
import { STAND_NAME_TEXT } from "@/components/card-stand";
import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { isLowContrast } from "@/services/cardTheme";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
/** How far the tab stands above the card's top edge. */
const TAB_RISE = IS_TV ? 22 : 14;
/** The tab's radius, and how far its foot tucks under the card, so only its rounded top shows. */
const TAB_RADIUS = IS_TV ? 12 : 8;
const TAB_INSET = DESIGN.BORDER_RADIUS_CARD;

interface CardCornerTabProps {
  segments: BadgeSegment[];
  /** "live": the broadcast red, for a programme's NOW, REC or start time. */
  tone?: "plain" | "live";
  /** The card holds focus: the tab fills with the accent, like the base. */
  focused?: boolean;
}

/** A folder tab on the card's top edge near its right corner. Render it as the card's first child so the art covers its foot. */
export function CardCornerTab({ segments, tone = "plain", focused = false }: CardCornerTabProps) {
  const { accent, ink } = useCardPalette();
  const live = tone === "live";
  const lit = focused && !live;
  // Lettered like the name under the card: the accent, white when the accent is too dark to read, the ink on the accent.
  const color = lit ? ink : live || isLowContrast(accent) ? COLORS.TEXT_PRIMARY : accent;
  const content = segments.map(({ icon, label }, index) => (
    // Index keys: the array is rebuilt whole on every render and never reordered.
    <View key={index} style={styles.segment}>
      {icon ? <Ionicons name={icon} size={STAND_NAME_TEXT.fontSize} color={color} /> : null}
      {label != null ? (
        <Text style={[styles.label, live && styles.labelLive, { color }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </View>
  ));
  return (
    <View
      style={[styles.anchor, styles.body, live && styles.bodyLive, styles.solid, { backgroundColor: live ? COLORS.DESTRUCTIVE_DEEP : lit ? accent : COLORS.SURFACE_SUNKEN }]}
      pointerEvents="none"
      testID="card-corner-tab">
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    top: -TAB_RISE,
    right: TAB_INSET,
    height: TAB_RISE + TAB_RADIUS,
  },
  body: {
    // The foot sits under the card, so the lettering centres in the part above it.
    paddingBottom: TAB_RADIUS,
    paddingHorizontal: IS_TV ? 14 : 8,
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 9 : 5,
  },
  bodyLive: {
    paddingHorizontal: IS_TV ? 10 : 6,
  },
  solid: {
    borderRadius: TAB_RADIUS,
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 4 : 2,
  },
  label: {
    ...STAND_NAME_TEXT,
  },
  labelLive: {
    fontSize: IS_TV ? 13 : 8,
  },
});
