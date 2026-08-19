import { settingsStyles } from "@/components/settings/styles";
import { linkCarriesPreset } from "@/services/adaptiveQuality";
import { QUALITY_PRESETS } from "@/services/jellyfin/constants";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/** Real (transcodable) presets — the Original sentinel is not a ladder rung. */
const RUNGS = QUALITY_PRESETS.length - 1;

const GREEN = "#34C759";
const RED = "#FF3B30";
const DIM = "rgba(255, 255, 255, 0.18)";

/** Rungs the measured link clears at the player's own up-switch trust. */
function carriedRungs(measuredBps: number | null): number {
  let count = 0;
  for (let i = 0; i < RUNGS; i++) if (linkCarriesPreset(measuredBps, i)) count = i + 1;
  return count;
}

/**
 * Cell-reception-style ladder: one bar per preset rung, bar n lit when the
 * measured link carries that preset. Not abstract signal strength — the lit
 * count always agrees with the rows' capacity marks because both run
 * linkCarriesPreset.
 */
function LadderBars({ carried, color }: { carried: number; color: string }) {
  return (
    <View style={styles.bars} accessibilityElementsHidden>
      {Array.from({ length: RUNGS }, (_, i) => (
        <View key={i} style={[styles.bar, { height: (IS_TV ? 10 : 6) + i * (IS_TV ? 5 : 3) }, { backgroundColor: i < carried ? color : DIM }]} />
      ))}
    </View>
  );
}

interface LinkSpeedHeadingProps {
  /** Measured link to the connected server, bits/second; null = not measured. */
  measuredBps: number | null;
  /** A probe is running right now (the ladder reads as sampling). */
  measuring: boolean;
}

/**
 * The Streaming Quality section heading with the measured server link built in:
 * ladder bars on the heading's right, the capacity verdict on the note line.
 * Pure decoration inside the header's normal flow — nothing focusable, nothing
 * layered over the rows. The verdict and the rows' capacity marks share one
 * rule, so the heading can never contradict the menu under it.
 */
export function LinkSpeedHeading({ measuredBps, measuring }: LinkSpeedHeadingProps) {
  const carried = carriedRungs(measuredBps);
  // Green = the link carries HD (720p and up); red = it does not.
  const color = carried >= 3 ? GREEN : RED;
  const mbps = measuredBps != null ? Math.round(measuredBps / 100_000) / 10 : null;
  const measured = !measuring && mbps != null;
  const verdict = measuring
    ? "Sampling the link…"
    : mbps == null
      ? "Link not measured yet"
      : carried === 0
        ? `${mbps} Mbps · below every preset`
        : `${mbps} Mbps · can handle up to ${QUALITY_PRESETS[carried - 1].label}`;

  return (
    <View style={settingsStyles.sectionHeader}>
      <View style={styles.headingRow}>
        <Text style={settingsStyles.sectionHeaderText}>STREAMING QUALITY</Text>
        <LadderBars carried={measuring ? 0 : carried} color={color} />
      </View>
      <Text style={[settingsStyles.sectionHeaderNote, measured && { color }]} accessibilityLabel={`Server link: ${verdict}`}>
        {verdict}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // flex-end plus the translate sinks the ladder off the heading's cap height,
  // seating it between the heading and the verdict line.
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  bars: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: IS_TV ? 4 : 3,
    width: IS_TV ? 56 : 42,
    transform: [{ translateY: IS_TV ? 28 : 16 }],
  },
  bar: {
    flex: 1,
    borderRadius: 2,
  },
});
