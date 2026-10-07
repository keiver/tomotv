import { IS_PAD, useSettingsAccentStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { DESIGN } from "@/constants/app";
import { themedStyles, useCardPalette } from "@/hooks/useCardPalette";
import { withAlpha } from "@/utils/color";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface AccountPillProps {
  label: string;
  /** A glyph before the label: the platform a Diagnostics row speaks for. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** The row is on its accent fill: the pill takes the fill's own ink. */
  onGold: boolean;
  /** A tag beside a pill, not a peer: smaller type, tinted ink and border. */
  tag?: { tint: string };
}

/** A tight pill: a saved sign-in on a server card, the build on the Open Source page. */
export function AccountPill({ label, icon, onGold, tag }: AccountPillProps) {
  const palette = useCardPalette();
  const accentStyles = useSettingsAccentStyles();
  const themed = useThemedStyles();
  return (
    <View style={[styles.pill, onGold && themed.pillOnGold, tag && [styles.pillTag, { borderColor: tag.tint }]]}>
      {icon ? <Ionicons name={icon} size={IS_TV ? 18 : IS_PAD ? 13 : 12} color={onGold ? palette.ink : COLORS.TEXT_SECONDARY} /> : null}
      <Text style={[styles.label, onGold && accentStyles.listItemSubtitleFocused, tag && [styles.labelTag, { color: tag.tint }]]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 6 : 4,
    borderRadius: DESIGN.BORDER_RADIUS_ROUND,
    paddingVertical: IS_TV ? 3 : 2,
    paddingHorizontal: IS_TV ? 12 : 8,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    flexShrink: 1,
  },
  label: {
    fontSize: IS_TV ? 20 : IS_PAD ? 14 : 13,
    fontWeight: "600",
    color: COLORS.TEXT_SECONDARY,
  },
  pillTag: {
    paddingVertical: IS_TV ? 2 : 1,
    paddingHorizontal: IS_TV ? 9 : 6,
    backgroundColor: "transparent",
  },
  labelTag: {
    fontSize: IS_TV ? 15 : IS_PAD ? 11 : 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
});

// On the row's accent fill: the fill's own ink, faint.
const useThemedStyles = themedStyles((palette) => ({
  pillOnGold: {
    backgroundColor: withAlpha(palette.ink, 0.1),
    borderColor: withAlpha(palette.ink, 0.22),
  },
}));
