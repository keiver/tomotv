import { glassTint } from "@/components/glass-button";
import { GlassSurface } from "@/components/glass-surface";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const ICON_SIZE = IS_TV ? 19 : 12;
const BADGE_HEIGHT = IS_TV ? 40 : 26;
const COMPACT_BADGE_HEIGHT = 20;
/** Resting glass: near-black, so the accent number holds over any artwork. */
export const BADGE_GLASS_TINT = "rgba(8, 8, 10, 0.6)";

/** Inset every card's corner overlays sit at, shared so the pill and the chips line up. */
export const CARD_BADGE_INSET = IS_TV ? 16 : 10;
/** The LIVE pill's height; a slim pill and a bare mark beside it take the same, so the row reads as one size. */
export const SLIM_BADGE_HEIGHT = IS_TV ? 26 : 18;

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
  /** Focused card: the glass takes the accent and the ink turns white. */
  focused?: boolean;
  /** "live": solid red in both states, the broadcast mark on a channel card. */
  tone?: "gold" | "live";
  /** Phone only: a shorter pill with smaller text, for two pills sharing one card corner. */
  compact?: boolean;
  /** The LIVE pill's size, for a pill sharing its row (a channel's number). LIVE is always slim. */
  slim?: boolean;
}

/**
 * Glass card pill: what a folder holds, which disc and track a song is, which episode. The card
 * that renders it owns its position.
 */
export function CardBadge({ segments, loading, focused, tone = "gold", compact = false, slim = false }: CardBadgeProps) {
  const live = tone === "live";
  const small = compact && !IS_TV;
  const thin = live || slim;
  const palette = useCardPalette();
  const ink = live || focused ? COLORS.TEXT_PRIMARY : palette.accent;
  const height = thin ? SLIM_BADGE_HEIGHT : small ? COMPACT_BADGE_HEIGHT : BADGE_HEIGHT;
  const sizing = [styles.badge, small && styles.badgeCompact, thin && styles.badgeSlim];

  const content = (
    <>
      {segments?.map(({ icon, label }, index) => (
        // Index keys: the array is rebuilt whole on every render and never reordered.
        <View key={index} style={styles.segment}>
          {icon ? <Ionicons name={icon} size={ICON_SIZE} color={ink} /> : null}
          {label != null ? (
            <Text style={[styles.badgeText, thin && styles.badgeTextLive, small && styles.badgeTextCompact, { color: ink }]} numberOfLines={1}>
              {label}
            </Text>
          ) : null}
        </View>
      ))}
      {loading ? <ActivityIndicator size="small" color={ink} style={styles.spinner} /> : null}
    </>
  );

  // Solid red: the 1st-gen Apple TV 4K draws UIGlassEffect without its tint, which greys the live mark.
  if (live) {
    return (
      <View style={[sizing, styles.badgeLive]} pointerEvents="none">
        {content}
      </View>
    );
  }

  return (
    <GlassSurface style={sizing} radius={height / 2} tintColor={focused ? glassTint(palette.accent, true) : BADGE_GLASS_TINT} pointerEvents="none">
      {content}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  // No radius here: a style radius competes with GlassSurface's own `radius`.
  badge: {
    minWidth: BADGE_HEIGHT,
    height: BADGE_HEIGHT,
    paddingHorizontal: IS_TV ? 10 : 7,
    flexDirection: "row",
    // Wider than the within-segment gap, so "disc 2" and "track 5" read as two facts, not four.
    gap: IS_TV ? 9 : 6,
    justifyContent: "center",
    alignItems: "center",
  },
  // Tighter than the index pill: one short word, the same vertical air would read as padding.
  badgeSlim: {
    minWidth: SLIM_BADGE_HEIGHT,
    height: SLIM_BADGE_HEIGHT,
    paddingHorizontal: IS_TV ? 7 : 4,
  },
  badgeLive: {
    borderRadius: 500,
    borderWidth: 1,
    backgroundColor: COLORS.DESTRUCTIVE_DEEP,
    borderColor: COLORS.DESTRUCTIVE_DEEP,
  },
  badgeCompact: {
    minWidth: COMPACT_BADGE_HEIGHT,
    height: COMPACT_BADGE_HEIGHT,
    paddingHorizontal: 6,
  },
  badgeTextCompact: {
    fontSize: 9,
  },
  badgeTextLive: {
    fontSize: IS_TV ? 16 : 9,
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 4 : 2,
    flexShrink: 1,
  },
  // "small" is 20pt, scaled down to sit inside the badge circle ("small"/"large" are
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
