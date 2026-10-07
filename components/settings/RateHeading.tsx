import { goldRowShadow, settingsStyles, useSettingsAccentStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { t } from "@/services/i18n";

/** Sits on the header text's own line height. */
const GLYPH = Platform.isTV ? 28 : 16;

/** "16.3 Mbps" from bits per second, one decimal: the figure every rate heading shows. */
export function formatMbps(bps: number): string {
  return t("settings.mbps").replace("{mbps}", String(Math.round(bps / 100_000) / 10));
}

interface RateHeadingProps {
  title: string;
  /** The figure on the right, already worded and cased. */
  rate: string;
  glyph: keyof typeof Ionicons.glyphMap;
  /** Colours the glyph and figure; undefined hides the glyph and leaves the figure in header ink. */
  ink?: string;
  spoken: string;
  /** The first heading under a screen title sits tighter. */
  first?: boolean;
  /** Makes the heading a button, disabled while its action is already running. */
  onPress?: () => void;
  disabled?: boolean;
  hint?: string;
  /** TV focus lets the card below use this heading as its top edge. */
  onFocus?: () => void;
  onBlur?: () => void;
}

/** A section heading with a measured figure seated on its line; focused on TV it caps its card. */
export function RateHeading({ title, rate, glyph, ink, spoken, first, onPress, disabled, hint, onFocus, onBlur }: RateHeadingProps) {
  const palette = useCardPalette();
  const accentStyles = useSettingsAccentStyles();
  const content = (onGold: boolean) => (
    <>
      <Text style={[settingsStyles.sectionHeaderText, styles.title, onGold && accentStyles.listItemTitleFocused]} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.rate}>
        {/* Always mounted, shown by opacity: a focusable's children never come and go (see ListRow). */}
        <Ionicons name={glyph} size={GLYPH} color={onGold ? palette.ink : (ink ?? COLORS.SUCCESS)} style={ink == null && styles.glyphHidden} />
        <Text style={[settingsStyles.sectionHeaderText, ink != null && { color: ink }, onGold && accentStyles.listItemTitleFocused]} numberOfLines={1}>
          {rate}
        </Text>
      </View>
    </>
  );

  if (onPress == null) {
    return (
      <View style={[settingsStyles.sectionHeader, styles.headingRow, first && !Platform.isTV && settingsStyles.sectionHeaderFirst]} accessibilityRole="header" accessibilityLabel={spoken}>
        {content(false)}
      </View>
    );
  }
  // The focused heading carries the card's rounded top corners and inset edge.
  return (
    <Pressable
      style={({ focused, pressed }) => [
        settingsStyles.sectionHeader,
        styles.headingRow,
        first && !Platform.isTV && settingsStyles.sectionHeaderFirst,
        Platform.isTV && styles.tvHeading,
        Platform.isTV && focused && !pressed && accentStyles.listItemFocused,
        Platform.isTV && pressed && accentStyles.listItemPressed,
        Platform.isTV && (focused || pressed) && goldRowShadow(true, false, false),
        !Platform.isTV && pressed && styles.pressed,
      ]}
      onPress={onPress}
      onFocus={onFocus}
      onBlur={onBlur}
      disabled={disabled}
      isTVSelectable
      tvParallaxProperties={{ enabled: false }}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={hint}>
      {({ focused, pressed }) => content(Platform.isTV && (focused || pressed))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Title and rate share one bottom edge, so the figure reads as seated on the
  // label's line rather than floating beside it. Phone takes 4pt more air above
  // than sectionHeader's own; TV keeps sectionHeader's padding.
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingTop: Platform.isTV ? 16 : 14,
  },
  // Takes the slack so the rate sits against the header's right inset.
  title: {
    flex: 1,
  },
  rate: {
    flexDirection: "row",
    alignItems: "center",
    gap: Platform.isTV ? 10 : 6,
  },
  glyphHidden: {
    opacity: 0,
  },
  pressed: {
    opacity: 0.6,
  },
  tvHeading: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
});
