import { GuideChannelCard } from "@/components/live-tv/guide-channel-card";
import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { GuideChannelTile } from "@/components/live-tv/guide-channel-tile";
import { COLORS } from "@/constants/colors";
import type { InlineFrame } from "@/contexts/PlayerSessionContext";
import { useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import type { JellyfinItem, JellyfinProgram } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { formatClockRange, type GuideMetrics } from "@/utils/guide";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";

const ignore = () => {};
/** Fits beside the wide stop on the narrowest phone; the hit slop takes the touch target past 44. */
const CLOSE_SIZE = 36;

interface GuidePinnedBandProps {
  channel: JellyfinItem;
  /** What the channel airs now, when the guide has it. */
  program?: JellyfinProgram;
  /** The column's committed metrics: the card's width and the row's height at the current stop. */
  metrics: GuideMetrics;
  /** The closed stop: the band holds the logo tile and the player parks, still playing. */
  compact: boolean;
  /** Too little room beside the player to name the channel: only the close button stays. */
  bare: boolean;
  /** The two lists' scale while the column is dragged, so the band grows with them. */
  listScale: SharedValue<number>;
  /** The channel is still opening: its own clip shows in the slot until the player takes it. */
  opening: boolean;
  /** Where the player draws, in window coordinates; null parks it. */
  onSlot: (frame: InlineFrame | null) => void;
  onClose: () => void;
}

/**
 * Live TV's pinned channel, above the guide's two lists: the player in the card's slot with AVKit's controls, the
 * channel and what it airs beside it, and a close button. Outside both lists, so scrolling never moves the player. Phone only.
 */
export function GuidePinnedBand({ channel, program, metrics, compact, bare, listScale, opening, onSlot, onClose }: GuidePinnedBandProps) {
  const { accent } = useCardPalette();
  const slotRef = useRef<View>(null);
  const cardWidth = compact ? metrics.compactColumnWidth : metrics.channelColumnWidth;
  const measure = useCallback(() => {
    if (compact) {
      onSlot(null);
      return;
    }
    slotRef.current?.measureInWindow((x, y, width, height) => onSlot(width > 0 && height > 0 ? { x, y, width, height } : null));
  }, [compact, onSlot]);
  useEffect(() => {
    measure();
  }, [measure, cardWidth, metrics.rowHeight]);

  const bandStyle = useAnimatedStyle(() => ({ height: metrics.rowHeight * listScale.get() }));
  const innerStyle = useAnimatedStyle(() => ({ transform: [{ scale: listScale.get() }] }));
  const startMs = Date.parse(program?.StartDate ?? "");
  const endMs = Date.parse(program?.EndDate ?? "");
  const slot = Number.isFinite(startMs) && Number.isFinite(endMs) ? formatClockRange(startMs, endMs) : null;

  return (
    <Animated.View style={[styles.band, bandStyle]} testID="guide-pinned-band">
      <Animated.View style={[styles.inner, { height: metrics.rowHeight }, innerStyle]}>
        <View ref={slotRef} style={{ width: cardWidth, height: metrics.rowHeight - 1 }} onLayout={measure} collapsable={false}>
          {compact ? (
            <GuideChannelTile channel={channel} metrics={metrics} onPress={ignore} />
          ) : (
            <GuideChannelCard channel={channel} index={0} cardWidth={cardWidth} hideAiring flat square inset={metrics.cardInset} onPress={ignore} playsClipInView inView />
          )}
          {opening ? (
            <View style={styles.opening} pointerEvents="none" accessible accessibilityLabel={t("liveTv.tuningIn")} testID="guide-pinned-opening">
              <ActivityIndicator size="small" color={accent} />
            </View>
          ) : null}
        </View>
        {bare ? (
          <View style={styles.spacer} />
        ) : (
          <View style={styles.info}>
            <Text style={styles.channelName} numberOfLines={1}>
              {cleanLabel(channel.Name)}
            </Text>
            {program ? (
              <Text style={styles.program} numberOfLines={2}>
                {cleanLabel(program.Name)}
                {slot ? <Text style={styles.slot}>{`  ${slot.start} – ${slot.end}`}</Text> : null}
              </Text>
            ) : null}
          </View>
        )}
        <Pressable style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={8} testID="guide-pinned-close">
          <Ionicons name="close" size={22} color={COLORS.TEXT_PRIMARY} />
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  band: {
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: GRID_LINE,
    backgroundColor: COLORS.BACKGROUND,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    transformOrigin: "left top",
  },
  opening: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  spacer: {
    flex: 1,
  },
  info: {
    flex: 1,
    paddingHorizontal: 12,
    gap: 4,
  },
  channelName: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: 17,
    fontWeight: "600",
  },
  program: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 14,
  },
  slot: {
    color: COLORS.TEXT_SECONDARY,
  },
  close: {
    width: CLOSE_SIZE,
    height: CLOSE_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
});
