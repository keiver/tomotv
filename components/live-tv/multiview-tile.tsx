import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useLiveClip, useLiveFrame } from "@/hooks/useLiveFrame";
import { t } from "@/services/i18n";
import { getPosterUrl } from "@/services/jellyfinApi";
import { LIVE_FRAME_TRANSITION_MS } from "@/services/liveFrames";
import type { JellyfinItem, JellyfinProgram } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { durationLabel, programTimes } from "@/utils/guide";
import { Ionicons } from "@expo/vector-icons";
import { LiveClipView, type MultiviewRect } from "@keiver/tomo-live";
import { Image } from "expo-image";
import React, { memo, useCallback, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const IS_TV = Platform.isTV;

interface MultiviewTileProps {
  channel: JellyfinItem;
  rect: MultiviewRect;
  /** The tile plays with sound. */
  main: boolean;
  /** The tile's live session, null while it shows its clip or picture. */
  liveUrl: string | null;
  /** False while the screen is covered: the tile lets its player go. */
  visible: boolean;
  /** The programme airing, for the label; past its end it is not shown. */
  program?: Pick<JellyfinProgram, "Name" | "StartDate" | "EndDate"> | null;
  nowMs: number;
  hasTVPreferredFocus?: boolean;
  onSelect: (channelId: string) => void;
  /** The tile's player failed, or none was free for its live session. */
  onFailed: (channelId: string) => void;
  onLongPress?: (channelId: string) => void;
}

/** A programme's name and time left while it airs; null outside it. */
export function airingLine(program: Pick<JellyfinProgram, "Name" | "StartDate" | "EndDate"> | null | undefined, nowMs: number): string | null {
  if (!program?.Name) return null;
  const { startMs, endMs } = programTimes(program);
  if (!(startMs <= nowMs && nowMs < endMs)) return null;
  return `${cleanLabel(program.Name)} · ${t("liveTv.timeLeft").replace("{time}", durationLabel(endMs - nowMs))}`;
}

/** One multiview spot: its live session when it has one, else its clip, else its picture, else the channel's logo, under its name and programme. */
function MultiviewTileComponent({ channel, rect, main, liveUrl, visible, program, nowMs, hasTVPreferredFocus, onSelect, onFailed, onLongPress }: MultiviewTileProps) {
  const { accent } = useCardPalette();
  const frame = useLiveFrame(channel.Id);
  const clip = useLiveClip(channel.Id);
  const [focused, setFocused] = useState(false);
  const handlePress = useCallback(() => onSelect(channel.Id), [onSelect, channel.Id]);
  const handleLongPress = useCallback(() => onLongPress?.(channel.Id), [onLongPress, channel.Id]);
  const handleFailed = useCallback(() => onFailed(channel.Id), [onFailed, channel.Id]);
  const live = !!liveUrl;
  const uri = visible ? (liveUrl ?? clip?.uri ?? null) : null;
  const airing = airingLine(program, nowMs);
  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={onLongPress ? handleLongPress : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      activeOpacity={0.95}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={[cleanLabel(channel.Name ?? ""), airing].filter(Boolean).join(", ")}
      style={[styles.tile, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }, focused && [styles.focused, { borderColor: accent, shadowColor: accent }]]}>
      {frame ? null : <Image source={{ uri: getPosterUrl(channel.Id, 300) }} style={styles.logo} contentFit="contain" cachePolicy="memory-disk" />}
      {frame ? <Image source={frame} style={StyleSheet.absoluteFill} contentFit="cover" transition={LIVE_FRAME_TRANSITION_MS} cachePolicy="none" /> : null}
      {uri !== null ? <LiveClipView uri={uri} live={live} muted={!main} onFailed={handleFailed} style={StyleSheet.absoluteFill} /> : null}
      <View style={styles.label} pointerEvents="none">
        <View style={styles.nameRow}>
          {main ? <Ionicons name="volume-high" size={IS_TV ? 26 : 16} color={COLORS.TEXT_PRIMARY} /> : null}
          <Text style={[styles.name, !main && styles.nameSmall]} numberOfLines={1}>
            {cleanLabel(channel.Name ?? "")}
          </Text>
        </View>
        {airing ? (
          <Text style={[styles.airing, !main && styles.airingSmall]} numberOfLines={1}>
            {airing}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export const MultiviewTile = memo(MultiviewTileComponent);

const styles = StyleSheet.create({
  tile: {
    position: "absolute",
    overflow: "hidden",
    backgroundColor: COLORS.MEDIA_BACKGROUND,
    borderWidth: CARD_FOCUS.BORDER_WIDTH_FOCUSED,
    borderColor: "transparent",
  },
  focused: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: CARD_FOCUS.GLOW_OPACITY,
    shadowRadius: IS_TV ? CARD_FOCUS.GLOW_RADIUS.tv : CARD_FOCUS.GLOW_RADIUS.phone,
  },
  logo: {
    position: "absolute",
    left: "25%",
    right: "25%",
    top: "20%",
    bottom: "35%",
  },
  label: {
    position: "absolute",
    left: IS_TV ? 16 : 8,
    right: IS_TV ? 16 : 8,
    bottom: IS_TV ? 12 : 6,
    gap: IS_TV ? 2 : 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 8 : 4,
  },
  name: {
    flexShrink: 1,
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 26 : 15,
    fontWeight: "600",
    textShadowColor: COLORS.TEXT_SHADOW,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  nameSmall: {
    fontSize: IS_TV ? 20 : 12,
  },
  airing: {
    color: COLORS.TEXT_BRIGHT,
    fontSize: IS_TV ? 20 : 12,
    textShadowColor: COLORS.TEXT_SHADOW,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  airingSmall: {
    fontSize: IS_TV ? 17 : 10,
  },
});
