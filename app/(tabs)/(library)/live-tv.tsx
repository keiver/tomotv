import { AmbientBackground } from "@/components/ambient-background";
import { GuideCanvas } from "@/components/live-tv/guide-canvas";
import { GuideCornerActions, HUD_ACTION_ICON, HudAction } from "@/components/live-tv/guide-corner-actions";
import { GuideHud } from "@/components/live-tv/guide-hud";
import { gridEdgePadding } from "@/constants/app";
import { ServerConnectScreen } from "@/components/settings/ServerConnectScreen";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useChannelFavoritesSync } from "@/hooks/useChannelFavoritesSync";
import { useGuide } from "@/hooks/useGuide";
import { lastKnownTunerData } from "@/services/jellyfinApi";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { activeGuideUrls, refreshExternalGuide } from "@/services/externalGuide";
import { t } from "@/services/i18n";
import { showToast } from "@/services/toast";
import type { JellyfinItem, JellyfinProgram } from "@/types/jellyfin";
import { EXTERNAL_GUIDE_PREFIX, guideMetrics, NO_GUIDE_PREFIX } from "@/utils/guide";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter, type NativeStackNavigationOptions } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findNodeHandle, Platform, StyleSheet, View } from "react-native";
import { SafeAreaListener, useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const COLUMN_WIDTH = guideMetrics(IS_TV).channelColumnWidth;
// Phone: the guide refresh cell pinned before the groups, a 44pt touch target.
const PHONE_REFRESH_CELL_WIDTH = 44;

/**
 * The Live TV screen: the guide, whose channel column tunes on select, with Recordings and
 * Schedule one press away. The livetv tab's root on TV; a pushed library-stack route on phone.
 * Signed out, the tab keeps its trigger (static-trigger rule) and shows the connect widget.
 */
export default function LiveTvRoute() {
  const { isConnected, isReady } = useAuth();
  if (!isReady) return null;
  if (!isConnected) return <ServerConnectScreen title={t("liveTv.title")} />;
  return <LiveTvScreen />;
}

function LiveTvScreen() {
  const router = useRouter();
  const contextInsets = useSafeAreaInsets();
  // TV: the tab's SafeAreaProvider first renders with the window's insets, then the tab bar's;
  // the body waits for this view's own native measurement so it never lays out twice.
  const [measuredInsets, setMeasuredInsets] = useState<EdgeInsets | null>(null);
  const handleInsets = useCallback(({ insets: next }: { insets: EdgeInsets }) => IS_TV && setMeasuredInsets(next), []);
  const insets = IS_TV ? measuredInsets : contextInsets;
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
  useChannelFavoritesSync();
  // Another sign-in remounts the canvas cold: no scroll, focus or strip carries over from the last server.
  const session = useAuthSession();
  const preferences = useLiveTvPreferences();
  // The Channels pill wears the filled filter symbol while a filter holds the channels.
  const filtered = preferences.filter !== "all";
  const [stripHandle, setStripHandle] = useState<number | undefined>(undefined);
  // The refresh circle shows only while an external guide is in play: the viewer's or a playlist's.
  const hasExternalGuide = activeGuideUrls(preferences, lastKnownTunerData()?.tvgUrls ?? []).length > 0;
  const { retry } = guide;
  // The refresh press announces itself and its outcome; armed so the passive loads
  // (first open, paging, window growth) stay silent.
  const refreshToastArmed = useRef(false);
  const refreshGuide = useCallback(() => {
    refreshExternalGuide();
    retry();
    refreshToastArmed.current = true;
    showToast({ id: "guide-refresh", title: t("liveTv.guideDownloading"), progress: true });
  }, [retry]);
  const guideWorking = guide.isLoading || guide.isUpdating;
  const guideFailed = !!guide.error;
  useEffect(() => {
    if (guideWorking || !refreshToastArmed.current) return;
    refreshToastArmed.current = false;
    showToast({ id: "guide-refresh", title: t(guideFailed ? "liveTv.guideUnavailable" : "liveTv.guideUpdated"), kind: guideFailed ? "error" : "success" });
  }, [guideWorking, guideFailed]);

  const tune = useCallback(
    (channelId: string, channelName: string) => {
      showGlobalLoader();
      router.push({ pathname: "/player", params: { videoId: channelId, videoName: channelName, live: "1" } });
    },
    [router, showGlobalLoader],
  );
  const openProgram = useCallback(
    (program: JellyfinProgram, channel: JellyfinItem) => {
      // No-guide and external-guide cells are not server programs: the panel opens on the channel.
      const serverProgram = !!program.Id && !program.Id.startsWith(NO_GUIDE_PREFIX) && !program.Id.startsWith(EXTERNAL_GUIDE_PREFIX);
      router.push({ pathname: "/video-info", params: serverProgram ? { videoId: program.Id, name: program.Name } : { videoId: channel.Id, name: channel.Name } });
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
  const openChannel = useCallback((channel: JellyfinItem) => router.push({ pathname: "/video-info", params: { videoId: channel.Id, name: channel.Name } }), [router]);
  const openRecordings = useCallback(() => router.push("/recordings"), [router]);
  const openSchedule = useCallback(() => router.push("/schedule"), [router]);
  const openChannels = useCallback(() => router.push("/channels"), [router]);

  // TV frames the column half a grid edge in; phone runs it flush to the screen edge.
  const edgeLeft = IS_TV ? gridEdgePadding(insets?.left ?? 0, IS_TV) / 2 : (insets?.left ?? 0);
  // Phone: the transparent native header floats over the content, so the body starts under it.
  const topClearance = IS_TV ? 10 + (insets?.top ?? 0) : headerHeight + 8;
  // Phone: Channels, Recordings and Schedule are native bar items; TV draws them as labelled glass pills.
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () =>
      IS_TV
        ? {}
        : {
            title: params.name ?? t("liveTv.title"),
            unstable_headerRightItems: () => [
              {
                type: "button",
                label: t("liveTv.channels"),
                icon: { type: "sfSymbol", name: "square.grid.2x2" },
                tintColor: COLORS.ACCENT,
                onPress: openChannels,
              },
              { type: "button", label: t("liveTv.recordings"), icon: { type: "sfSymbol", name: "record.circle" }, tintColor: COLORS.ACCENT, onPress: openRecordings },
              { type: "button", label: t("liveTv.scheduled"), icon: { type: "sfSymbol", name: "calendar" }, tintColor: COLORS.ACCENT, onPress: openSchedule },
            ],
          },
    [params.name, openRecordings, openChannels, openSchedule],
  );

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <SafeAreaListener style={styles.container} onChange={handleInsets}>
        <AmbientBackground />
        {insets && (
          <View style={[styles.body, { paddingLeft: edgeLeft, paddingTop: topClearance }]}>
            <GuideCanvas
              key={session}
              guide={guide}
              filter={preferences.filter}
              topFocusHandle={stripHandle ?? topFocusHandle}
              hudRow={
                <GuideHud
                  cornerWidth={IS_TV ? COLUMN_WIDTH : PHONE_REFRESH_CELL_WIDTH}
                  cornerActions={
                    IS_TV ? (
                      <GuideCornerActions
                        filtered={filtered}
                        onChannels={openChannels}
                        onRecordings={openRecordings}
                        onSchedule={openSchedule}
                        onRefreshGuide={hasExternalGuide ? refreshGuide : undefined}
                        refreshing={guide.isUpdating}
                        onFirstRef={handleFirstActionRef}
                      />
                    ) : hasExternalGuide ? (
                      <HudAction
                        label={t("liveTv.guideRefresh")}
                        onPress={refreshGuide}
                        disabled={guide.isUpdating}
                        icon={<Ionicons name="refresh-outline" size={HUD_ACTION_ICON} color={COLORS.ACCENT} />}
                      />
                    ) : undefined
                  }
                  onSelectedHandle={setStripHandle}
                  updating={guide.isUpdating || guide.isLoading}
                />
              }
              onProgramPress={handleProgramPress}
              onProgramLongPress={openProgram}
              onChannelPress={handleChannelPress}
              onChannelLongPress={openChannel}
            />
          </View>
        )}
      </SafeAreaListener>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
});
