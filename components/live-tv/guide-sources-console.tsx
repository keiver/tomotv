import { ScanBand } from "@/components/live-tv/scan-band";
import { settingsStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface GuideSourcesConsoleProps {
  /** The headline number, in tabular figures: channels paired, or a guide's own count. */
  figure: string;
  caption: string;
  /** What is happening now; the scan sweeps while `busy`. */
  status?: string;
  busy: boolean;
  /** Lines under the status, one fact each (size, when it landed). */
  details?: readonly string[];
}

/**
 * The Guide Sources screens' readout: one large figure on the section card, the guide HUD's scan
 * sweeping behind it while a guide downloads or is read. Never focusable; the rows below carry focus.
 */
export function GuideSourcesConsole({ figure, caption, status, busy, details = [] }: GuideSourcesConsoleProps) {
  return (
    <View style={[settingsStyles.section, styles.card]} accessible accessibilityLabel={[figure, caption, status, ...details].filter(Boolean).join(", ")}>
      <ScanBand active={busy} />
      <View style={styles.row}>
        <Text style={styles.figure} numberOfLines={1}>
          {figure}
        </Text>
        <Text style={styles.caption} numberOfLines={2}>
          {caption}
        </Text>
      </View>
      {status ? (
        <View style={styles.statusRow}>
          <View style={[styles.dot, busy ? styles.dotBusy : styles.dotIdle]} />
          <Text style={styles.status} numberOfLines={1}>
            {status}
          </Text>
        </View>
      ) : null}
      {details.map((line) => (
        <Text key={line} style={styles.detail} numberOfLines={1}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: IS_TV ? 40 : 20,
    paddingVertical: IS_TV ? 32 : 18,
    gap: IS_TV ? 12 : 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: IS_TV ? 20 : 10,
  },
  figure: {
    fontSize: IS_TV ? 76 : 44,
    lineHeight: IS_TV ? 84 : 50,
    fontWeight: "700",
    letterSpacing: IS_TV ? -1.5 : -1,
    color: COLORS.ACCENT,
    fontVariant: ["tabular-nums"],
  },
  caption: {
    flexShrink: 1,
    fontSize: IS_TV ? 26 : 15,
    fontWeight: "600",
    color: COLORS.TEXT_PRIMARY,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 12 : 8,
  },
  dot: {
    width: IS_TV ? 10 : 7,
    height: IS_TV ? 10 : 7,
    borderRadius: IS_TV ? 5 : 3.5,
  },
  dotBusy: {
    backgroundColor: COLORS.ACCENT,
  },
  dotIdle: {
    backgroundColor: COLORS.SUCCESS,
  },
  status: {
    flexShrink: 1,
    fontSize: IS_TV ? 22 : 13,
    color: COLORS.TEXT_BODY,
    fontVariant: ["tabular-nums"],
  },
  detail: {
    fontSize: IS_TV ? 20 : 12,
    color: COLORS.TEXT_TERTIARY,
    fontVariant: ["tabular-nums"],
  },
});
