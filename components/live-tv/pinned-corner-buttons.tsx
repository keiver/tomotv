import { CloseOverlayButton } from "@/components/close-overlay-button";
import { GlassIconButton } from "@/components/glass-icon-button";
import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View } from "react-native";

export const PINNED_CORNER_BUTTON = 38;
const CORNER_ICON = 19;

/** The accent glow round a playing channel's buttons: on a view with no fill, iOS draws the shadow from its buttons. */
export function pinnedButtonGlow(accent: string) {
  return { shadowColor: accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: CARD_FOCUS.GLOW_OPACITY, shadowRadius: CARD_FOCUS.GLOW_RADIUS.phone };
}

export interface PinnedRecordButton {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  /** Shown beside the glyph while a recording runs: Stop Recording. */
  text?: string;
  onPress: () => void;
}

interface PinnedCornerButtonsProps {
  /** The glyphs, in the theme's accent. */
  accent: string;
  muted: boolean;
  onToggleMute: () => void;
  /** Record or stop, when the account may record this channel. */
  record?: PinnedRecordButton | null;
  /** The picture's size button, where the picture has two sizes. */
  size?: { extended: boolean; onToggle: () => void };
  onClose?: () => void;
  /** From the picture's top and right edges. */
  inset: { top: number; right: number };
  /** The accent glow round the buttons, where nothing around them draws it already. */
  glow?: boolean;
}

/** The buttons in a playing channel's top corner: mute, record, and where the picture has them, its size and close. */
export function PinnedCornerButtons({ accent, muted, onToggleMute, record, size, onClose, inset, glow }: PinnedCornerButtonsProps) {
  return (
    <View style={[styles.corner, inset, glow && pinnedButtonGlow(accent)]} pointerEvents="box-none">
      <GlassIconButton
        icon={muted ? "volume-mute-outline" : "volume-high-outline"}
        iconSize={CORNER_ICON}
        size={PINNED_CORNER_BUTTON}
        color={accent}
        onPress={onToggleMute}
        accessibilityLabel={t(muted ? "liveTv.unmute" : "liveTv.mute")}
      />
      {record ? (
        <View testID="guide-pinned-record">
          <GlassIconButton icon={record.icon} iconSize={CORNER_ICON} size={PINNED_CORNER_BUTTON} color={COLORS.DESTRUCTIVE} onPress={record.onPress} accessibilityLabel={record.label} />
        </View>
      ) : null}
      {size ? (
        <GlassIconButton
          icon={size.extended ? "contract-outline" : "expand-outline"}
          iconSize={CORNER_ICON}
          size={PINNED_CORNER_BUTTON}
          color={accent}
          onPress={size.onToggle}
          accessibilityLabel={t(size.extended ? "liveTv.smallerPicture" : "liveTv.largerPicture")}
        />
      ) : null}
      {onClose ? (
        <View testID="guide-pinned-close">
          <CloseOverlayButton onPress={onClose} color={accent} size={PINNED_CORNER_BUTTON} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  corner: {
    position: "absolute",
    flexDirection: "row",
    gap: 12,
  },
});
