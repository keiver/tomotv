import { MultiviewLayoutOption } from "@/components/live-tv/multiview-layout-option";
import { COLORS } from "@/constants/colors";
import { useChannelWall } from "@/hooks/useChannelWall";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { t } from "@/services/i18n";
import { liveTileUnavailable } from "@/services/liveTiles";
import { updateLiveTvPreferences } from "@/services/liveTvPreferences";
import { switchLayout } from "@/utils/multiviewArrangement";
import { MULTIVIEW_LAYOUTS, type MultiviewLayoutName } from "@keiver/tomo-live";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo } from "react";
import { Platform, ScrollView, StyleSheet, Text, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const PAD = IS_TV ? 80 : 16;
const GUTTER = IS_TV ? 48 : 16;
const COLUMNS = 3;

/** Multiview's layouts drawn as they would fit this screen; the pressed one becomes the layout. */
export default function MultiviewLayoutScreen() {
  const router = useRouter();
  // The channel with the sound: it keeps playing, first in the new layout.
  const { sound } = useLocalSearchParams<{ sound?: string }>();
  const headerHeight = useHeaderHeight();
  const { width, height } = useWindowDimensions();
  const preferences = useLiveTvPreferences();
  const arrangement = preferences.multiview;
  const { wall } = useChannelWall(preferences);
  const ids = useMemo(() => wall.map((channel) => channel.Id), [wall]);
  const insets = useSafeAreaInsets();
  const left = IS_TV ? PAD : Math.max(PAD, insets.left);
  const right = IS_TV ? PAD : Math.max(PAD, insets.right);
  // Multiview's own screen: the window inside the safe area, under the same bar this screen has.
  const stage = IS_TV ? { width, height } : { width: width - insets.left - insets.right, height: height - headerHeight };
  // Six layouts in two even rows; floored so rounding never wraps the last one.
  const optionWidth = Math.floor((width - left - right - GUTTER * (COLUMNS - 1)) / COLUMNS);
  const choose = useCallback(
    (layout: MultiviewLayoutName) => {
      if (layout !== arrangement.layout) updateLiveTvPreferences({ multiview: switchLayout(arrangement, layout, ids, liveTileUnavailable, sound) });
      router.back();
    },
    [arrangement, ids, router, sound],
  );
  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.grid, { paddingTop: IS_TV ? 60 : headerHeight + 16, paddingLeft: left, paddingRight: right, columnGap: GUTTER }]}>
      {IS_TV ? <Text style={styles.title}>{t("liveTv.multiviewLayout")}</Text> : null}
      {MULTIVIEW_LAYOUTS.map((layout) => (
        <MultiviewLayoutOption
          key={layout}
          layout={layout}
          width={optionWidth}
          stage={stage}
          current={layout === arrangement.layout}
          hasTVPreferredFocus={layout === arrangement.layout}
          onPress={choose}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: IS_TV ? 48 : 24,
    paddingBottom: IS_TV ? 60 : 32,
  },
  title: {
    width: "100%",
    color: COLORS.TEXT_PRIMARY,
    fontSize: 48,
    fontWeight: "700",
  },
});
