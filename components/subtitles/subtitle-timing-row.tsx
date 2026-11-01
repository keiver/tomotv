import { FocusableButton } from "@/components/FocusableButton";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import type { CurrentSubtitle } from "@/services/subtitles/current";
import { offsetLabel, syncStateLine } from "@/services/subtitles/jobText";
import { languageFor } from "@/services/subtitles/languages";
import type { SubtitleSyncState } from "@/services/subtitles/timing";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface SubtitleTimingRowProps {
  subtitle: CurrentSubtitle;
  offsetMs: number;
  /** A step's sign, or null for the reset. */
  onShift: (direction: -1 | 1 | null) => void;
  onReplace: () => void;
  /** Matches the subtitle to the audio; absent while the video is not playing in the session. */
  onSync?: () => void;
  syncState?: SubtitleSyncState | null;
  isLast?: boolean;
}

/** One subtitle the video already has: its name and language, how far it runs from the picture, and the controls that move, match or replace it. */
export function SubtitleTimingRow({ subtitle, offsetMs, onShift, onReplace, onSync, syncState = null, isLast = false }: SubtitleTimingRowProps) {
  const palette = useCardPalette();
  const language = languageFor(subtitle.language)?.native ?? subtitle.language;
  const size = IS_TV ? 28 : 18;
  const note = syncStateLine(syncState);
  return (
    <View style={[styles.row, !isLast && styles.divided]}>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {subtitle.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {language}
          {"  ·  "}
          <Text style={[styles.offset, offsetMs !== 0 && { color: palette.accent }]}>{offsetLabel(offsetMs)}</Text>
        </Text>
        {note ? <Text style={styles.meta}>{note}</Text> : null}
      </View>
      <View style={styles.controls}>
        <FocusableButton title={t("subtitles.earlier")} variant="link" icon={<Ionicons name="remove" size={size} color={palette.accent} />} onPress={() => onShift(-1)} />
        <FocusableButton title={t("subtitles.later")} variant="link" icon={<Ionicons name="add" size={size} color={palette.accent} />} onPress={() => onShift(1)} />
        <FocusableButton
          title={t("subtitles.resetTiming")}
          variant="link"
          icon={<Ionicons name="refresh" size={size} color={palette.accent} />}
          onPress={() => onShift(null)}
          disabled={offsetMs === 0}
        />
        {onSync ? (
          <FocusableButton title={t("subtitles.sync")} variant="link" icon={<Ionicons name="pulse" size={size} color={palette.accent} />} onPress={onSync} disabled={syncState?.status === "syncing"} />
        ) : null}
        <FocusableButton title={t("subtitles.replace")} variant="link" icon={<Ionicons name="swap-horizontal" size={size} color={palette.accent} />} onPress={onReplace} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: IS_TV ? 32 : 20,
    paddingVertical: IS_TV ? 22 : 14,
    gap: IS_TV ? 14 : 8,
  },
  divided: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.SURFACE_MUTED,
  },
  text: {
    gap: IS_TV ? 6 : 3,
  },
  name: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 28 : 17,
    fontWeight: "600",
  },
  meta: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 22 : 14,
  },
  offset: {
    fontWeight: "600",
  },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: IS_TV ? 24 : 4,
  },
});
