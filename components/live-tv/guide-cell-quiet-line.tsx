import { COLORS } from "@/constants/colors";
import { useChannelHealth } from "@/hooks/useChannelHealth";
import { t } from "@/services/i18n";
import React from "react";
import { Platform, StyleSheet, Text } from "react-native";

const IS_TV = Platform.isTV;

interface GuideCellQuietLineProps {
  channelId: string;
  programName: string;
  episodeTitle: string;
  focused: boolean;
}

/** The stand-in cell's one dim line; a channel whose health check concluded down says so here. */
export function GuideCellQuietLine({ channelId, programName, episodeTitle, focused }: GuideCellQuietLineProps) {
  const down = useChannelHealth(channelId) === "down";
  const line = down ? `${programName}  ·  ${t("liveTv.offline")}` : focused && episodeTitle ? `${programName}  ·  ${episodeTitle}` : programName;
  return (
    <Text style={[styles.quiet, focused && styles.quietFocused]} numberOfLines={1}>
      {line}
    </Text>
  );
}

const styles = StyleSheet.create({
  quiet: {
    color: COLORS.TEXT_QUATERNARY,
    fontSize: IS_TV ? 19 : 11,
  },
  quietFocused: {
    color: COLORS.TEXT_SECONDARY,
  },
});
