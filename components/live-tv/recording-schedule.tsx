import { FocusableButton } from "@/components/FocusableButton";
import { TimerRow } from "@/components/live-tv/timer-row";
import { SectionActionBand } from "@/components/settings/SectionActionBand";
import { settingsStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import type { ScheduledEntry } from "@/hooks/useRecordingSchedule";
import { t } from "@/services/i18n";
import type { JellyfinTimer } from "@/types/jellyfin";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface RecordingScheduleProps {
  entries: ScheduledEntry[];
  nowMs: number;
  onTimerPress: (timer: JellyfinTimer, series: boolean) => void;
  /** TV: Stop All closes the card while something records; the phone carries it in the native bar. */
  stopAll?: { disabled: boolean; onPress: () => void } | null;
  /** The schedule's read failed: the reason and a retry, in place of the rows. */
  error?: string | null;
  onRetry: () => void;
}

/** The Recordings screen's schedule card: what records now, what is set to record, and the series rules. */
export function RecordingSchedule({ entries, nowMs, onTimerPress, stopAll, error, onRetry }: RecordingScheduleProps) {
  const { onAccent } = useCardPalette();
  if (error) {
    return (
      <View style={[settingsStyles.section, styles.card, styles.error]} testID="recording-schedule-error">
        <Text style={styles.errorText}>{error}</Text>
        <FocusableButton title={t("common.retry")} variant="primary" onPress={onRetry} icon={<Ionicons name="refresh-outline" size={IS_TV ? 24 : 20} color={onAccent} />} />
      </View>
    );
  }
  if (entries.length === 0) return null;
  return (
    <View style={[settingsStyles.section, styles.card]} testID="recording-schedule">
      {entries.map((entry, index) =>
        entry.kind === "heading" ? (
          <Text key={entry.key} style={[settingsStyles.sectionNote, styles.groupLabel]}>
            {entry.title}
          </Text>
        ) : (
          <TimerRow key={entry.key} timer={entry.timer} nowMs={nowMs} series={entry.series} onPress={onTimerPress} isLast={index === entries.length - 1 && !stopAll} />
        ),
      )}
      {/* TV: the card runs out into the action, as the downloads card ends in its gauge. */}
      {stopAll ? <SectionActionBand icon="stop-circle-outline" label={t("liveTv.stopAllRecordings")} disabled={stopAll.disabled} onPress={stopAll.onPress} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: IS_TV ? 32 : 20,
  },
  // The group's name as a band inside the card, a step up from a footnote so it reads as a heading.
  groupLabel: {
    fontSize: IS_TV ? 22 : 13,
    fontWeight: "600",
    color: COLORS.TEXT_SECONDARY,
  },
  error: {
    alignItems: "center",
    gap: 12,
    padding: IS_TV ? 28 : 18,
  },
  errorText: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 22 : 15,
    textAlign: "center",
  },
});
