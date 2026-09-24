import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const ICON_SIZE = IS_TV ? 19 : 12;

// Resting fill and rim. Translucent, so the pill sits on the artwork rather than punching a hole
// in it; CardCornerScrim is what puts a floor under the gold glyphs.
const RESTING_FILL = "rgba(28, 28, 30, 0.72)";
const RESTING_RIM = "rgba(255, 255, 255, 0.18)";

/** Inset every card's corner overlays sit at, shared so the pill and the chips line up. */
export const CARD_BADGE_INSET = IS_TV ? 16 : 10;

export interface BadgeSegment {
  /** Names the value. A bare number reads as anything; "♪ 5" reads as a track. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Omitted while the value is still resolving, the icon alone holds the slot. */
  label?: string | number;
}

interface CardBadgeProps {
  /** One or two labelled values in a single pill (disc + track, or a lone count). */
  segments?: BadgeSegment[];
  /** Value still resolving: a spinner takes the labels' place, icons stay. */
  loading?: boolean;
  /** Focused card: the pill takes the same gold the border and the title bar take. */
  focused?: boolean;
  /** "live": red in both states, the broadcast mark on a channel card. */
  tone?: "gold" | "live";
  /** Phone only: a shorter pill with smaller text, for two pills sharing one card corner. */
  compact?: boolean;
}

/**
 * Gold card pill: what a folder holds, which disc and track a song is, which episode. The card
 * that renders it owns its position.
 *
 * Gold on purpose, and loud on purpose. A recursive item count is a thing this app is sure of and
 * most Jellyfin clients are not, and the season/episode tag survives filenames the server never
 * parsed — both are claims worth making at full strength, not metadata to tuck away.
 */
export function CardBadge({ segments, loading, focused, tone = "gold", compact = false }: CardBadgeProps) {
  const live = tone === "live";
  const small = compact && !IS_TV;
  const ink = live ? COLORS.TEXT_PRIMARY : focused ? CARD_FOCUS.TITLE_TEXT_FOCUSED : COLORS.ACCENT;

  return (
    <View style={[styles.badge, small && styles.badgeCompact, live ? styles.badgeLive : focused ? styles.badgeFocused : styles.badgeResting]} pointerEvents="none">
      {segments?.map(({ icon, label }, index) => (
        // Index keys: the array is rebuilt whole on every render and never reordered.
        <View key={index} style={styles.segment}>
          {icon ? <Ionicons name={icon} size={ICON_SIZE} color={ink} /> : null}
          {label != null ? (
            <Text style={[styles.badgeText, small && styles.badgeTextCompact, { color: ink }]} numberOfLines={1}>
              {label}
            </Text>
          ) : null}
        </View>
      ))}
      {loading ? <ActivityIndicator size="small" color={ink} style={styles.spinner} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: IS_TV ? 40 : 26,
    height: IS_TV ? 40 : 26,
    paddingHorizontal: IS_TV ? 10 : 7,
    borderRadius: 500,
    // Carried in both states so the pill's geometry does not shift on focus.
    borderWidth: 1,
    flexDirection: "row",
    // Wider than the within-segment gap, so "disc 2" and "track 5" read as two facts, not four.
    gap: IS_TV ? 9 : 6,
    justifyContent: "center",
    alignItems: "center",
  },
  // Gold to the card's own focus border and title bar, so the focused card reads as one material.
  // Opaque, which is what keeps this shadow on the cheap rounded-rect path.
  badgeFocused: {
    backgroundColor: CARD_FOCUS.TITLE_BG_FOCUSED,
    borderColor: CARD_FOCUS.TITLE_BG_FOCUSED,
    shadowColor: COLORS.SHADOW,
    shadowOffset: { width: 0, height: IS_TV ? 3 : 2 },
    shadowOpacity: 0.45,
    shadowRadius: IS_TV ? 8 : 4,
    elevation: 6,
  },
  // No shadow: a translucent layer costs per-pixel shadow tracing, and every card in the grid
  // draws this one. The rim is what gives it an edge over busy artwork instead.
  badgeResting: {
    backgroundColor: RESTING_FILL,
    borderColor: RESTING_RIM,
  },
  // Tighter than the index pill: one short word, the same vertical air would read as padding.
  badgeLive: {
    minWidth: IS_TV ? 30 : 20,
    height: IS_TV ? 30 : 20,
    backgroundColor: COLORS.DESTRUCTIVE_DEEP,
    borderColor: COLORS.DESTRUCTIVE_DEEP,
  },
  badgeCompact: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
  },
  badgeTextCompact: {
    fontSize: 9,
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 4 : 2,
    flexShrink: 1,
  },
  // "small" is 20pt — scaled down to sit inside the badge circle ("small"/"large" are
  // the only iOS sizes; numeric sizes are Android-only).
  spinner: {
    transform: [{ scale: IS_TV ? 0.45 : 0.3 }],
  },
  badgeText: {
    fontSize: IS_TV ? 18 : 11,
    fontWeight: "700",
    flexShrink: 1,
  },
});
