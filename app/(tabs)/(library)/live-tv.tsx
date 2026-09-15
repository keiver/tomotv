import { AmbientBackground } from "@/components/ambient-background";
import { GlassButton } from "@/components/glass-button";
import { GuideCanvas } from "@/components/live-tv/guide-canvas";
import { gridEdgePadding } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { useGuide } from "@/hooks/useGuide";
import { useLiveTvManagement } from "@/hooks/useLiveTvManagement";
import { t } from "@/services/i18n";
import type { JellyfinItem, JellyfinProgram } from "@/types/jellyfin";
import { NO_GUIDE_PREFIX } from "@/utils/guide";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter, type NativeStackNavigationOptions } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useMemo, useState } from "react";
import { findNodeHandle, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const CIRCLE = 62;

/**
 * The Live TV screen: the guide, whose channel column tunes on select, with Recordings and
 * Schedule one press away. A pushed route inside the library stack, so Menu pops it natively.
 */
export default function LiveTvScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { showGlobalLoader } = useLoadingActions();
  const params = useLocalSearchParams<{ name?: string }>();
  const [topFocusHandle, setTopFocusHandle] = useState<number | undefined>(undefined);
  const handleFirstActionRef = useCallback((node: View | null) => {
    if (!IS_TV) return;
    const handle = node ? findNodeHandle(node) : null;
    setTopFocusHandle(handle ?? undefined);
  }, []);

  const guide = useGuide();
  const canManage = useLiveTvManagement();

  const tune = useCallback(
    (channelId: string, channelName: string) => {
      showGlobalLoader();
      router.push({ pathname: "/player", params: { videoId: channelId, videoName: channelName, live: "1" } });
    },
    [router, showGlobalLoader],
  );
  const openProgram = useCallback(
    (program: JellyfinProgram, channel: JellyfinItem) => {
      if (!program.Id || program.Id.startsWith(NO_GUIDE_PREFIX)) return;
      router.push({ pathname: "/program-info", params: { programId: program.Id, channelId: channel.Id, channelName: channel.Name } });
    },
    [router],
  );
  const handleProgramPress = useCallback(
    (program: JellyfinProgram, channel: JellyfinItem) => {
      const startMs = Date.parse(program.StartDate ?? "");
      const endMs = Date.parse(program.EndDate ?? "");
      if (startMs <= guide.nowMs && guide.nowMs < endMs) tune(channel.Id, channel.Name);
      else openProgram(program, channel);
    },
    [guide.nowMs, tune, openProgram],
  );
  const handleChannelPress = useCallback((channel: JellyfinItem) => tune(channel.Id, channel.Name), [tune]);
  const openRecordings = useCallback(() => router.push("/recordings"), [router]);
  const openSchedule = useCallback(() => router.push("/schedule"), [router]);

  // Half the grid edge: the guide's channel column is the screen's left frame, not a card.
  const edgeLeft = gridEdgePadding(insets.left, IS_TV) / 2;
  // Phone: the transparent native header floats over the content, so the body starts under it.
  const topClearance = IS_TV ? 10 + insets.top : headerHeight + 8;
  // Phone: Recordings and Schedule are native bar items; TV draws them as glass circles.
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () =>
      IS_TV
        ? {}
        : {
            title: params.name ?? t("liveTv.title"),
            unstable_headerRightItems: () => [
              { type: "button", label: t("liveTv.recordings"), icon: { type: "sfSymbol", name: "record.circle" }, tintColor: COLORS.ACCENT, onPress: openRecordings },
              ...(canManage
                ? [{ type: "button" as const, label: t("liveTv.scheduled"), icon: { type: "sfSymbol" as const, name: "calendar" as const }, tintColor: COLORS.ACCENT, onPress: openSchedule }]
                : []),
            ],
          },
    [params.name, openRecordings, openSchedule, canManage],
  );

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <View style={styles.container}>
        <AmbientBackground />
        <View style={[styles.header, { paddingTop: topClearance, paddingLeft: edgeLeft }]}>
          {IS_TV ? (
            <>
              <GlassButton
                ref={handleFirstActionRef}
                style={styles.circle}
                icon={<Ionicons name="recording-outline" size={30} color={COLORS.ACCENT} />}
                accessibilityLabel={t("liveTv.recordings")}
                onPress={openRecordings}
              />
              {canManage ? (
                <GlassButton style={styles.circle} icon={<Ionicons name="calendar-outline" size={30} color={COLORS.ACCENT} />} accessibilityLabel={t("liveTv.scheduled")} onPress={openSchedule} />
              ) : null}
            </>
          ) : null}
        </View>
        <View style={[styles.body, { paddingLeft: edgeLeft }]}>
          <GuideCanvas guide={guide} topFocusHandle={topFocusHandle} onProgramPress={handleProgramPress} onProgramLongPress={openProgram} onChannelPress={handleChannelPress} />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // TV: the circles sit over the channel column, so Up from a channel and Down from a circle are plain geometry.
  header: {
    flexDirection: "row",
    gap: IS_TV ? 24 : 0,
    paddingBottom: IS_TV ? 28 : 0,
  },
  body: {
    flex: 1,
  },
  // Square, which the base radius rounds to a circle; minHeight restated or the control floor wins.
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    minWidth: 0,
    minHeight: CIRCLE,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
});
