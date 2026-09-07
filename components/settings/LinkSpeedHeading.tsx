import { SERVER_GLYPH } from "@/components/settings/ServerRow";
import { settingsStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { carriedRungs } from "@/services/adaptiveQuality";
import { Ionicons } from "@expo/vector-icons";
import { Platform, StyleSheet, Text, View } from "react-native";

/** Sits on the header text's own line height. */
const GLYPH = Platform.isTV ? 28 : 16;

interface LinkSpeedHeadingProps {
  /** Measured speed to the connected server, bits/second; null = not measured. */
  measuredBps: number | null;
  /** A probe is running right now, so the figure reads as sampling. */
  measuring: boolean;
}

/**
 * The Streaming Quality section heading: the label and the measured server
 * speed. It sits outside the row list's scroll, so the figure stays put while
 * the rows scroll under it and the per-row "needs N Mbps" marks keep a
 * reference. What that speed buys is the Auto row's meter, not this line.
 */
export function LinkSpeedHeading({ measuredBps, measuring }: LinkSpeedHeadingProps) {
  const mbps = measuredBps != null ? Math.round(measuredBps / 100_000) / 10 : null;
  const measured = mbps != null && !measuring;
  // Short on purpose: the pending strings share the header line with the title.
  const rate = measuring ? "Checking…" : mbps == null ? "Not measured" : `${mbps} Mbps`;
  const spoken = measured ? `Streaming quality. Server connection: ${rate}` : `Streaming quality. ${rate}`;
  // A colour is a verdict, so only a landed measurement gets one: green while the
  // connection carries a preset, red once it carries none. The server glyph is the
  // connected card's, in the same ink, so the figure reads as that server's speed.
  const rateInk = !measured ? undefined : carriedRungs(measuredBps) === 0 ? COLORS.DESTRUCTIVE : COLORS.SUCCESS;

  return (
    <View style={[settingsStyles.sectionHeader, styles.headingRow]} accessibilityLabel={spoken}>
      <Text style={[settingsStyles.sectionHeaderText, styles.title]} numberOfLines={1}>
        STREAMING QUALITY
      </Text>
      <View style={styles.rate}>
        {rateInk != null ? <Ionicons name={SERVER_GLYPH} size={GLYPH} color={rateInk} /> : null}
        <Text style={[settingsStyles.sectionHeaderText, rateInk != null && { color: rateInk }]} numberOfLines={1}>
          {rate.toUpperCase()}
        </Text>
      </View>
    </View>
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
});
