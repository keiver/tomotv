import { CARD_FOCUS } from "@/constants/app";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface CardBadgeProps {
  /** Short text or count — circle at 1-2 characters, pill beyond. */
  label: string | number;
}

/**
 * Top-left gold card pill: folder item counts, season/episode tags.
 *
 * Gold on purpose, and loud on purpose. A recursive item count is a thing this app is sure of and
 * most Jellyfin clients are not, and the season/episode tag survives filenames the server never
 * parsed — both are claims worth making at full strength, not metadata to tuck away.
 */
export function CardBadge({ label }: CardBadgeProps) {
  return (
    <View style={styles.badge} pointerEvents="none">
      <Text style={styles.badgeText}>{label}</Text>
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
    paddingHorizontal: IS_TV ? 8 : 6,
    borderRadius: IS_TV ? 20 : 13, // half of height → circle at 1-2 digits, pill beyond
    backgroundColor: CARD_FOCUS.TITLE_BG_FOCUSED,
    justifyContent: "center",
    alignItems: "center",
    // Lifted off the artwork rather than stamped onto it: the shadow is what stops a gold disc
    // from fusing with a bright poster, and it keeps a soft edge on a dark one. Solid fill, not a
    // translucent one — iOS derives this shadow from the rounded rect only while the layer is
    // opaque; drop the alpha and every card in the grid pays for per-pixel shadow tracing.
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: IS_TV ? 3 : 2 },
    shadowOpacity: 0.45,
    shadowRadius: IS_TV ? 8 : 4,
    elevation: 6,
  },
  badgeText: {
    color: CARD_FOCUS.TITLE_TEXT_FOCUSED,
    fontSize: IS_TV ? 18 : 11,
    fontWeight: "700",
  },
});
