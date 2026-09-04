import { COLORS } from "@/constants/colors";
import { formatFileSize } from "@/utils/mediaInfo";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

/** Enough of the fill to stay visible once a few megabytes are the whole of it. */
const MIN_VISIBLE_FRACTION = 0.015;

/** Shorter than a row, so the card's last band reads as a rule rather than another entry. */
const BAR_HEIGHT = Platform.isTV ? 56 : 38;

/** Carries the band to the 44pt minimum target without moving anything it draws. */
const TOUCH_SLOP = Math.max(0, Math.round((44 - BAR_HEIGHT) / 2));

/** A step over the label, so the mark reads as the action and not as punctuation. */
const ICON_SIZE = Platform.isTV ? 28 : 16;

/** The used fraction, drawn as a rule along the band's top edge. */
const FILL_HEIGHT = Platform.isTV ? 6 : 3;

/** DESTRUCTIVE at 0.22: a red wash the card shows through, the tone of what pressing it does. */
const BAND_WASH = `${COLORS.DESTRUCTIVE}38`;

interface StorageBarProps {
  /** Bytes the downloads take up. */
  used: number;
  /** Bytes still free on the device. */
  free: number;
  /** Clears every download, behind a confirmation. The only route to downloadManager.removeAll in the app. */
  onClear: () => void;
}

/**
 * How much of the device the downloads hold, drawn as the band a section card ends in: a red
 * wash with a gold rule along its top edge to the used fraction, the reading centred under it.
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
      hitSlop={{ top: TOUCH_SLOP, bottom: TOUCH_SLOP }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Removes every download from this device, after a confirmation."
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
      <View style={[styles.fill, { width: `${percent}%` }]} pointerEvents="none" />
      <View style={styles.row} pointerEvents="none">
        <Ionicons name="trash-outline" size={ICON_SIZE} color={COLORS.TEXT_PRIMARY} style={styles.mark} />
        {/* Unclamped: at the accessibility text sizes the reading is wider than the band, and
            wrapping it is the difference between a long reading and half a reading. */}
        <Text style={styles.label}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A floor rather than a fixed height: the reading grows with Dynamic Type and a band that
  // cannot follow it cuts it off.
  track: {
    minHeight: BAR_HEIGHT,
    justifyContent: "center",
    backgroundColor: BAND_WASH,
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: FILL_HEIGHT,
    backgroundColor: COLORS.ACCENT,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Platform.isTV ? 12 : 7,
    paddingHorizontal: Platform.isTV ? 28 : 16,
    paddingVertical: Platform.isTV ? 10 : 6,
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
