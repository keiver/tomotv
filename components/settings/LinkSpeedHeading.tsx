import { SERVER_GLYPH } from "@/components/settings/ServerRow";
import { goldRowShadow, settingsStyles } from "@/components/settings/styles";
import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { carriedRungs } from "@/services/adaptiveQuality";
import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { t } from "@/services/i18n";

/** Sits on the header text's own line height. */
const GLYPH = Platform.isTV ? 28 : 16;

interface LinkSpeedHeadingProps {
  /** Measured speed to the connected server, bits/second; null = not measured. */
  measuredBps: number | null;
  /** A probe is running right now, so the figure reads as sampling. */
  measuring: boolean;
  /** A press on the heading asks for a fresh measurement. */
  onRemeasure?: () => void;
  /** TV focus, so the card below can take the gold heading as its top edge. */
  onFocus?: () => void;
  onBlur?: () => void;
}

/**
 * The Streaming Quality section heading: the label and the measured server
 * speed. It sits outside the row list's scroll, so the figure stays put while
 * the rows scroll under it and the per-row "needs N Mbps" marks keep a
 * reference. What that speed buys is the Auto row's meter, not this line.
 */
export function LinkSpeedHeading({ measuredBps, measuring, onRemeasure, onFocus, onBlur }: LinkSpeedHeadingProps) {
  const mbps = measuredBps != null ? Math.round(measuredBps / 100_000) / 10 : null;
  const measured = mbps != null && !measuring;
  // Short on purpose: the pending strings share the header line with the title.
  const rate = measuring ? t("settings.checking") : mbps == null ? t("settings.notMeasured") : t("settings.mbps").replace("{mbps}", String(mbps));
  const spoken = measured ? t("settings.streamingConn").replace("{rate}", rate) : t("settings.streamingRate").replace("{rate}", rate);
  // A colour is a verdict, so only a landed measurement gets one: green while the
  // connection carries a preset, red once it carries none. The server glyph is the
  // connected card's, in the same ink, so the figure reads as that server's speed.
  const rateInk = !measured ? undefined : carriedRungs(measuredBps) === 0 ? COLORS.DESTRUCTIVE : COLORS.SUCCESS;

  const content = (onGold: boolean) => (
    <>
      <Text style={[settingsStyles.sectionHeaderText, styles.title, onGold && settingsStyles.listItemTitleFocused]} numberOfLines={1}>
        {t("settings.streamingQuality")}
      </Text>
      <View style={styles.rate}>
        {rateInk != null ? <Ionicons name={SERVER_GLYPH} size={GLYPH} color={onGold ? CARD_FOCUS.TITLE_TEXT_FOCUSED : rateInk} /> : null}
        <Text style={[settingsStyles.sectionHeaderText, rateInk != null && { color: rateInk }, onGold && settingsStyles.listItemTitleFocused]} numberOfLines={1}>
          {rate.toUpperCase()}
        </Text>
      </View>
    </>
  );

  if (onRemeasure == null) {
    return (
      <View style={[settingsStyles.sectionHeader, styles.headingRow]} accessibilityLabel={spoken}>
        {content(false)}
      </View>
    );
  }
  // On TV focus fills the heading with the rows' gold as the card's top edge, the way a focused first row fills it.
  return (
    <Pressable
      style={({ focused, pressed }) => [
        settingsStyles.sectionHeader,
        styles.headingRow,
        Platform.isTV && styles.tvHeading,
        Platform.isTV && focused && !pressed && settingsStyles.listItemFocused,
        Platform.isTV && pressed && settingsStyles.listItemPressed,
        Platform.isTV && (focused || pressed) && goldRowShadow(true, false, false),
        !Platform.isTV && pressed && styles.pressed,
      ]}
      onPress={onRemeasure}
      onFocus={onFocus}
      onBlur={onBlur}
      disabled={measuring}
      isTVSelectable
      tvParallaxProperties={{ enabled: false }}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={t("settings.measureAgain")}>
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
  pressed: {
    opacity: 0.6,
  },
  tvHeading: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
});
