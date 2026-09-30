import { GROUP_CELL_HEIGHT, HUD_CELL_BACKGROUND } from "@/components/live-tv/guide-group-cell";
import { SfSymbolIcon } from "@/components/sf-symbol-icon";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;
export const HUD_ACTION_ICON = IS_TV ? 32 : 23;
const ICON = HUD_ACTION_ICON;
const WEIGHT = "bold";

interface HudActionProps {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  /** Stays focusable so TV focus is never ejected; presses drop and the icon dims. */
  disabled?: boolean;
  forwardedRef?: (node: View | null) => void;
}

/** One frosted-black cell of the band's corner, square-cornered and band-tall; focus draws the cells' gold ring. */
export function HudAction({ icon, label, onPress, disabled, forwardedRef }: HudActionProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.tile}>
      <Pressable
        ref={forwardedRef}
        onPress={disabled ? undefined : onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        isTVSelectable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: disabled === true }}
        tvParallaxProperties={{ enabled: false }}
        style={styles.hit}>
        {focused ? <View style={styles.focusRing} pointerEvents="none" /> : null}
        <View style={disabled ? styles.iconDisabled : null}>{icon}</View>
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
  /** True while the guide is already working: the refresh cell drops presses and dims. */
  refreshing?: boolean;
  /** The first cell's node, the guide cells' fallback Up target. */
  onFirstRef?: (node: View | null) => void;
}

/** Channels, Recordings, Schedule and the guide refresh: equal frosted cells spanning the band's corner. */
export function GuideCornerActions({ filtered, onChannels, onRecordings, onSchedule, onRefreshGuide, refreshing, onFirstRef }: GuideCornerActionsProps) {
  return (
    <View style={styles.row}>
      <HudAction
        forwardedRef={onFirstRef}
        label={t("liveTv.channels")}
        onPress={onChannels}
        icon={<SfSymbolIcon name={filtered ? "line.3.horizontal.decrease.circle.fill" : "square.grid.2x2"} size={ICON} color={COLORS.ACCENT} weight={WEIGHT} />}
      />
      <HudAction label={t("liveTv.recordings")} onPress={onRecordings} icon={<SfSymbolIcon name="recordingtape" size={ICON} color={COLORS.ACCENT} weight={WEIGHT} />} />
      <HudAction label={t("liveTv.scheduled")} onPress={onSchedule} icon={<SfSymbolIcon name="calendar" size={ICON} color={COLORS.ACCENT} weight={WEIGHT} />} />
      {onRefreshGuide ? (
        <HudAction label={t("liveTv.guideRefresh")} onPress={onRefreshGuide} disabled={refreshing} icon={<SfSymbolIcon name="arrow.clockwise" size={ICON} color={COLORS.ACCENT} weight={WEIGHT} />} />
      ) : null}
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
    backgroundColor: HUD_CELL_BACKGROUND,
  },
  hit: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconDisabled: {
    opacity: 0.35,
  },
  // The program cells' focus mark.
  focusRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: IS_TV ? 2 : 1,
    borderColor: COLORS.ACCENT,
  },
});
