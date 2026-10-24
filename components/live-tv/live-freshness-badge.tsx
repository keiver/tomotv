import { SLIM_BADGE_HEIGHT } from "@/components/card-badge";
import { COLORS } from "@/constants/colors";
import { useLiveFrameAge } from "@/hooks/useLiveFrameAge";
import { t } from "@/services/i18n";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
/** The picture is called LIVE this long after it last moved; past it the badge stops claiming. */
export const LIVE_FRESH_MS = 15_000;
const FRESH_MARKS = [LIVE_FRESH_MS];
const HEIGHT = SLIM_BADGE_HEIGHT;

/**
 * A channel card's honest live mark: LIVE while the picture is seconds old, then nothing until a fresh
 * burst brings it back. Nothing here animates: one timer per card clears it, and the wall commits
 * nothing per frame for its badges.
 */
export function LiveFreshnessBadge({ channelId }: { channelId: string }) {
  if (useLiveFrameAge(channelId, FRESH_MARKS) !== 0) return null;
  return (
    <View style={styles.badge} pointerEvents="none">
      <Text style={styles.text} numberOfLines={1}>
        {t("liveTv.live")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // The LIVE pill's own look (see card-badge's live tone).
  badge: {
    minWidth: HEIGHT,
    height: HEIGHT,
    borderRadius: 500,
    borderWidth: 1,
    backgroundColor: COLORS.DESTRUCTIVE_DEEP,
    borderColor: COLORS.DESTRUCTIVE_DEEP,
    paddingHorizontal: IS_TV ? 7 : 4,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  text: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 16 : 9,
    fontWeight: "700",
  },
});
