import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useChannelHealth } from "@/hooks/useChannelHealth";
import { t } from "@/services/i18n";
import { formatClock } from "@/utils/guide";
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
  /** When this device grabbed the shown frames, 0 while none show. */
  seenAt: number;
}

/**
 * The stand-in cell's lines: its title in the programme cell's own face, the hint trailing while
 * focused, then one claim: the seen time of the shown frames, or until frames show that the stream
 * can be tried. An origin judged dead (two refusals) swaps in the offline verdict.
 */
export function GuideCellQuietLine({ channelId, programName, episodeTitle, focused, seenAt }: GuideCellQuietLineProps) {
  const health = useChannelHealth(channelId);
  const { accent } = useCardPalette();
  const [seenLead, seenTail] = t("liveTv.lastSeen").split("{time}");
  const trail = focused && episodeTitle ? episodeTitle : "";
  const status = health === "down" ? { label: t("liveTv.seemsOffline"), color: COLORS.DESTRUCTIVE_SOFT } : seenAt === 0 ? { label: t("liveTv.streamAvailable"), color: COLORS.SUCCESS } : null;
  return (
    <View style={styles.lines}>
      <Text style={styles.title} numberOfLines={1}>
        {programName}
        {trail ? <Text style={styles.meta}>{`  ·  ${trail}`}</Text> : null}
      </Text>
      {seenAt > 0 ? (
        <Text style={styles.meta} numberOfLines={1} testID="guide-cell-seen-line">
          {seenLead}
          {seenTail === undefined ? null : <Text style={{ color: accent }}>{formatClock(seenAt)}</Text>}
          {seenTail}
        </Text>
      ) : null}
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
