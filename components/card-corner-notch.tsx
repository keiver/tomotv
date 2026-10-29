import { type BadgeSegment } from "@/components/card-badge";
import { STAND_NAME_TEXT } from "@/components/card-stand";
import { CARD_CHROME, STAND_HEIGHT } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useCardZoom } from "@/hooks/useCardZoom";
import { isLowContrast } from "@/services/cardTheme";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
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

/** Every measure of the notch at a card zoom, so it grows with the card around it. */
export function notchMetrics(zoom: number, live: boolean) {
  const radius = NOTCH_RADIUS * zoom;
  return {
    body: {
      height: STAND_HEIGHT * zoom,
      paddingHorizontal: (live ? (IS_TV ? 12 : 7) : IS_TV ? 18 : 9) * zoom,
      minWidth: (IS_TV ? 56 : 36) * zoom,
      borderBottomRightRadius: radius,
      gap: (IS_TV ? 9 : 5) * zoom,
    },
    fillet: { width: radius, height: radius },
    // A ring around a hole of the radius, centred on the square's far corner: the square outside the hole is the notch's colour.
    ring: { top: -radius, left: -radius, width: radius * 4, height: radius * 4, borderRadius: radius * 2, borderWidth: radius },
    segmentGap: (IS_TV ? 4 : 2) * zoom,
    fontSize: (live ? (IS_TV ? 13 : 12) : STAND_NAME_TEXT.fontSize) * zoom,
    letterSpacing: STAND_NAME_TEXT.letterSpacing * zoom,
    iconSize: STAND_NAME_TEXT.fontSize * zoom,
    // The cap: a drop shadow onto the art. The anchor has no fill, so the shadow follows the notch's drawn shape.
    shadow: { shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 4 * zoom, shadowOffset: { width: 1.5 * zoom, height: 2.5 * zoom } },
  };
}

/** The art's top-left corner cut in the card's own colour. Render it inside the art's clipping slot, under the lit edge. */
export function CardCornerNotch({ segments, tone = "plain", focused = false }: CardCornerNotchProps) {
  const { accent, ink } = useCardPalette();
  const zoom = useCardZoom();
  const live = tone === "live";
  const lit = focused && !live;
  const metrics = useMemo(() => notchMetrics(zoom, live), [zoom, live]);
  // Lettered like the name: the accent, white when the accent is too dark to read, the ink on the accent.
  const color = lit ? ink : live || isLowContrast(accent) ? COLORS.TEXT_PRIMARY : accent;
  const fill = live ? COLORS.DESTRUCTIVE_DEEP : lit ? accent : CARD_CHROME;
  const fillet = (
    <View style={[styles.fillet, metrics.fillet]}>
      <View style={[styles.ring, metrics.ring, { borderColor: fill }]} />
    </View>
  );
  return (
    <View style={[styles.anchor, metrics.shadow]} pointerEvents="none" testID="card-corner-notch">
      <View style={styles.row}>
        <View style={[styles.body, metrics.body, { backgroundColor: fill }]} testID="card-corner-notch-body">
          {segments.map(({ icon, label }, index) => (
            // Index keys: the array is rebuilt whole on every render and never reordered.
            <View key={index} style={[styles.segment, { gap: metrics.segmentGap }]}>
              {icon ? <Ionicons name={icon} size={metrics.iconSize} color={color} /> : null}
              {label != null ? (
                <Text style={[styles.label, { fontSize: metrics.fontSize, letterSpacing: metrics.letterSpacing, color }]} numberOfLines={1}>
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
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  fillet: {
    overflow: "hidden",
  },
  ring: {
    position: "absolute",
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
  },
  label: {
    ...STAND_NAME_TEXT,
  },
});
