import { COLORS } from "@/constants/colors";
import { formatFileSize } from "@/utils/mediaInfo";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

/** Enough of the track to stay visible once a few megabytes are the whole of it. */
const MIN_VISIBLE_FRACTION = 0.015;

interface StorageBarProps {
  /** Bytes the downloads take up. */
  used: number;
  /** Bytes still free on the device. */
  free: number;
}

/**
 * A stat line, not a control: how much of the device the downloads hold, drawn as one bar.
 *
 * Deliberately outside the sunken section style the settings rows use — nothing here is
 * pressable, and a card would offer an affordance that does not exist.
 */
export function StorageBar({ used, free }: StorageBarProps) {
  const total = used + free;
  const fraction = total > 0 ? used / total : 0;
  const width = `${Math.min(100, Math.max(used > 0 ? MIN_VISIBLE_FRACTION * 100 : 0, fraction * 100))}%` as const;

  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel={`${formatFileSize(used) || "Nothing"} downloaded, ${formatFileSize(free)} free`}>
      <View style={styles.track}>
        <View style={[styles.fill, { width }]} />
      </View>
      <View style={styles.legend}>
        <Text style={styles.used}>{used > 0 ? `${formatFileSize(used)} downloaded` : "Nothing downloaded"}</Text>
        <Text style={styles.free}>{formatFileSize(free)} free</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
  fill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: COLORS.ACCENT,
  },
  legend: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  used: {
    color: COLORS.TEXT_BODY,
    fontSize: 13,
  },
  free: {
    color: COLORS.TEXT_TERTIARY,
    fontSize: 13,
  },
});
