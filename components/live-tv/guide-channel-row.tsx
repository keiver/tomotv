import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import { Image } from "expo-image";
import React, { useCallback, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
/** The info panel's station tile gray (RCTUpNextInfoViewController), so black logos read. */
const LOGO_TILE = "#7C7C80";
const LOGO_W = IS_TV ? 88 : 52;
const PAD_LEFT = IS_TV ? 8 : 6;
const PAD_RIGHT = IS_TV ? 14 : 8;
/** The column width that shows the logo tile alone, snug against both edges; the left magnet lands here. */
export const LOGO_ONLY_WIDTH = PAD_LEFT + LOGO_W + PAD_RIGHT + 2;

interface GuideChannelRowProps {
  channel: JellyfinItem;
  height: number;
  /** Collapsed to the logo alone once the column is dragged to the left magnet. */
  compact?: boolean;
  onPress: (channel: JellyfinItem) => void;
  onFocus?: () => void;
}

/** One channel beside its guide row. Select tunes it; focus is a gold line, no scale (grid rule). */
function GuideChannelRowComponent({ channel, height, compact, onPress, onFocus }: GuideChannelRowProps) {
  const [focused, setFocused] = useState(false);
  const press = useCallback(() => onPress(channel), [onPress, channel]);
  const handleFocus = useCallback(() => {
    setFocused(true);
    onFocus?.();
  }, [onFocus]);
  const handleBlur = useCallback(() => setFocused(false), []);

  return (
    <Pressable
      onPress={press}
      onFocus={handleFocus}
      onBlur={handleBlur}
      isTVSelectable
      tvParallaxProperties={{ enabled: false }}
      accessibilityRole="button"
      accessibilityLabel={channel.Name}
      style={[styles.channel, { height }, focused && styles.channelFocused]}>
      {compact || !channel.ChannelNumber ? null : (
        <Text style={styles.number} numberOfLines={1}>
          {channel.ChannelNumber}
        </Text>
      )}
      <View style={styles.logo}>
        {hasPoster(channel) ? (
          <Image source={{ uri: getPosterUrl(channel.Id, IS_TV ? 180 : 96) }} style={styles.logoImage} contentFit="contain" transition={150} />
        ) : (
          // No logo: the brand face, the same mark the cards fall back to.
          <Image source={require("@/assets/brand/layer-front.png")} style={styles.placeholderFace} contentFit="cover" transition={0} />
        )}
      </View>
      {compact ? null : (
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
          {channel.Name}
        </Text>
      )}
    </Pressable>
  );
}

export const GuideChannelRow = React.memo(GuideChannelRowComponent);

const styles = StyleSheet.create({
  // A transparent line at rest, so focus recolours it without shifting the row.
  // Top-aligned with the grid cell's own top padding so a channel sits level with its programs.
  channel: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: IS_TV ? 14 : 8,
    paddingLeft: PAD_LEFT,
    paddingRight: PAD_RIGHT,
    paddingTop: IS_TV ? 14 : 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  channelFocused: {
    borderColor: COLORS.ACCENT,
  },
  number: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 20 : 12,
    fontWeight: "700",
    minWidth: IS_TV ? 44 : 26,
  },
  logo: {
    width: LOGO_W,
    height: IS_TV ? 60 : 38,
    borderRadius: DESIGN.BORDER_RADIUS_SMALL,
    borderWidth: 1,
    borderColor: GRID_LINE,
    backgroundColor: LOGO_TILE,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  logoImage: {
    position: "absolute",
    top: IS_TV ? 4 : 2,
    left: IS_TV ? 4 : 2,
    right: IS_TV ? 4 : 2,
    bottom: IS_TV ? 4 : 2,
  },
  placeholderFace: {
    width: IS_TV ? 48 : 28,
    height: IS_TV ? 48 : 28,
  },
  name: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 21 : 13,
    fontWeight: "600",
    flexShrink: 1,
  },
});
