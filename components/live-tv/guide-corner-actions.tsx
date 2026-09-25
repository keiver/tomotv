import { GlassButton } from "@/components/glass-button";
import { SfSymbolIcon } from "@/components/sf-symbol-icon";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View } from "react-native";

const CIRCLE = 40;
const ICON = 22;

interface GuideCornerActionsProps {
  /** The Channels circle wears the filled filter mark while a filter holds the channels. */
  filtered: boolean;
  onChannels: () => void;
  onRecordings: () => void;
  onSchedule: () => void;
  /** Present while an external guide is in play: a fourth circle re-downloads it. */
  onRefreshGuide?: () => void;
  /** The first circle's node, the guide cells' fallback Up target. */
  onFirstRef?: (node: View | null) => void;
}

/** Channels, Recordings, Schedule and the guide refresh as round glass actions in the guide's corner cell. */
export function GuideCornerActions({ filtered, onChannels, onRecordings, onSchedule, onRefreshGuide, onFirstRef }: GuideCornerActionsProps) {
  return (
    <View style={styles.row}>
      <GlassButton
        ref={onFirstRef}
        style={styles.circle}
        icon={filtered ? <SfSymbolIcon name="line.3.horizontal.decrease.circle.fill" size={ICON} color={COLORS.ACCENT} /> : <Ionicons name="grid-outline" size={ICON} color={COLORS.ACCENT} />}
        accessibilityLabel={t("liveTv.channels")}
        onPress={onChannels}
      />
      <GlassButton style={styles.circle} icon={<Ionicons name="recording-outline" size={ICON} color={COLORS.ACCENT} />} accessibilityLabel={t("liveTv.recordings")} onPress={onRecordings} />
      <GlassButton style={styles.circle} icon={<Ionicons name="calendar-outline" size={ICON} color={COLORS.ACCENT} />} accessibilityLabel={t("liveTv.scheduled")} onPress={onSchedule} />
      {onRefreshGuide ? (
        <GlassButton style={styles.circle} icon={<Ionicons name="refresh-outline" size={ICON} color={COLORS.ACCENT} />} accessibilityLabel={t("liveTv.guideRefresh")} onPress={onRefreshGuide} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  // A square pill: GlassButton rounds its capsule from the height, so it draws as a circle.
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    minHeight: CIRCLE,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
});
