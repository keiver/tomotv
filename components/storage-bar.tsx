import { settingsStyles } from "@/components/settings/styles";
import { CONTROL_HEIGHT } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { formatFileSize } from "@/utils/mediaInfo";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

/** Enough of the fill to stay visible once a few megabytes are the whole of it. */
const MIN_VISIBLE_FRACTION = 0.015;

interface StorageBarProps {
  /** Bytes the downloads take up. */
  used: number;
  /** Bytes still free on the device. */
  free: number;
}

/**
 * How much of the device the downloads hold, drawn as the whole card: bright gold to the used
 * fraction, muted gold past it, the reading centred over both. The two tones are the pairing
 * ProgressButton uses, and they carry one ink — a gold-to-dark split would need two.
 */
export function StorageBar({ used, free }: StorageBarProps) {
  const total = used + free;
  const fraction = total > 0 ? used / total : 0;
  const percent = Math.min(100, Math.max(used > 0 ? MIN_VISIBLE_FRACTION * 100 : 0, fraction * 100));
  const label = `${used > 0 ? `${formatFileSize(used)} downloaded` : "Nothing downloaded"} · ${formatFileSize(free)} free`;

  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
      <View style={[styles.fill, { width: `${percent}%` }]} />
      {/* The card's inset shadow, re-painted above the opaque fill that covers it (the same
          move video-info makes over its artwork header). Safe to layer here only because
          nothing in this card takes focus. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, settingsStyles.rowShadowTopBottom]} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // One control tall, so the card reads as a deliberate gauge rather than a short row.
  track: {
    minHeight: CONTROL_HEIGHT,
    borderRadius: 32,
    overflow: "hidden",
    justifyContent: "center",
    backgroundColor: COLORS.ACCENT_DIM,
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: COLORS.ACCENT,
  },
  label: {
    textAlign: "center",
    paddingHorizontal: Platform.isTV ? 28 : 16,
    color: COLORS.ON_ACCENT_WARM,
    fontSize: Platform.isTV ? 26 : 15,
    fontWeight: "500",
  },
});
