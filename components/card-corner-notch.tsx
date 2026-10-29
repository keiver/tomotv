import { type BadgeSegment } from "@/components/card-badge";
import { STAND_NAME_TEXT } from "@/components/card-stand";
import { STAND_HEIGHT } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { isLowContrast } from "@/services/cardTheme";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
/** The notch's inner corner, and the curve where it meets the art's top and left edges. */
const NOTCH_RADIUS = IS_TV ? 12 : 8;

interface CardCornerNotchProps {
  segments: BadgeSegment[];
  /** "live": the broadcast red, for a programme's NOW, REC or start time. */
  tone?: "plain" | "live";
  /** The card holds focus: the notch fills with the accent, like the base. */
  focused?: boolean;
}

/** The art's top-left corner cut in the card's own colour. Render it inside the art's clipping slot, under the lit edge. */
export function CardCornerNotch({ segments, tone = "plain", focused = false }: CardCornerNotchProps) {
  const { accent, ink } = useCardPalette();
  const live = tone === "live";
  const lit = focused && !live;
  // Lettered like the name: the accent, white when the accent is too dark to read, the ink on the accent.
  const color = lit ? ink : live || isLowContrast(accent) ? COLORS.TEXT_PRIMARY : accent;
  const fill = live ? COLORS.DESTRUCTIVE_DEEP : lit ? accent : COLORS.SURFACE_SUNKEN;
  const fillet = (
    <View style={styles.fillet}>
      <View style={[styles.ring, { borderColor: fill }]} />
    </View>
  );
  return (
    <View style={styles.anchor} pointerEvents="none" testID="card-corner-notch">
      <View style={styles.row}>
        <View style={[styles.body, live && styles.bodyLive, { backgroundColor: fill }]} testID="card-corner-notch-body">
          {segments.map(({ icon, label }, index) => (
            // Index keys: the array is rebuilt whole on every render and never reordered.
            <View key={index} style={styles.segment}>
              {icon ? <Ionicons name={icon} size={STAND_NAME_TEXT.fontSize} color={color} /> : null}
              {label != null ? (
                <Text style={[styles.label, live && styles.labelLive, { color }]} numberOfLines={1}>
                  {label}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
        {fillet}
      </View>
      {fillet}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    top: 0,
    left: 0,
    alignItems: "flex-start",
  },
  row: {
    flexDirection: "row",
  },
  body: {
    height: STAND_HEIGHT,
    paddingHorizontal: IS_TV ? 18 : 9,
    minWidth: IS_TV ? 56 : 36,
    borderBottomRightRadius: NOTCH_RADIUS,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: IS_TV ? 9 : 5,
  },
  bodyLive: {
    paddingHorizontal: IS_TV ? 12 : 7,
  },
  // A square whose corner away from the notch is cut round, so the art's edge curves into the notch.
  fillet: {
    width: NOTCH_RADIUS,
    height: NOTCH_RADIUS,
    overflow: "hidden",
  },
  ring: {
    position: "absolute",
    top: -NOTCH_RADIUS,
    left: -NOTCH_RADIUS,
    width: NOTCH_RADIUS * 4,
    height: NOTCH_RADIUS * 4,
    borderRadius: NOTCH_RADIUS * 2,
    borderWidth: NOTCH_RADIUS,
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
