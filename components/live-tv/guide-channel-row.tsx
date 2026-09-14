import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import { Image } from "expo-image";
import React, { useCallback, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface GuideChannelRowProps {
  channel: JellyfinItem;
  height: number;
  onPress: (channel: JellyfinItem) => void;
  onFocus?: () => void;
}

/** One channel beside its guide row. Select tunes it; focus is a gold line, no scale (grid rule). */
function GuideChannelRowComponent({ channel, height, onPress, onFocus }: GuideChannelRowProps) {
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
      {channel.ChannelNumber ? (
        <Text style={styles.number} numberOfLines={1}>
          {channel.ChannelNumber}
        </Text>
      ) : null}
      {hasPoster(channel) ? (
        <Image source={{ uri: getPosterUrl(channel.Id, IS_TV ? 120 : 60) }} style={styles.logo} contentFit="contain" transition={150} />
      ) : (
        // No logo: the brand face at logo size, the same mark the cards fall back to.
        <View style={[styles.logo, styles.logoPlaceholder]}>
          <Image source={require("@/assets/brand/layer-front.png")} style={styles.placeholderFace} contentFit="cover" transition={0} />
        </View>
      )}
      <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
        {channel.Name}
      </Text>
    </Pressable>
  );
}

export const GuideChannelRow = React.memo(GuideChannelRowComponent);

const styles = StyleSheet.create({
  // A transparent line at rest, so focus recolours it without shifting the row.
  channel: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 14 : 8,
    paddingLeft: IS_TV ? 8 : 6,
    paddingRight: IS_TV ? 14 : 8,
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
    width: IS_TV ? 64 : 36,
    height: IS_TV ? 44 : 26,
    borderRadius: DESIGN.BORDER_RADIUS_SMALL,
  },
  logoPlaceholder: {
    borderWidth: 1,
    borderColor: GRID_LINE,
    backgroundColor: COLORS.SURFACE_SUNKEN,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderFace: {
    width: IS_TV ? 36 : 20,
    height: IS_TV ? 36 : 20,
  },
  name: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 21 : 13,
    fontWeight: "600",
    flexShrink: 1,
  },
});
