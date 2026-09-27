import { GROUP_CELL_HEIGHT, GuideGroupCell, HUD_CELL_BACKGROUND } from "@/components/live-tv/guide-group-cell";
import { useChannelFilterChoices } from "@/hooks/useChannelFilterChoices";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { guideStatus, subscribeGuideStatus } from "@/services/externalGuide";
import { t } from "@/services/i18n";
import { updateLiveTvPreferences, type ChannelFilter } from "@/services/liveTvPreferences";
import React, { useCallback, useEffect, useSyncExternalStore } from "react";
import { findNodeHandle, type LayoutChangeEvent, Platform, ScrollView, StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

const IS_TV = Platform.isTV;
/** The band's full height. */
export const HUD_BAR_HEIGHT = GROUP_CELL_HEIGHT + 1;

/** An accent band, soft on both flanks; the cells' frosted floors let it glow through. */
const SCAN_WASH = "linear-gradient(90deg, rgba(255, 195, 18, 0) 0%, rgba(255, 195, 18, 0.2) 40%, rgba(255, 195, 18, 0.38) 50%, rgba(255, 195, 18, 0.2) 60%, rgba(255, 195, 18, 0) 100%)";

interface GuideHudProps {
  /** The band's leading slot: TV's corner actions over the channel column, phone's guide refresh cell. */
  cornerWidth?: number;
  cornerActions?: React.ReactNode;
  /** TV: the picked group cell's native node, where the guide's top row sends Up. */
  onSelectedHandle?: (handle: number | undefined) => void;
  /** True while the guide's programs load behind the grid: the band wears the scan for it. */
  updating?: boolean;
}

/**
 * An accent wash sweeping back and forth over the group cells while the guide works, fading out
 * once the new values are on screen; under the cells, so it never occludes focus.
 */
function ScanBand({ active }: { active: boolean }) {
  const sweep = useSharedValue(0);
  const fade = useSharedValue(0);
  const hostW = useSharedValue(0);
  useEffect(() => {
    if (active) {
      fade.value = withTiming(1, { duration: 250 });
      // From the left edge: withRepeat's reverse leg returns to the value held at start,
      // and the fade-out's cancelAnimation leaves the last run's mid-flight value here.
      sweep.value = 0;
      sweep.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else {
      fade.value = withTiming(0, { duration: 500 }, (finished) => {
        if (finished) cancelAnimation(sweep);
      });
    }
    return () => {
      cancelAnimation(sweep);
      cancelAnimation(fade);
    };
  }, [active, sweep, fade]);
  const handleLayout = useCallback((event: LayoutChangeEvent) => hostW.set(event.nativeEvent.layout.width), [hostW]);
  // translateX, never `left`: a layout prop animated on the UI thread commits into the shadow
  // tree against the guide's own row commits.
  const drift = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateX: (sweep.value * 0.9 - 0.05) * hostW.value }] }));
  return (
    <View style={styles.scanHost} pointerEvents="none" onLayout={handleLayout}>
      <Animated.View style={[styles.scan, drift]} />
    </View>
  );
}

/**
 * The guide's HUD band under the time ruler: the corner's round actions over the channel column
 * and the channel groups as grid cells beside them. While the guide downloads or its programs
 * load, a subtle accent scan drifts across the band; nothing moves when it comes or goes.
 */
export function GuideHud({ cornerWidth, cornerActions, onSelectedHandle, updating }: GuideHudProps) {
  const choices = useChannelFilterChoices();
  const { filter, hideOffline } = useLiveTvPreferences();
  const select = useCallback((next: ChannelFilter) => updateLiveTvPreferences({ filter: next }), []);
  const toggleOffline = useCallback(() => updateLiveTvPreferences({ hideOffline: !hideOffline }), [hideOffline]);
  const selectedRef = useCallback(
    (node: View | null) => {
      if (!IS_TV || !onSelectedHandle) return;
      onSelectedHandle(node ? (findNodeHandle(node) ?? undefined) : undefined);
    },
    [onSelectedHandle],
  );
  const status = useSyncExternalStore(subscribeGuideStatus, guideStatus);
  const busy = status.state === "downloading" || status.state === "parsing";

  if (choices.length <= 1 && !cornerActions) return null;
  return (
    <View style={styles.band}>
      {cornerActions ? <View style={[styles.cornerBox, { width: cornerWidth }]}>{cornerActions}</View> : null}
      <View style={styles.cellsHost}>
        <ScanBand active={busy || updating === true} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cells} contentContainerStyle={styles.cellsContent}>
          {choices.map((choice) => {
            const selected = choice.filter === filter;
            return <GuideGroupCell key={choice.filter} ref={selected ? selectedRef : undefined} label={choice.label} selected={selected} onPress={() => select(choice.filter)} />;
          })}
          {/* A toggle beside the filters, not one of them: it narrows whichever filter is picked. */}
          <GuideGroupCell label={t("liveTv.hideOffline")} selected={hideOffline} onPress={toggleOffline} />
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: "row",
    alignItems: "center",
    height: HUD_BAR_HEIGHT,
  },
  cellsContent: {
    alignItems: "center",
  },
  cornerBox: {
    height: GROUP_CELL_HEIGHT,
    justifyContent: "center",
  },
  // Wears the tiles' floor so the band reads full even past the last group.
  cellsHost: {
    flex: 1,
    alignSelf: "stretch",
    backgroundColor: HUD_CELL_BACKGROUND,
  },
  cells: {
    flex: 1,
    flexGrow: 1,
  },
  scanHost: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
  scan: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "20%",
    experimental_backgroundImage: SCAN_WASH,
  },
});
