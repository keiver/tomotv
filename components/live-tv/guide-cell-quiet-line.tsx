import { COLORS } from "@/constants/colors";
import { useChannelHealth } from "@/hooks/useChannelHealth";
import { t } from "@/services/i18n";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const TEXT_SHADOW = { textShadowColor: "rgba(0, 0, 0, 0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: IS_TV ? 4 : 3 } as const;
const DOT = IS_TV ? 10 : 6;

interface GuideCellQuietLineProps {
  channelId: string;
  programName: string;
  episodeTitle: string;
  focused: boolean;
}

/**
 * The stand-in cell's lines: its title in the programme cell's own face, the hint trailing while
 * focused, then what the frame sampler last concluded. A burst says the stream answers; two origin
 * refusals say it does not. Before either there is nothing to claim, so no second line.
 */
export function GuideCellQuietLine({ channelId, programName, episodeTitle, focused }: GuideCellQuietLineProps) {
  const health = useChannelHealth(channelId);
  const trail = focused && episodeTitle ? episodeTitle : "";
  const status = health === "up" ? { label: t("liveTv.streamingNow"), color: COLORS.SUCCESS } : health === "down" ? { label: t("liveTv.seemsOffline"), color: COLORS.DESTRUCTIVE_SOFT } : null;
  return (
    <View style={styles.lines}>
      <Text style={styles.title} numberOfLines={1}>
        {programName}
        {trail ? <Text style={styles.meta}>{`  ·  ${trail}`}</Text> : null}
      </Text>
      {status ? (
        <View style={styles.statusRow} testID="guide-cell-status">
          <View style={[styles.dot, { backgroundColor: status.color }]} />
          <Text style={styles.status} numberOfLines={1}>
            {status.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lines: {
    gap: IS_TV ? 4 : 2,
  },
  title: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 24 : 13,
    fontWeight: "600",
    ...TEXT_SHADOW,
  },
  meta: {
    color: COLORS.TEXT_TERTIARY,
    fontSize: IS_TV ? 17 : 10,
    fontWeight: "400",
    ...TEXT_SHADOW,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 8 : 5,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
  // The programme cell's second line face.
  status: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 19 : 11,
    ...TEXT_SHADOW,
  },
});
