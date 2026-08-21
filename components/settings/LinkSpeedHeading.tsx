import { settingsStyles } from "@/components/settings/styles";
import { ValueBadge } from "@/components/value-badge";
import { COLORS } from "@/constants/colors";
import { carriedRungs, ORIGINAL_INDEX } from "@/services/adaptiveQuality";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/** Real (transcodable) presets — the Original sentinel is not a ladder rung. */
const RUNGS = ORIGINAL_INDEX;

const DIM = "rgba(255, 255, 255, 0.18)";

// The shortest bar stands 1.5x its own width, so rung one reads as a bar
// rather than a dot (phone bars are 6pt wide, TV 8pt).
const BAR_BASE = IS_TV ? 14 : 9;
const BAR_STEP = IS_TV ? 5 : 3;
const BAR_TALLEST = BAR_BASE + (RUNGS - 1) * BAR_STEP;

/**
 * Cell-reception-style ladder: one bar per preset rung, bar n lit when the
 * measured speed carries that preset. Count is the message, so one lit colour
 * serves every level and a speed that carries nothing lights nothing.
 */
function LadderBars({ carried }: { carried: number }) {
  return (
    <View style={styles.bars} accessibilityElementsHidden>
      {Array.from({ length: RUNGS }, (_, i) => (
        <View key={i} style={[styles.bar, { height: BAR_BASE + i * BAR_STEP }, { backgroundColor: i < carried ? COLORS.SUCCESS : DIM }]} />
      ))}
    </View>
  );
}

interface LinkSpeedHeadingProps {
  /** Measured speed to the connected server, bits/second; null = not measured. */
  measuredBps: number | null;
  /** A probe is running right now (the ladder reads as sampling). */
  measuring: boolean;
}

/**
 * The Streaming Quality section heading: the label, a gold pill stating the
 * measured server speed, and a ladder on the right whose lit count is how many
 * presets that speed carries. Pure decoration inside the header's own flow — nothing
 * focusable, nothing layered over the rows, which on tvOS would occlude them.
 *
 * The heading states the measurement and nothing else. What it buys is on the
 * Auto row, off the same carriedRungs call, so the two cannot disagree.
 */
export function LinkSpeedHeading({ measuredBps, measuring }: LinkSpeedHeadingProps) {
  const mbps = measuredBps != null ? Math.round(measuredBps / 100_000) / 10 : null;
  const measured = mbps != null && !measuring;
  // Short on purpose: the pending strings share the header line with the title,
  // which has ~84pt left on a 375pt phone once the ladder takes its inset.
  const rate = measuring ? "Checking…" : mbps == null ? "Not measured" : `${mbps} Mbps`;
  const spoken = measured ? `Streaming quality. Server connection: ${rate}` : `Streaming quality. ${rate}`;

  return (
    <View style={[settingsStyles.sectionHeader, styles.headingRow]} accessibilityLabel={spoken}>
      <View style={styles.titleGroup}>
        <Text style={settingsStyles.sectionHeaderText} numberOfLines={1}>
          STREAMING QUALITY
        </Text>
        {measured ? <ValueBadge label={rate} /> : <Text style={styles.pending}>{rate}</Text>}
      </View>
      <LadderBars carried={measuring ? 0 : carriedRungs(measuredBps)} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Everything shares one bottom edge, so the ladder reads as seated on the
  // label's line rather than floating beside it.
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingTop: IS_TV ? 32 : 22,
    paddingBottom: IS_TV ? 20 : 14,
  },
  // Takes the slack so the ladder sits against the header's right inset.
  titleGroup: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: IS_TV ? 14 : 8,
  },
  // No pill until there is a value: gold is the app's claim mark, and a
  // measurement that has not landed is not one.
  pending: {
    fontSize: IS_TV ? 21 : 13,
    color: COLORS.TEXT_SECONDARY,
  },
  // Pinned to the tallest bar, so the row's height does not depend on which
  // rungs happen to be lit.
  bars: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: IS_TV ? 4 : 3,
    width: IS_TV ? 56 : 42,
    height: BAR_TALLEST,
  },
  bar: {
    flex: 1,
    borderRadius: 2,
  },
});
