import { AmbientBackground } from "@/components/ambient-background";
import { GuideCanvas } from "@/components/live-tv/guide-canvas";
import { GuideCornerActions, HUD_ACTION_ICON, HudAction, scheduleSymbol } from "@/components/live-tv/guide-corner-actions";
import { GuideHud } from "@/components/live-tv/guide-hud";
import { SfSymbolIcon } from "@/components/sf-symbol-icon";
import { gridEdgePadding, LIBRARY_ROOT_TITLE } from "@/constants/app";
import { ServerConnectScreen } from "@/components/settings/ServerConnectScreen";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useChannelFavoritesSync } from "@/hooks/useChannelFavoritesSync";
import { useGuide } from "@/hooks/useGuide";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { useIsRecording } from "@/hooks/useRecordingStatus";
import { refreshExternalGuide } from "@/services/externalGuide";
import { t } from "@/services/i18n";
import { invalidateLiveTvSearchIndex } from "@/services/jellyfinApi";
import { dismissToast, showToast } from "@/services/toast";
import type { JellyfinItem, JellyfinProgram } from "@/types/jellyfin";
import { guideMetrics, guideRefreshOutcome } from "@/utils/guide";
import { programInfoParams } from "@/utils/programInfo";
import { Stack, useIsFocused, useLocalSearchParams, useRouter, type NativeStackNavigationOptions } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, findNodeHandle, Platform, StyleSheet, View } from "react-native";
import { SafeAreaListener, useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const IS_PAD = !IS_TV && Platform.OS === "ios" && Platform.isPad;
const COLUMN_WIDTH = guideMetrics(IS_TV).channelColumnWidth;
// Phone: the guide refresh cell pinned before the groups, a 44pt touch target.
const PHONE_REFRESH_CELL_WIDTH = 44;

/**
 * The Live TV screen: the guide, whose channel column tunes on select, with Recordings and
 * Schedule one press away. The livetv tab's root on TV; a pushed root-stack route on phone.
 * Signed out, the tab keeps its trigger (static-trigger rule) and shows the connect widget.
 */
export default function LiveTvRoute() {
  const { isConnected, isReady } = useAuth();
  // A refresh remounts the screen: first channel, the current half hour, every listing loaded again.
  const [refreshes, setRefreshes] = useState(0);
  const refreshGuide = useCallback(() => {
    refreshExternalGuide();
    // Search reads the server's listings again too, so a refreshed guide answers in search at once.
    invalidateLiveTvSearchIndex();
    setRefreshes((count) => count + 1);
    showToast({ id: "guide-refresh", title: t("liveTv.guideDownloading"), progress: true });
  }, []);
  if (!isReady) return null;
  if (!isConnected) return <ServerConnectScreen title={t("liveTv.title")} />;
  return <LiveTvScreen key={refreshes} refreshed={refreshes > 0} onRefresh={refreshGuide} />;
}

interface LiveTvScreenProps {
  /** Mounted by a refresh press: the first load announces its outcome. */
  refreshed: boolean;
  onRefresh: () => void;
}

function LiveTvScreen({ refreshed, onRefresh: refreshGuide }: LiveTvScreenProps) {
  const router = useRouter();
  const { accent } = useCardPalette();
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
  const recording = useIsRecording();
  const [stripHandle, setStripHandle] = useState<number | undefined>(undefined);
  // A refresh's first load announces its outcome, and so does the first open once it fetched
  // programs behind the spinner; later loads (day picks, paging, window growth) stay silent.
  // The TV tab mounts and loads in the background, so only the focused screen arms or announces.
  const isFocused = useIsFocused();
  const refreshToastArmed = useRef(refreshed);
  const firstLoadRef = useRef(true);
  const guideWorking = guide.isLoading || guide.isUpdating;
  const guideFailed = !!guide.error;
  const hasListings = guide.rows.some((row) => row.programs.length > 0);
  useEffect(() => {
    if (isFocused && firstLoadRef.current && guide.isLoading && guide.isUpdating) refreshToastArmed.current = true;
  }, [isFocused, guide.isLoading, guide.isUpdating]);
  useEffect(() => {
    if (guideWorking) return;
    firstLoadRef.current = false;
    if (!refreshToastArmed.current) return;
    refreshToastArmed.current = false;
    if (!isFocused) {
      // A refresh left behind: resolve its progress toast quietly instead of announcing over another screen.
      dismissToast("guide-refresh");
      return;
    }
    const outcome = guideRefreshOutcome(guideFailed, hasListings);
    showToast({ id: "guide-refresh", title: t(outcome.title), kind: outcome.kind });
  }, [guideWorking, guideFailed, hasListings, isFocused]);

  const tune = useCallback(
    (channelId: string, channelName: string) => {
      showGlobalLoader();
      router.push({ pathname: "/player", params: { videoId: channelId, videoName: channelName, live: "1" } });
    },
    [router, showGlobalLoader],
  );
  const openProgram = useCallback(
    (program: JellyfinProgram, channel: JellyfinItem) => {
      router.push({ pathname: "/video-info", params: programInfoParams(program, channel) });
    },
    [router],
  );
  // The guide's clock through a ref: a press handler rebuilt each minute re-renders every cell.
  const nowRef = useRef(guide.nowMs);
  useEffect(() => {
    nowRef.current = guide.nowMs;
  }, [guide.nowMs]);
  const handleProgramPress = useCallback(
    (program: JellyfinProgram, channel: JellyfinItem) => {
      const startMs = Date.parse(program.StartDate ?? "");
      const endMs = Date.parse(program.EndDate ?? "");
      if (startMs <= nowRef.current && nowRef.current < endMs) tune(channel.Id, channel.Name);
      else openProgram(program, channel);
    },
    [tune, openProgram],
  );
  const handleChannelPress = useCallback((channel: JellyfinItem) => tune(channel.Id, channel.Name), [tune]);
  const openChannel = useCallback((channel: JellyfinItem) => router.push({ pathname: "/video-info", params: { videoId: channel.Id, name: channel.Name } }), [router]);
  const openRecordings = useCallback(() => router.push("/recordings"), [router]);
  const openSchedule = useCallback(() => router.push("/schedule"), [router]);
  const openChannels = useCallback(() => router.push("/channels"), [router]);

  // TV frames the column half a grid edge in; phone runs it flush to the screen edge.
  const edgeLeft = IS_TV ? gridEdgePadding(insets?.left ?? 0, IS_TV) / 2 : (insets?.left ?? 0);
  // Phone: the transparent native header floats over the content, so the body starts under it.
  const topClearance = IS_TV ? 10 + (insets?.top ?? 0) : headerHeight + (IS_PAD ? 20 : 8);
  // Phone: Channels, Recordings and Schedule are native bar items; TV draws them as labelled glass pills.
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () =>
      IS_TV
        ? {}
        : {
            title: params.name ?? t("liveTv.title"),
            headerBackTitle: LIBRARY_ROOT_TITLE,
            unstable_headerRightItems: () => [
              {
                type: "button",
                label: t("liveTv.channels"),
                icon: { type: "sfSymbol", name: "square.grid.2x2" },
                tintColor: accent,
                onPress: openChannels,
              },
              { type: "button", label: t("liveTv.recordings"), icon: { type: "sfSymbol", name: "record.circle" }, tintColor: accent, onPress: openRecordings },
              // Badged and red while a recording runs: the Schedule screen behind it is where it stops.
              {
                type: "button",
                label: t("liveTv.scheduled"),
                icon: { type: "sfSymbol", name: scheduleSymbol(recording) },
                tintColor: recording ? COLORS.DESTRUCTIVE : accent,
                onPress: openSchedule,
              },
            ],
          },
    [params.name, openRecordings, openChannels, openSchedule, recording, accent],
  );
  // Built apart from the canvas so the compiler keys it on the band's own inputs, not every guide render.
  const hudRow = (
    <GuideHud
      cornerWidth={IS_TV ? COLUMN_WIDTH : PHONE_REFRESH_CELL_WIDTH}
      cornerActions={
        IS_TV ? (
          <GuideCornerActions
            filtered={filtered}
            onChannels={openChannels}
            onRecordings={openRecordings}
            onSchedule={openSchedule}
            onRefreshGuide={refreshGuide}
            refreshing={guide.isUpdating}
            recording={recording}
            onFirstRef={handleFirstActionRef}
          />
        ) : (
          <HudAction
            label={t("liveTv.guideRefresh")}
            onPress={refreshGuide}
            disabled={guide.isUpdating}
            icon={guide.isUpdating ? <ActivityIndicator size="small" color={accent} /> : <SfSymbolIcon name="arrow.clockwise" size={HUD_ACTION_ICON} color={accent} weight="bold" />}
          />
        )
      }
      onSelectedHandle={setStripHandle}
    />
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
              hudRow={hudRow}
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
