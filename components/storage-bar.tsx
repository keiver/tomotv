import { COLORS } from "@/constants/colors";
import { formatFileSize } from "@/utils/mediaInfo";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

/** Enough of the fill to stay visible once a few megabytes are the whole of it. */
const MIN_VISIBLE_FRACTION = 0.015;

/** Shorter than a row, so the card's last band reads as a rule rather than another entry. */
const BAR_HEIGHT = Platform.isTV ? 56 : 38;

/** A step over the label, so the mark reads as the action and not as punctuation. */
const ICON_SIZE = Platform.isTV ? 28 : 16;

interface StorageBarProps {
  /** Bytes the downloads take up. */
  used: number;
  /** Bytes still free on the device. */
  free: number;
  /** Clears every download, behind a confirmation. The only route to downloadManager.removeAll in the app. */
  onClear: () => void;
}

/**
 * How much of the device the downloads hold, drawn as the band a section card ends in: bright
 * gold to the used fraction, muted gold past it, the reading centred over both. The two tones
 * are the pairing ProgressButton uses, and they carry one ink, gold to dark would need two.
 * Square-cornered; the SectionFooter it sits in owns the shape. Pressing it clears everything.
 */
export function StorageBar({ used, free, onClear }: StorageBarProps) {
  const total = used + free;
  const fraction = total > 0 ? used / total : 0;
  const percent = Math.min(100, Math.max(used > 0 ? MIN_VISIBLE_FRACTION * 100 : 0, fraction * 100));
  const label = `${used > 0 ? `${formatFileSize(used)} downloaded` : "Nothing downloaded"} · ${formatFileSize(free)} free`;

  return (
    <Pressable
      style={styles.track}
      onPress={onClear}
      onLongPress={onClear}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Press and hold to remove every download from this device"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
      <View style={[styles.fill, { width: `${percent}%` }]} pointerEvents="none" />
      <View style={styles.row} pointerEvents="none">
        <Ionicons name="trash-outline" size={ICON_SIZE} color={COLORS.ON_ACCENT_WARM} style={styles.mark} />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Platform.isTV ? 12 : 7,
    paddingHorizontal: Platform.isTV ? 28 : 16,
  },
  // The glyph's own bowl sits low against the label's cap height.
  mark: {
    transform: [{ translateY: -1 }],
  },
  label: {
    flexShrink: 1,
    color: COLORS.ON_ACCENT_WARM,
    fontSize: Platform.isTV ? 24 : 13,
    fontWeight: "500",
  },
});
