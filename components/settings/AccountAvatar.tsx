import { AVATAR_CAPTION_LINE, AVATAR_CELL_WIDTH, AVATAR_SIZE, AVATAR_SUBCAPTION_LINE, IS_PAD } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const RING = IS_TV ? 4 : 2;
/** Air between the ring and the disc. */
const RING_GAP = IS_TV ? 4 : 2;
const BADGE = IS_TV ? 30 : 20;
const INITIAL_SIZE = Math.round(AVATAR_SIZE * 0.42);

interface AccountAvatarProps {
  label: string;
  /** The server the account lives on, under the name. */
  sublabel?: string;
  /** The picture Jellyfin holds for this user; absent or 404 draws the initial instead. */
  uri?: string;
  /** The account the app is signed in as: the green ring and badge, green being connected. */
  connected?: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** tvOS focus arrival, for the strip's ends to pin its scroll offset. */
  onFocus?: () => void;
}

/**
 * One person in the strip: a round avatar with the name and server under it. A press
 * continues as that account. Focus (tvOS) is a white ring; the connected ring is gold.
 */
export function AccountAvatar({ label, sublabel, uri, connected = false, onPress, disabled = false, onFocus }: AccountAvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = !!uri && !failed;

  return (
    <Pressable
      onPress={onPress}
      onFocus={onFocus}
      disabled={disabled}
      isTVSelectable={!disabled}
      tvParallaxProperties={{ enabled: false }}
      style={({ pressed }) => [styles.cell, pressed && styles.cellPressed, disabled && styles.cellDisabled]}
      accessibilityRole="button"
      accessibilityLabel={[`Continue as ${label}`, sublabel].filter(Boolean).join(", ")}
      accessibilityState={{ selected: connected, disabled }}>
      {({ focused }) => (
        <>
          <View style={[styles.ring, connected && styles.ringConnected, focused && styles.ringFocused]} collapsable={false}>
            <View style={styles.disc} collapsable={false}>
              {showImage ? (
                <Image source={{ uri }} style={styles.image} contentFit="cover" onError={() => setFailed(true)} accessible={false} />
              ) : (
                <Text style={styles.initial}>{label.trim().charAt(0).toUpperCase()}</Text>
              )}
            </View>
            {connected ? (
              <View style={styles.badge}>
                <Ionicons name="checkmark" size={BADGE * 0.7} color={COLORS.TEXT_PRIMARY} />
              </View>
            ) : null}
          </View>
          <Text style={[styles.caption, (connected || focused) && styles.captionStrong]} numberOfLines={1}>
            {label}
          </Text>
          {sublabel ? (
            <Text style={styles.subcaption} numberOfLines={1}>
              {sublabel}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    width: AVATAR_CELL_WIDTH,
    alignItems: "center",
  },
  cellPressed: {
    opacity: 0.6,
  },
  cellDisabled: {
    opacity: 0.5,
  },
  ring: {
    padding: RING_GAP,
    borderWidth: RING,
    borderColor: "transparent",
    borderRadius: (AVATAR_SIZE + 2 * (RING + RING_GAP)) / 2,
  },
  ringConnected: {
    borderColor: COLORS.SUCCESS,
  },
  ringFocused: {
    borderColor: COLORS.BORDER_FOCUSED,
  },
  disc: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  badge: {
    position: "absolute",
    right: -RING,
    bottom: -RING,
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.SUCCESS,
    borderWidth: 2,
    borderColor: COLORS.SURFACE,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  initial: {
    fontSize: INITIAL_SIZE,
    fontWeight: "600",
    color: COLORS.TEXT_PRIMARY,
  },
  caption: {
    marginTop: IS_TV ? 8 : 6,
    fontSize: IS_TV ? 20 : IS_PAD ? 14 : 13,
    lineHeight: AVATAR_CAPTION_LINE,
    color: COLORS.TEXT_SECONDARY,
    maxWidth: AVATAR_CELL_WIDTH,
  },
  captionStrong: {
    color: COLORS.TEXT_PRIMARY,
    fontWeight: "600",
  },
  subcaption: {
    fontSize: IS_TV ? 17 : IS_PAD ? 12 : 11,
    lineHeight: AVATAR_SUBCAPTION_LINE,
    color: COLORS.TEXT_TERTIARY,
    maxWidth: AVATAR_CELL_WIDTH,
  },
});
