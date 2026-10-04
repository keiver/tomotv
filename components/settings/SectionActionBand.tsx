import { SectionFooter } from "@/components/settings/SectionFooter";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React, { type ComponentProps } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

/** Shorter than a row, so the card's last band reads as a rule rather than another entry. */
const BAND_HEIGHT = Platform.isTV ? 56 : 38;
/** Carries the band to the 44pt minimum target without moving anything it draws. */
const TOUCH_SLOP = Math.max(0, Math.round((44 - BAND_HEIGHT) / 2));
const ICON_SIZE = Platform.isTV ? 28 : 16;

interface SectionActionBandProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** Presses drop and the band dims; it stays focusable so TV focus is never ejected. */
  disabled?: boolean;
  hint?: string;
  layout?: ComponentProps<typeof SectionFooter>["layout"];
}

/**
 * One destructive action as the band a section card ends in, the storage gauge's shape: full
 * width, square across the top, the card's corners at the bottom. Phone wraps it in
 * SectionFooter; tvOS leaves it bare because the footer's overlay would occlude it from focus.
 */
export function SectionActionBand({ icon, label, onPress, disabled = false, hint, layout }: SectionActionBandProps) {
  const band = (
    <Pressable
      style={[styles.band, disabled && styles.bandDisabled]}
      onPress={disabled ? undefined : onPress}
      hitSlop={{ top: TOUCH_SLOP, bottom: TOUCH_SLOP }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      tvParallaxProperties={{ enabled: false }}>
      {({ focused }) => (
        <>
          <View style={styles.row} pointerEvents="none">
            <Ionicons name={icon} size={ICON_SIZE} color={COLORS.TEXT_PRIMARY} style={styles.mark} />
            <Text style={styles.label}>{label}</Text>
          </View>
          {focused ? <View style={styles.focusRing} pointerEvents="none" /> : null}
        </>
      )}
    </Pressable>
  );
  return Platform.isTV ? band : <SectionFooter layout={layout}>{band}</SectionFooter>;
}

const styles = StyleSheet.create({
  band: {
    minHeight: BAND_HEIGHT,
    justifyContent: "center",
    backgroundColor: COLORS.DESTRUCTIVE,
  },
  bandDisabled: {
    opacity: 0.5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Platform.isTV ? 12 : 7,
    paddingHorizontal: Platform.isTV ? 28 : 16,
    paddingVertical: Platform.isTV ? 10 : 6,
  },
  focusRing: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 4,
    borderColor: COLORS.BORDER_FOCUSED,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  // The glyph's own bowl sits low against the label's cap height.
  mark: {
    transform: [{ translateY: -1 }],
  },
  label: {
    flexShrink: 1,
    textAlign: "center",
    color: COLORS.TEXT_PRIMARY,
    fontSize: Platform.isTV ? 24 : 13,
    fontWeight: "500",
  },
});
