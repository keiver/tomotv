import { COLORS } from "@/constants/colors";
import { formatFileSize } from "@/utils/mediaInfo";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

/** Enough of the fill to stay visible once a few megabytes are the whole of it. */
const MIN_VISIBLE_FRACTION = 0.015;

/** A gauge, not a control: shorter than a row, so the card's last band reads as a rule. */
const BAR_HEIGHT = Platform.isTV ? 56 : 38;

interface StorageBarProps {
  /** Bytes the downloads take up. */
  used: number;
  /** Bytes still free on the device. */
  free: number;
}

/**
 * How much of the device the downloads hold, drawn as the band a section card ends in: bright
 * gold to the used fraction, muted gold past it, the reading centred over both. The two tones
 * are the pairing ProgressButton uses, and they carry one ink — gold to dark would need two.
 * Square-cornered; the SectionFooter it sits in owns the shape.
 */
export function StorageBar({ used, free }: StorageBarProps) {
  const total = used + free;
  const fraction = total > 0 ? used / total : 0;
  const percent = Math.min(100, Math.max(used > 0 ? MIN_VISIBLE_FRACTION * 100 : 0, fraction * 100));
  const label = `${used > 0 ? `${formatFileSize(used)} downloaded` : "Nothing downloaded"} · ${formatFileSize(free)} free`;

  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
      <View style={[styles.fill, { width: `${percent}%` }]} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: BAR_HEIGHT,
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
    fontSize: Platform.isTV ? 24 : 13,
    fontWeight: "500",
  },
});
