import { SectionFooter } from "@/components/settings/SectionFooter";
import { COLORS } from "@/constants/colors";
import { themedStyles, useCardPalette } from "@/hooks/useCardPalette";
import { formatFileSize } from "@/utils/mediaInfo";
import { Ionicons } from "@expo/vector-icons";
import React, { type ComponentProps } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { t } from "@/services/i18n";

/** A floor wide enough that the fill reads as a bar, not a sliver, when little is used. */
const MIN_VISIBLE_FRACTION = 0.06;

/** Shorter than a row, so the card's last band reads as a rule rather than another entry. */
const BAR_HEIGHT = Platform.isTV ? 56 : 38;

/** Carries the band to the 44pt minimum target without moving anything it draws. */
const TOUCH_SLOP = Math.max(0, Math.round((44 - BAR_HEIGHT) / 2));

/** A step over the label, so the mark reads as the action and not as punctuation. */
const ICON_SIZE = Platform.isTV ? 28 : 16;

/** The band's math: used fraction, the drawn percent (floored so a sliver still
 *  reads, capped at 100), and the rounded accessibility value. */
export function storageBarFill(used: number, free: number): { fraction: number; percent: number; accessibleNow: number } {
  const total = used + free;
  const fraction = total > 0 ? used / total : 0;
  const percent = Math.min(100, Math.max(used > 0 ? MIN_VISIBLE_FRACTION * 100 : 0, fraction * 100));
  return { fraction, percent, accessibleNow: Math.round(fraction * 100) };
}

interface StorageBarProps {
  /** Bytes the downloads take up. */
  used: number;
  /** Bytes still free on the device. */
  free: number;
  /** Clears what `used` counts, behind a confirmation. Omitted, the band is a reading only. */
  onClear?: () => void;
  /** Replaces the downloads wording of the used part. */
  usedLabel?: string;
  /** Replaces the whole reading. */
  label?: string;
  /** Overrides the red storage fill for readings such as successful channel matches. */
  fillColor?: string;
  hint?: string;
  layout?: ComponentProps<typeof SectionFooter>["layout"];
}

/**
 * How much of the device the downloads hold, drawn as the band a section card ends in: an accent
 * track the used fraction fills red across its full height, the reading centred over it.
 * It is its card's footer: phone wraps it in SectionFooter, tvOS leaves it bare because the
 * footer's overlay would occlude it from focus. Pressing it clears everything.
 */
export function StorageBar({ used, free, onClear, usedLabel, label: reading, fillColor = COLORS.DESTRUCTIVE, hint, layout }: StorageBarProps) {
  const { percent, accessibleNow } = storageBarFill(used, free);
  const usedPart = usedLabel ?? (used > 0 ? t("downloads.usedDownloaded").replace("{size}", formatFileSize(used)) : t("downloads.nothingDownloaded"));
  const label = reading ?? t("downloads.freeStorage").replace("{used}", usedPart).replace("{free}", formatFileSize(free));
  const palette = useCardPalette();
  const themed = useThemedStyles();

  const bar = !onClear ? (
    <View style={[styles.track, themed.track]} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: accessibleNow }}>
      <View style={[styles.fill, { width: `${percent}%`, backgroundColor: fillColor }]} />
      <View style={styles.row}>
        <Text style={[styles.label, themed.label]}>{label}</Text>
      </View>
    </View>
  ) : (
    <Pressable
      style={[styles.track, themed.track]}
      onPress={onClear}
      onLongPress={onClear}
      hitSlop={{ top: TOUCH_SLOP, bottom: TOUCH_SLOP }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint ?? t("downloads.removeAllHint")}
      accessibilityValue={{ min: 0, max: 100, now: accessibleNow }}
      tvParallaxProperties={{ enabled: false }}>
      {({ focused }) => (
        <>
          <View style={[styles.fill, { width: `${percent}%`, backgroundColor: fillColor }]} pointerEvents="none" />
          <View style={styles.row} pointerEvents="none">
            <Ionicons name="trash-outline" size={ICON_SIZE} color={palette.onAccent} style={styles.mark} />
            {/* Unclamped: at the accessibility text sizes the reading is wider than the band, and
                wrapping it is the difference between a long reading and half a reading. */}
            <Text style={[styles.label, themed.label]}>{label}</Text>
          </View>
          {/* tvOS: the band is the accent at rest, so focus is a ring rather than a fill. */}
          {focused ? <View style={styles.focusRing} pointerEvents="none" /> : null}
        </>
      )}
    </Pressable>
  );
  return Platform.isTV ? bar : <SectionFooter layout={layout}>{bar}</SectionFooter>;
}

const styles = StyleSheet.create({
  // A floor rather than a fixed height: the reading grows with Dynamic Type and a band that
  // cannot follow it cuts it off.
  track: {
    minHeight: BAR_HEIGHT,
    justifyContent: "center",
  },
  // The used space, filling the whole band from the left to the used fraction.
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
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
    fontSize: Platform.isTV ? 24 : 13,
    fontWeight: "500",
  },
});

const useThemedStyles = themedStyles((palette) => ({
  track: {
    backgroundColor: palette.accent,
  },
  label: {
    color: palette.onAccent,
  },
}));
