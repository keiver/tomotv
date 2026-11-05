import { CARD_FOCUS, DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useLiveClip, useLiveFrame } from "@/hooks/useLiveFrame";
import { LIVE_FRAME_TRANSITION_MS } from "@/services/liveFrames";
import type { JellyfinItem } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { Ionicons } from "@expo/vector-icons";
import { LiveClipView, type MultiviewRect } from "@keiver/tomo-live";
import { Image } from "expo-image";
import React, { memo, useCallback, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const IS_TV = Platform.isTV;

interface MultiviewTileProps {
  channel: JellyfinItem;
  rect: MultiviewRect;
  main: boolean;
  /** The tile's live session, null while it shows its clip or picture. */
  liveUrl: string | null;
  frozen: boolean;
  /** False while the screen is covered: the tile lets its player go. */
  visible: boolean;
  hasTVPreferredFocus?: boolean;
  onSelect: (channelId: string) => void;
  onFrozen: (channelId: string) => void;
  /** The tile's player failed, or none was free for its live session. */
  onFailed: (channelId: string) => void;
  onLongPress?: () => void;
}

/** One multiview tile: its live session when it has one, else its clip, else its picture, under the channel's name. */
function MultiviewTileComponent({ channel, rect, main, liveUrl, frozen, visible, hasTVPreferredFocus, onSelect, onFrozen, onFailed, onLongPress }: MultiviewTileProps) {
  const { accent } = useCardPalette();
  const frame = useLiveFrame(channel.Id);
  const clip = useLiveClip(channel.Id);
  const [focused, setFocused] = useState(false);
  const handlePress = useCallback(() => onSelect(channel.Id), [onSelect, channel.Id]);
  const handleFrozen = useCallback(() => onFrozen(channel.Id), [onFrozen, channel.Id]);
  const handleFailed = useCallback(() => onFailed(channel.Id), [onFailed, channel.Id]);
  const live = !!liveUrl || frozen;
  const uri = visible ? (liveUrl ?? (frozen ? null : (clip?.uri ?? null))) : null;
  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={onLongPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      activeOpacity={0.95}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={cleanLabel(channel.Name ?? "")}
      style={[styles.tile, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }, focused && [styles.focused, { borderColor: accent, shadowColor: accent }]]}>
      {frame ? <Image source={frame} style={StyleSheet.absoluteFill} contentFit="cover" transition={LIVE_FRAME_TRANSITION_MS} cachePolicy="none" /> : null}
      {uri !== null || frozen ? <LiveClipView uri={uri} live={live} muted={!main} frozen={frozen} onFrozen={handleFrozen} onFailed={handleFailed} style={StyleSheet.absoluteFill} /> : null}
      <View style={styles.label} pointerEvents="none">
        {main ? <Ionicons name="volume-high" size={IS_TV ? 26 : 16} color={COLORS.TEXT_PRIMARY} /> : null}
        <Text style={[styles.name, !main && styles.nameSmall]} numberOfLines={1}>
          {cleanLabel(channel.Name ?? "")}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export const MultiviewTile = memo(MultiviewTileComponent);

const styles = StyleSheet.create({
  tile: {
    position: "absolute",
    borderRadius: DESIGN.BORDER_RADIUS_CARD,
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
  label: {
    position: "absolute",
    left: IS_TV ? 16 : 8,
    right: IS_TV ? 16 : 8,
    bottom: IS_TV ? 12 : 6,
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
});
