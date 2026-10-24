import { AvatarDisc } from "@/components/settings/AvatarDisc";
import { AvatarLoadingRing } from "@/components/settings/AvatarLoadingRing";
import { AVATAR_CAPTION_LINE, AVATAR_CELL_WIDTH, AVATAR_SIZE, AVATAR_SUBCAPTION_LINE, IS_PAD } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { themedStyles, useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import { withAlpha } from "@/utils/color";
import { Ionicons } from "@expo/vector-icons";
import { forwardRef, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const RING = IS_TV ? 4 : 2;
/** Air between the ring and the disc. */
const RING_GAP = IS_TV ? 4 : 2;
const BADGE = IS_TV ? 30 : 20;
const CELL_PAD = IS_TV ? 12 : 6;
const CELL_RADIUS = IS_TV ? 28 : 16;

interface AccountAvatarProps {
  label: string;
  /** The server the account lives on, under the name. */
  sublabel?: string;
  /** The picture Jellyfin holds for this user; until it loads, and if it never does, the generated face shows. */
  uri?: string;
  /** A glyph in an outlined ring in place of a face: the Add Server cell. */
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  /** The face's diameter when larger than the strip's; the cell and captions grow with it. */
  size?: number;
  /** The account the app is signed in as: the green ring and badge, green being connected. */
  connected?: boolean;
  /** This account is connecting: an arc turns in the ring. */
  loading?: boolean;
  /** The cell sits on the gold panel (TV): every mark takes the bar's ink. */
  onGold?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
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
  { label, sublabel, uri, icon, size, connected = false, loading = false, onGold = false, onPress, onLongPress, disabled = false, onFocus, onBlur, nextFocusLeft }: AccountAvatarProps,
  ref,
) {
  // Fabric resolves nextFocus* tags against the root view when the prop is applied, and a new
  // view gets its props before it is inserted, so the target is set only once mounted.
  const [leftTarget, setLeftTarget] = useState<number | undefined>(undefined);
  useEffect(() => setLeftTarget(nextFocusLeft), [nextFocusLeft]);
  const palette = useCardPalette();
  const themed = useThemedStyles();
  const large = size !== undefined;
  const face = size ?? AVATAR_SIZE;
  const cellWidth = large ? face + (IS_TV ? 72 : 32) : AVATAR_CELL_WIDTH;
  const ringRadius = (face + 2 * (RING + RING_GAP)) / 2;

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      onLongPress={onLongPress}
      onFocus={onFocus}
      onBlur={onBlur}
      nextFocusLeft={leftTarget}
      disabled={disabled}
      isTVSelectable={!disabled}
      tvParallaxProperties={{ enabled: false }}
      style={({ pressed, focused }) => [
        styles.cell,
        { width: cellWidth },
        onGold && styles.cellOnGold,
        onGold && focused && styles.cellFocusedOnGold,
        pressed && styles.cellPressed,
        disabled && styles.cellDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={icon ? label : [t("settings.continueAs").replace("{label}", label), sublabel].filter(Boolean).join(", ")}
      accessibilityState={{ selected: connected, disabled, busy: loading }}>
      {({ focused }) => {
        // Marks sit on gold only while the cell is at rest there; focus paints it dark again.
        const inkOnGold = onGold && !focused;
        return (
          <>
            <View style={[styles.ring, { borderRadius: ringRadius }, connected && styles.ringConnected, focused && styles.ringFocused]} collapsable={false}>
              {icon ? (
                <View style={[styles.glyphRing, { width: face, height: face, borderRadius: face / 2 }]}>
                  <Ionicons name={icon} size={face * 0.45} color={focused ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY} />
                </View>
              ) : (
                <AvatarDisc seed={label} uri={uri} size={face} />
              )}
              {loading ? <AvatarLoadingRing width={RING} radius={ringRadius} color={inkOnGold ? palette.ink : palette.accent} /> : null}
              {connected ? (
                <View style={[styles.badge, inkOnGold && themed.badgeOnGold]}>
                  <Ionicons name="checkmark" size={BADGE * 0.7} color={COLORS.TEXT_PRIMARY} />
                </View>
              ) : null}
            </View>
            <Text style={[styles.caption, large && styles.captionLarge, (connected || focused) && styles.captionStrong, inkOnGold && themed.captionOnGold]} numberOfLines={1}>
              {label}
            </Text>
            {sublabel ? (
              <Text style={[styles.subcaption, large && styles.subcaptionLarge, inkOnGold && themed.subcaptionOnGold]} numberOfLines={1}>
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
  },
  ringConnected: {
    borderColor: COLORS.SUCCESS,
  },
  ringFocused: {
    borderColor: COLORS.BORDER_FOCUSED,
  },
  glyphRing: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: RING,
    borderColor: COLORS.SURFACE_MUTED,
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
  caption: {
    marginTop: IS_TV ? 8 : 6,
    fontSize: IS_TV ? 20 : IS_PAD ? 14 : 13,
    lineHeight: AVATAR_CAPTION_LINE,
    color: COLORS.TEXT_SECONDARY,
    maxWidth: AVATAR_CELL_WIDTH,
  },
  captionLarge: {
    marginTop: IS_TV ? 20 : 10,
    fontSize: IS_TV ? 28 : IS_PAD ? 17 : 15,
    lineHeight: IS_TV ? 34 : IS_PAD ? 22 : 20,
    maxWidth: undefined,
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
  subcaptionLarge: {
    fontSize: IS_TV ? 22 : IS_PAD ? 14 : 13,
    lineHeight: IS_TV ? 28 : IS_PAD ? 18 : 17,
    maxWidth: undefined,
  },
});

// On the accent panel: the fill's colour round the badge, its ink on the captions.
const useThemedStyles = themedStyles((palette) => ({
  badgeOnGold: {
    borderColor: palette.accent,
  },
  captionOnGold: {
    color: palette.ink,
  },
  subcaptionOnGold: {
    color: withAlpha(palette.ink, 0.75),
  },
}));
