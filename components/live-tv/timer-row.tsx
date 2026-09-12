import { CARD_FOCUS, DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import type { JellyfinTimer } from "@/types/jellyfin";
import { formatClock, formatDayLabel } from "@/utils/guide";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface TimerRowProps {
  timer: JellyfinTimer;
  nowMs: number;
  onPress: (timer: JellyfinTimer) => void;
  hasTVPreferredFocus?: boolean;
}

/** One scheduled recording: what, where, when, and whether it is running right now. */
function TimerRowComponent({ timer, nowMs, onPress, hasTVPreferredFocus = false }: TimerRowProps) {
  const startMs = Date.parse(timer.StartDate);
  const endMs = Date.parse(timer.EndDate);
  const running = timer.Status === "InProgress";
  const when = `${formatDayLabel(startMs, nowMs, { today: t("liveTv.today"), tomorrow: t("liveTv.tomorrow") })} ${formatClock(startMs)} to ${formatClock(endMs)}`;
  return (
    <Pressable
      onPress={() => onPress(timer)}
      isTVSelectable
      hasTVPreferredFocus={hasTVPreferredFocus}
      tvParallaxProperties={{ enabled: false }}
      accessibilityRole="button"
      accessibilityLabel={`${timer.Name}, ${timer.ChannelName ?? ""}, ${when}`}
      style={({ focused }) => [styles.row, focused && styles.rowFocused]}>
      <View style={[styles.mark, running && styles.markRunning]}>
        <Ionicons name={timer.SeriesTimerId ? "repeat" : "radio-button-on"} size={IS_TV ? 26 : 18} color={running ? COLORS.DESTRUCTIVE : COLORS.ACCENT} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {timer.Name}
        </Text>
        {timer.EpisodeTitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {timer.EpisodeTitle}
          </Text>
        ) : null}
        <Text style={styles.meta} numberOfLines={1}>
          {[timer.ChannelName, when].filter(Boolean).join("  ·  ")}
        </Text>
      </View>
      {running ? <Text style={styles.running}>{t("liveTv.recordingNow")}</Text> : null}
    </Pressable>
  );
}

export const TimerRow = React.memo(TimerRowComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 20 : 12,
    paddingVertical: IS_TV ? 18 : 12,
    paddingHorizontal: IS_TV ? 24 : 14,
    borderRadius: DESIGN.BORDER_RADIUS_MEDIUM,
    backgroundColor: COLORS.SURFACE,
    borderWidth: CARD_FOCUS.BORDER_WIDTH,
    borderColor: CARD_FOCUS.BORDER_COLOR,
  },
  rowFocused: {
    backgroundColor: "rgba(255, 195, 18, 0.18)",
    borderColor: CARD_FOCUS.BORDER_COLOR_FOCUSED,
  },
  mark: {
    width: IS_TV ? 48 : 32,
    height: IS_TV ? 48 : 32,
    borderRadius: DESIGN.BORDER_RADIUS_ROUND,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
  markRunning: {
    backgroundColor: "rgba(255, 59, 48, 0.18)",
  },
  text: {
    flex: 1,
    gap: IS_TV ? 4 : 2,
  },
  title: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 26 : 16,
    fontWeight: "700",
  },
  subtitle: {
    color: COLORS.TEXT_BODY,
    fontSize: IS_TV ? 21 : 14,
  },
  meta: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 19 : 13,
  },
  running: {
    color: COLORS.DESTRUCTIVE_SOFT,
    fontSize: IS_TV ? 20 : 13,
    fontWeight: "700",
  },
});
