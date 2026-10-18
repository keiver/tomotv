import { SLIM_BADGE_HEIGHT } from "@/components/card-badge";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { liveFrameDueAt, liveFrameReel, subscribeLiveFrame } from "@/services/liveFrames";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
/** The picture is called LIVE this long after it last moved; past it the badge stops claiming. */
export const LIVE_FRESH_MS = 15_000;
const HEIGHT = SLIM_BADGE_HEIGHT;
const GLYPH_SIZE = IS_TV ? 16 : 11;

/** How much longer the picture may be called LIVE: the window follows the picture's last change, not the grab. */
export function liveRemainMs(nowMs: number, lastChangeMs: number): number {
  return Math.max(0, LIVE_FRESH_MS - (nowMs - lastChangeMs));
}

/**
 * A channel card's honest live mark, one red badge with two still states: LIVE while the picture is
 * seconds old, then an hourglass while the next picture waits its turn on the provider. A fresh burst
 * brings LIVE back. Nothing here animates: one timer per card flips the state, and the wall commits
 * nothing per frame for its badges.
 */
export function LiveFreshnessBadge({ channelId }: { channelId: string }) {
  const subscribe = useCallback((listener: () => void) => subscribeLiveFrame(channelId, listener), [channelId]);
  const reel = useSyncExternalStore(
    subscribe,
    useCallback(() => liveFrameReel(channelId), [channelId]),
  );
  // An unchanged verify re-dates the burst in place: the reel object stays while its due moves, and it counts as fresh.
  const dueAt = useSyncExternalStore(
    subscribe,
    useCallback(() => liveFrameDueAt(channelId), [channelId]),
  );
  // Read at mount too, so a card with a fresh picture never shows the hourglass for a frame.
  const [fresh, setFresh] = useState(() => !!reel && liveRemainMs(Date.now(), reel.at) > 0);
  // The LIVE window follows the picture, not the grab: a frame appended mid-burst is a newer picture.
  const seen = useRef<{ reel: unknown; changedAt: number }>({ reel: undefined, changedAt: 0 });
  useEffect(() => {
    if (!reel) return;
    if (seen.current.reel !== reel) seen.current = { reel, changedAt: seen.current.reel ? Date.now() : reel.at };
    const remain = liveRemainMs(Date.now(), Math.max(seen.current.changedAt, reel.at));
    setFresh(remain > 0);
    if (remain <= 0) return;
    const timer = setTimeout(() => setFresh(false), remain);
    return () => clearTimeout(timer);
  }, [reel, dueAt]);

  if (!reel) return null;
  return fresh ? (
    <View style={styles.badge} pointerEvents="none">
      <Text style={styles.text} numberOfLines={1}>
        {t("liveTv.live")}
      </Text>
    </View>
  ) : (
    <View style={[styles.badge, styles.round]} pointerEvents="none">
      <Ionicons name="hourglass-outline" size={GLYPH_SIZE} color={COLORS.TEXT_PRIMARY} />
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
  // The waiting mark is the pill's own circle: the same red, the same height, the text's room gone.
  round: {
    width: HEIGHT,
    paddingHorizontal: 0,
  },
  text: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 16 : 9,
    fontWeight: "700",
  },
});
