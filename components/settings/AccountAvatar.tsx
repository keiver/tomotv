import { AvatarDisc } from "@/components/settings/AvatarDisc";
import { AvatarLoadingRing } from "@/components/settings/AvatarLoadingRing";
import { AVATAR_CAPTION_LINE, AVATAR_CELL_WIDTH, AVATAR_SIZE, AVATAR_SUBCAPTION_LINE, IS_PAD } from "@/components/settings/styles";
import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import { forwardRef, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const RING = IS_TV ? 4 : 2;
/** Air between the ring and the disc. */
const RING_GAP = IS_TV ? 4 : 2;
const BADGE = IS_TV ? 30 : 20;
const RING_RADIUS = (AVATAR_SIZE + 2 * (RING + RING_GAP)) / 2;
const CELL_PAD = IS_TV ? 12 : 6;
const CELL_RADIUS = IS_TV ? 28 : 16;

interface AccountAvatarProps {
  label: string;
  /** The server the account lives on, under the name. */
  sublabel?: string;
  /** The picture Jellyfin holds for this user; until it loads, and if it never does, the generated face shows. */
  uri?: string;
  /** The account the app is signed in as: the green ring and badge, green being connected. */
  connected?: boolean;
  /** This account is connecting: an arc turns in the ring. */
  loading?: boolean;
  /** The cell sits on the gold panel (TV): every mark takes the bar's ink. */
  onGold?: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** tvOS focus arrival, for the strip's ends to pin its scroll offset. */
  onFocus?: () => void;
  onBlur?: () => void;
  /** tvOS: the native node Left lands on, the row that led into the column. */
  nextFocusLeft?: number;
}

/**
 * One person in the strip: a round avatar with the name and server under it. A press
 * continues as that account. Focus (tvOS) is a white ring; on the gold panel the whole
 * cell also drops to the card's surface, the inverse of a row lighting up gold.
 * Forwards its ref to the Pressable, so a focus guide can name it.
 */
export const AccountAvatar = forwardRef<View, AccountAvatarProps>(function AccountAvatar(
  { label, sublabel, uri, connected = false, loading = false, onGold = false, onPress, disabled = false, onFocus, onBlur, nextFocusLeft }: AccountAvatarProps,
  ref,
) {
  // Fabric resolves nextFocus* tags against the root view when the prop is applied, and a new
  // view gets its props before it is inserted, so the target is set only once mounted.
  const [leftTarget, setLeftTarget] = useState<number | undefined>(undefined);
  useEffect(() => setLeftTarget(nextFocusLeft), [nextFocusLeft]);

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      nextFocusLeft={leftTarget}
      disabled={disabled}
      isTVSelectable={!disabled}
      tvParallaxProperties={{ enabled: false }}
      style={({ pressed, focused }) => [styles.cell, onGold && styles.cellOnGold, onGold && focused && styles.cellFocusedOnGold, pressed && styles.cellPressed, disabled && styles.cellDisabled]}
      accessibilityRole="button"
      accessibilityLabel={[`Continue as ${label}`, sublabel].filter(Boolean).join(", ")}
      accessibilityState={{ selected: connected, disabled, busy: loading }}>
      {({ focused }) => {
        // Marks sit on gold only while the cell is at rest there; focus paints it dark again.
        const inkOnGold = onGold && !focused;
        return (
          <>
            <View style={[styles.ring, connected && styles.ringConnected, focused && styles.ringFocused]} collapsable={false}>
              <AvatarDisc seed={label} uri={uri} size={AVATAR_SIZE} />
              {loading ? <AvatarLoadingRing width={RING} radius={RING_RADIUS} color={inkOnGold ? CARD_FOCUS.TITLE_TEXT_FOCUSED : COLORS.ACCENT} /> : null}
              {connected ? (
                <View style={[styles.badge, inkOnGold && styles.badgeOnGold]}>
                  <Ionicons name="checkmark" size={BADGE * 0.7} color={COLORS.TEXT_PRIMARY} />
                </View>
              ) : null}
            </View>
            <Text style={[styles.caption, (connected || focused) && styles.captionStrong, inkOnGold && styles.captionOnGold]} numberOfLines={1}>
              {label}
            </Text>
            {sublabel ? (
              <Text style={[styles.subcaption, inkOnGold && styles.subcaptionOnGold]} numberOfLines={1}>
                {sublabel}
              </Text>
            ) : null}
          </>
        );
      }}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  cell: {
    width: AVATAR_CELL_WIDTH,
    alignItems: "center",
  },
  // Room for the focus fill to wrap the disc and both captions.
  cellOnGold: {
    paddingVertical: CELL_PAD,
    borderRadius: CELL_RADIUS,
  },
  cellFocusedOnGold: {
    backgroundColor: COLORS.SURFACE,
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
    borderRadius: RING_RADIUS,
  },
  ringConnected: {
    borderColor: COLORS.SUCCESS,
  },
  ringFocused: {
    borderColor: COLORS.BORDER_FOCUSED,
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
  badgeOnGold: {
    borderColor: CARD_FOCUS.TITLE_BG_FOCUSED,
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
  captionOnGold: {
    color: CARD_FOCUS.TITLE_TEXT_FOCUSED,
  },
  subcaption: {
    fontSize: IS_TV ? 17 : IS_PAD ? 12 : 11,
    lineHeight: AVATAR_SUBCAPTION_LINE,
    color: COLORS.TEXT_TERTIARY,
    maxWidth: AVATAR_CELL_WIDTH,
  },
  subcaptionOnGold: {
    color: "rgba(43, 31, 5, 0.75)",
  },
});
