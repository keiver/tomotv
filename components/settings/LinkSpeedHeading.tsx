import { settingsStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { carriedRungs } from "@/services/adaptiveQuality";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

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
  // A colour is a verdict, so only a landed measurement gets one: the server
  // glyph's green while the connection carries a preset, red once it carries
  // none, which is what the Auto row states in words at the same moment.
  const rateInk = !measured ? undefined : carriedRungs(measuredBps) === 0 ? COLORS.DESTRUCTIVE : COLORS.SUCCESS;

  return (
    <View style={[settingsStyles.sectionHeader, styles.headingRow]} accessibilityLabel={spoken}>
      <Text style={[settingsStyles.sectionHeaderText, styles.title]} numberOfLines={1}>
        STREAMING QUALITY
      </Text>
      <Text style={[settingsStyles.sectionHeaderText, rateInk != null && { color: rateInk }]} numberOfLines={1}>
        {rate.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Title and rate share one bottom edge, so the figure reads as seated on the
  // label's line rather than floating beside it.
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingTop: IS_TV ? 32 : 22,
    paddingBottom: IS_TV ? 20 : 14,
  },
  // Takes the slack so the rate sits against the header's right inset.
  title: {
    flex: 1,
  },
});
