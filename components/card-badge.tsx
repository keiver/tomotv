import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const ICON_SIZE = IS_TV ? 19 : 12;

export interface BadgeSegment {
  /** Names the value. A bare number reads as anything; "♪ 5" reads as a track. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Omitted while the value is still resolving — the icon alone holds the slot. */
  label?: string | number;
}

interface CardBadgeProps {
  /** One or two labelled values in a single pill (disc + track, or a lone count). */
  segments?: BadgeSegment[];
  /** Value still resolving: a spinner takes the labels' place, icons stay. */
  loading?: boolean;
}

/**
 * Top-left gold card pill: what a folder holds, which disc and track a song is, which episode.
 *
 * Gold on purpose, and loud on purpose. A recursive item count is a thing this app is sure of and
 * most Jellyfin clients are not, and the season/episode tag survives filenames the server never
 * parsed — both are claims worth making at full strength, not metadata to tuck away.
 */
export function CardBadge({ segments, loading }: CardBadgeProps) {
  return (
    <View style={styles.badge} pointerEvents="none">
      {segments?.map(({ icon, label }, index) => (
        // Index keys: the array is rebuilt whole on every render and never reordered.
        <View key={index} style={styles.segment}>
          {icon ? <Ionicons name={icon} size={ICON_SIZE} color={CARD_FOCUS.TITLE_TEXT_FOCUSED} /> : null}
          {label != null ? <Text style={styles.badgeText}>{label}</Text> : null}
        </View>
      ))}
      {loading ? <ActivityIndicator size="small" color={CARD_FOCUS.TITLE_TEXT_FOCUSED} style={styles.spinner} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: IS_TV ? 16 : 10,
    left: IS_TV ? 16 : 10,
    minWidth: IS_TV ? 40 : 26,
    height: IS_TV ? 40 : 26,
    paddingHorizontal: IS_TV ? 10 : 7,
    borderRadius: IS_TV ? 20 : 13, // half of height → circle at a bare 1-2 digits, pill once an icon joins
    backgroundColor: CARD_FOCUS.TITLE_BG_FOCUSED,
    flexDirection: "row",
    // Wider than the within-segment gap, so "disc 2" and "track 5" read as two facts, not four.
    gap: IS_TV ? 9 : 6,
    justifyContent: "center",
    alignItems: "center",
    // Lifted off the artwork rather than stamped onto it: the shadow is what stops a gold disc
    // from fusing with a bright poster, and it keeps a soft edge on a dark one. Solid fill, not a
    // translucent one — iOS derives this shadow from the rounded rect only while the layer is
    // opaque; drop the alpha and every card in the grid pays for per-pixel shadow tracing.
    shadowColor: COLORS.SHADOW,
    shadowOffset: { width: 0, height: IS_TV ? 3 : 2 },
    shadowOpacity: 0.45,
    shadowRadius: IS_TV ? 8 : 4,
    elevation: 6,
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 4 : 2,
  },
  // "small" is 20pt — scaled down to sit inside the badge circle ("small"/"large" are
  // the only iOS sizes; numeric sizes are Android-only).
  spinner: {
    transform: [{ scale: IS_TV ? 0.9 : 0.6 }],
  },
  badgeText: {
    color: CARD_FOCUS.TITLE_TEXT_FOCUSED,
    fontSize: IS_TV ? 18 : 11,
    fontWeight: "700",
  },
});
