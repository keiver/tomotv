import { GRID_LINE } from "@/components/live-tv/guide-cell";
import { GROUP_CELL_HEIGHT, GuideGroupCell } from "@/components/live-tv/guide-group-cell";
import { COLORS } from "@/constants/colors";
import { useChannelFilterChoices } from "@/hooks/useChannelFilterChoices";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { guideStatus, subscribeGuideStatus, type GuideStatus } from "@/services/externalGuide";
import { t } from "@/services/i18n";
import { updateLiveTvPreferences, type ChannelFilter } from "@/services/liveTvPreferences";
import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { findNodeHandle, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

const IS_TV = Platform.isTV;
export const HUD_BAR_HEIGHT = GROUP_CELL_HEIGHT;
const BAR_HEIGHT = IS_TV ? 4 : 3;
/** How long the "updated" note stays before the HUD goes quiet. */
const READY_LINGER_MS = 5000;

interface GuideHudProps {
  /** TV: the slot over the channel column, holding the guide's round actions. */
  cornerWidth?: number;
  cornerActions?: React.ReactNode;
  /** TV: the picked group cell's native node, where the guide's top row sends Up. */
  onSelectedHandle?: (handle: number | undefined) => void;
}

/** True while the ready note should still show; a timer marks `at` expired READY_LINGER_MS later. */
function useLinger(status: GuideStatus): boolean {
  const at = status.state === "ready" ? status.at : 0;
  const [expiredAt, setExpiredAt] = useState(0);
  useEffect(() => {
    if (!at) return;
    const timer = setTimeout(() => setExpiredAt(at), Math.max(0, at + READY_LINGER_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [at]);
  return at !== 0 && expiredAt !== at;
}

function caption(status: GuideStatus): string | null {
  switch (status.state) {
    case "downloading":
      return status.progress !== null ? `${t("liveTv.guideDownloading")} · ${Math.round(status.progress * 100)}%` : t("liveTv.guideDownloading");
    case "parsing":
      return t("liveTv.guideParsing");
    case "ready":
      return status.channels > 0 ? `${t("liveTv.guideUpdated")} · ${status.channels.toLocaleString()} ${t("liveTv.channels").toLowerCase()}` : t("liveTv.guideUpdated");
    case "error":
      return t("liveTv.guideUnavailable");
    default:
      return null;
  }
}

/** The thin accent bar: a determinate fill while bytes count, a sweep while work is opaque. */
function ProgressBar({ progress }: { progress: number | null }) {
  const sweep = useSharedValue(0);
  const indeterminate = progress === null;
  useEffect(() => {
    if (!indeterminate) return;
    sweep.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false);
    return () => cancelAnimation(sweep);
  }, [indeterminate, sweep]);
  const sweepStyle = useAnimatedStyle(() => ({ left: `${sweep.value * 130 - 30}%` }));
  return (
    <View style={styles.track}>{indeterminate ? <Animated.View style={[styles.fill, styles.sweep, sweepStyle]} /> : <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />}</View>
  );
}

/**
 * The guide's HUD band under the time ruler: the corner's round actions over the channel column,
 * the channel groups as grid cells beside them, the guide's progress underneath, and the way down
 * into the grid (a focus guide, since the canvas cells cannot be entered geometrically).
 */
export function GuideHud({ cornerWidth, cornerActions, onSelectedHandle }: GuideHudProps) {
  const choices = useChannelFilterChoices();
  const { filter } = useLiveTvPreferences();
  const select = useCallback((next: ChannelFilter) => updateLiveTvPreferences({ filter: next }), []);
  const selectedRef = useCallback(
    (node: View | null) => {
      if (!IS_TV || !onSelectedHandle) return;
      onSelectedHandle(node ? (findNodeHandle(node) ?? undefined) : undefined);
    },
    [onSelectedHandle],
  );
  const status = useSyncExternalStore(subscribeGuideStatus, guideStatus);
  const lingering = useLinger(status);
  const busy = status.state === "downloading" || status.state === "parsing";
  const showNote = busy || status.state === "error" || (status.state === "ready" && lingering);
  const text = caption(status);

  if (choices.length <= 1 && !cornerActions) return null;
  return (
    <View>
      <View style={styles.band}>
        {cornerActions ? <View style={[styles.cornerBox, { width: cornerWidth }]}>{cornerActions}</View> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cells}>
          {choices.map((choice) => {
            const selected = choice.filter === filter;
            return <GuideGroupCell key={choice.filter} ref={selected ? selectedRef : undefined} label={choice.label} selected={selected} onPress={() => select(choice.filter)} />;
          })}
        </ScrollView>
      </View>
      {showNote && text ? (
        <View style={styles.note}>
          {busy ? <ProgressBar progress={status.state === "downloading" ? status.progress : null} /> : null}
          <Text style={[styles.caption, status.state === "error" && styles.captionError]} numberOfLines={1} accessibilityLiveRegion="polite">
            {text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: "row",
    alignItems: "center",
    height: HUD_BAR_HEIGHT,
    borderBottomWidth: 1,
    borderColor: GRID_LINE,
  },
  cornerBox: {
    height: HUD_BAR_HEIGHT,
    justifyContent: "center",
  },
  cells: {
    flex: 1,
    flexGrow: 1,
  },
  note: {
    paddingVertical: IS_TV ? 8 : 5,
    paddingHorizontal: IS_TV ? 4 : 8,
    gap: IS_TV ? 6 : 4,
  },
  track: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: COLORS.SURFACE,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: COLORS.ACCENT,
  },
  sweep: {
    position: "absolute",
    width: "30%",
  },
  caption: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 20 : 12,
  },
  captionError: {
    color: COLORS.DESTRUCTIVE_SOFT,
  },
});
