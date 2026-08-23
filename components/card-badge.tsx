import { GlassSurface } from "@/components/glass-surface";
import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const ICON_SIZE = IS_TV ? 19 : 12;

// Focused tint and rim. 0.45 is what holds the gold glyphs at 4.3:1 over a blown-out poster on
// top of CardCornerScrim; below that a bright backdrop takes them under AA.
const GLASS_TINT = "rgba(28, 28, 30, 0.45)";
const GLASS_RIM = "rgba(255, 255, 255, 0.18)";

/** Inset every card's corner overlays sit at, shared so the pill and the chips line up. */
export const CARD_BADGE_INSET = IS_TV ? 16 : 10;

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
  /** Focused card: the fill becomes glass and the gold moves to the glyphs. */
  focused?: boolean;
}

/**
 * Gold card pill: what a folder holds, which disc and track a song is, which episode. The card
 * that renders it owns its position.
 *
 * Gold on purpose, and loud on purpose. A recursive item count is a thing this app is sure of and
 * most Jellyfin clients are not, and the season/episode tag survives filenames the server never
 * parsed — both are claims worth making at full strength, not metadata to tuck away.
 */
export function CardBadge({ segments, loading, focused }: CardBadgeProps) {
  const ink = focused ? COLORS.ACCENT : CARD_FOCUS.TITLE_TEXT_FOCUSED;
  const content = (
    <>
      {segments?.map(({ icon, label }, index) => (
        // Index keys: the array is rebuilt whole on every render and never reordered.
        <View key={index} style={styles.segment}>
          {icon ? <Ionicons name={icon} size={ICON_SIZE} color={ink} /> : null}
          {label != null ? <Text style={[styles.badgeText, { color: ink }]}>{label}</Text> : null}
        </View>
      ))}
      {loading ? <ActivityIndicator size="small" color={ink} style={styles.spinner} /> : null}
    </>
  );

  // Focused only, so one instance is alive at a time: Apple reserves the material for navigation
  // and for elements that take focus, and a translucent fill drops the badge's cheap shadow path.
  if (focused) {
    return (
      <GlassSurface style={[styles.badge, styles.badgeGlass]} intensity={70} tintColor={GLASS_TINT}>
        {content}
      </GlassSurface>
    );
  }

  return (
    <View style={[styles.badge, styles.badgeSolid]} pointerEvents="none">
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: IS_TV ? 40 : 26,
    height: IS_TV ? 40 : 26,
    paddingHorizontal: IS_TV ? 10 : 7,
    borderRadius: 500,
    flexDirection: "row",
    // Wider than the within-segment gap, so "disc 2" and "track 5" read as two facts, not four.
    gap: IS_TV ? 9 : 6,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeSolid: {
    backgroundColor: CARD_FOCUS.TITLE_BG_FOCUSED,
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
  // No shadow to replace the solid pill's: a hairline rim is what gives glass an edge over busy
  // artwork, and overflow clips the blur fallback to the pill.
  badgeGlass: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: GLASS_RIM,
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 4 : 2,
  },
  // "small" is 20pt — scaled down to sit inside the badge circle ("small"/"large" are
  // the only iOS sizes; numeric sizes are Android-only).
  spinner: {
    transform: [{ scale: IS_TV ? 0.45 : 0.3 }],
  },
  badgeText: {
    fontSize: IS_TV ? 18 : 11,
    fontWeight: "700",
  },
});
