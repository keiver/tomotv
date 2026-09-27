import { COLORS } from "@/constants/colors";
import { useChannelHealth } from "@/hooks/useChannelHealth";
import { t } from "@/services/i18n";
import React from "react";
import { Platform, StyleSheet, Text } from "react-native";

const IS_TV = Platform.isTV;
const TEXT_SHADOW = { textShadowColor: "rgba(0, 0, 0, 0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: IS_TV ? 4 : 3 } as const;

interface GuideCellQuietLineProps {
  channelId: string;
  programName: string;
  episodeTitle: string;
  focused: boolean;
}

/** The stand-in cell's line in the programme cell's own title face, its hint or Offline note
 *  trailing in the meta face; a channel whose health check concluded down says so here. */
export function GuideCellQuietLine({ channelId, programName, episodeTitle, focused }: GuideCellQuietLineProps) {
  const down = useChannelHealth(channelId) === "down";
  const trail = down ? t("liveTv.offline") : focused && episodeTitle ? episodeTitle : "";
  return (
    <Text style={styles.title} numberOfLines={1}>
      {programName}
      {trail ? <Text style={styles.meta}>{`  ·  ${trail}`}</Text> : null}
    </Text>
  );
}

const styles = StyleSheet.create({
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
});
