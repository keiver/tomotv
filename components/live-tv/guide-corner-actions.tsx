import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { GROUP_CELL_HEIGHT, HUD_CELL_BACKGROUND } from "@/components/live-tv/guide-group-cell";
import { SfSymbolIcon } from "@/components/sf-symbol-icon";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;
const ICON = IS_TV ? 22 : 16;

interface HudActionProps {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  forwardedRef?: (node: View | null) => void;
}

/** One frosted-black cell of the band's corner, square-cornered and band-tall; focus draws the cells' gold ring. */
function HudAction({ icon, label, onPress, forwardedRef }: HudActionProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.tile}>
      <Pressable
        ref={forwardedRef}
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        isTVSelectable
        accessibilityRole="button"
        accessibilityLabel={label}
        tvParallaxProperties={{ enabled: false }}
        style={styles.hit}>
        {focused ? <View style={styles.focusRing} pointerEvents="none" /> : null}
        {icon}
      </Pressable>
    </View>
  );
}

interface GuideCornerActionsProps {
  /** The Channels cell wears the filled filter mark while a filter holds the channels. */
  filtered: boolean;
  onChannels: () => void;
  onRecordings: () => void;
  onSchedule: () => void;
  /** Present while an external guide is in play: a fourth cell re-downloads it. */
  onRefreshGuide?: () => void;
  /** The first cell's node, the guide cells' fallback Up target. */
  onFirstRef?: (node: View | null) => void;
}

/** Channels, Recordings, Schedule and the guide refresh: equal frosted cells spanning the band's corner. */
export function GuideCornerActions({ filtered, onChannels, onRecordings, onSchedule, onRefreshGuide, onFirstRef }: GuideCornerActionsProps) {
  return (
    <View style={styles.row}>
      <HudAction
        forwardedRef={onFirstRef}
        label={t("liveTv.channels")}
        onPress={onChannels}
        icon={filtered ? <SfSymbolIcon name="line.3.horizontal.decrease.circle.fill" size={ICON} color={COLORS.ACCENT} /> : <Ionicons name="grid-outline" size={ICON} color={COLORS.ACCENT} />}
      />
      <HudAction label={t("liveTv.recordings")} onPress={onRecordings} icon={<Ionicons name="recording-outline" size={ICON} color={COLORS.ACCENT} />} />
      <HudAction label={t("liveTv.scheduled")} onPress={onSchedule} icon={<Ionicons name="calendar-outline" size={ICON} color={COLORS.ACCENT} />} />
      {onRefreshGuide ? <HudAction label={t("liveTv.guideRefresh")} onPress={onRefreshGuide} icon={<Ionicons name="refresh-outline" size={ICON} color={COLORS.ACCENT} />} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The corner's cells split its width evenly and meet edge to edge: one surface with the groups.
  row: {
    flexDirection: "row",
    alignSelf: "stretch",
  },
  tile: {
    flex: 1,
    height: GROUP_CELL_HEIGHT,
    borderRightWidth: 1,
    borderColor: GRID_LINE,
    backgroundColor: HUD_CELL_BACKGROUND,
  },
  hit: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // The program cells' focus mark, spanning the shared lines so it meets the band's edges.
  focusRing: {
    position: "absolute",
    top: 0,
    left: -1,
    right: -1,
    bottom: 0,
    borderWidth: IS_TV ? 2 : 1,
    borderColor: COLORS.ACCENT,
  },
});
