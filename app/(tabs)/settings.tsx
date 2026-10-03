import { AmbientBackground } from "@/components/ambient-background";
import { BrandCorners } from "@/components/brand-corners";
import { localeScreen } from "@/components/locale-boundary";
import { LoadingRow } from "@/components/loading-row";
import { AboutSection } from "@/components/settings/AboutSection";
import { ConnectedSection } from "@/components/settings/ConnectedSection";
import { LinkLadder } from "@/components/settings/LinkLadder";
import { ListRow } from "@/components/settings/ListRow";
import { QualityMark } from "@/components/settings/QualityMark";
import { qualityLabel } from "@/components/settings/qualityRows";
import { ServerConnectFlow } from "@/components/settings/ServerConnectFlow";
import { SERVER_GLYPH } from "@/components/settings/ServerRow";
import { settingsStyles as styles } from "@/components/settings/styles";
import { transcodingRowSubtitle } from "@/components/settings/transcodingCopy";
import { UiSection } from "@/components/settings/UiSection";
import { useTranscodePermissions } from "@/hooks/useTranscodePermissions";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { carriedRungs, ORIGINAL_INDEX } from "@/services/adaptiveQuality";
import { rememberedBitrateStatus } from "@/services/jellyfin/bitrateTest";
import { refreshTranscodePermissions } from "@/services/jellyfin/transcodePermissions";
import { DEMO_USERNAME, getStoredUserName, getUserImageUrl, isAuthenticated, isDemoMode, subscribeAuthChange } from "@/services/jellyfinApi";
import { refreshAccess, subscribe as subscribeSyncPlay, SyncPlaySnapshot } from "@/services/syncPlayManager";
import { logger } from "@/utils/logger";
import { connectedLine } from "@/utils/syncPlayCopy";
import { pokeInbox } from "@/services/diagnosticsInbox";
import { useFocusEffect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { t } from "@/services/i18n";

const STORAGE_KEYS = {
  SERVER_URL: "jellyfin_server_url",
  API_KEY: "jellyfin_api_key",
  USER_ID: "jellyfin_user_id",
  VIDEO_QUALITY: "app_video_quality",
};

type ScreenState = "LOADING" | "NOT_CONNECTED" | "CONNECTED";

export default localeScreen(SettingsScreen);

function SettingsScreen() {
  const router = useRouter();

  const [screenState, setScreenState] = useState<ScreenState>("LOADING");
  const [connectedServerUrl, setConnectedServerUrl] = useState("");
  const [connectedUserName, setConnectedUserName] = useState("");
  const [connectedUserId, setConnectedUserId] = useState("");
  // Default mirrors DEFAULT_QUALITY in jellyfinApi.ts (Original), so the row's line matches
  // what playback actually uses before a choice is saved. The Quality page writes it; this
  // tab re-reads it on focus.
  const [videoQuality, setVideoQuality] = useState(5);
  const { serverTranscoding } = useUiPreferences();
  const permissions = useTranscodePermissions();

  const loadCurrentState = async (): Promise<ScreenState> => {
    try {
      const [savedUrl, savedKey, savedUserId, savedQuality, savedUserName, demoActive] = await Promise.all([
        SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL),
        SecureStore.getItemAsync(STORAGE_KEYS.API_KEY),
        SecureStore.getItemAsync(STORAGE_KEYS.USER_ID),
        SecureStore.getItemAsync(STORAGE_KEYS.VIDEO_QUALITY),
        getStoredUserName(),
        isDemoMode(),
      ]);

      if (savedQuality) setVideoQuality(parseInt(savedQuality, 10));

      // A stored session shows the connected card + Switch Server (and the streaming rows).
      // This only reads saved creds, it never pings the server, preserving the
      // no-auto-connect behavior.
      if (savedUrl && savedKey && savedUserId) {
        setConnectedServerUrl(savedUrl || "");
        setConnectedUserId(savedUserId);
        // Demo sessions store no username (demo.ts writes only url/key/userId),
        // but the login itself is AuthenticateByName with the fixed
        // DEMO_USERNAME account, so the flag maps to that name.
        setConnectedUserName(demoActive ? DEMO_USERNAME : savedUserName || "");
        setScreenState("CONNECTED");
        return "CONNECTED";
      }
      setScreenState("NOT_CONNECTED");
      return "NOT_CONNECTED";
    } catch (error) {
      logger.error("Error loading settings state", error);
      setScreenState("NOT_CONNECTED");
      return "NOT_CONNECTED";
    }
  };

  // The remembered link to the connected server lights the Auto mark's rungs. Memory only: the
  // Quality page is where a measurement runs. On focus, not on mount: the tab stays mounted
  // across a server switch.
  const [measuredBps, setMeasuredBps] = useState<number | null>(null);
  const [syncPlay, setSyncPlay] = useState<SyncPlaySnapshot | null>(null);

  useEffect(() => subscribeSyncPlay(setSyncPlay), []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const state = await loadCurrentState();
        if (cancelled || state !== "CONNECTED") return;
        void refreshAccess();
        void refreshTranscodePermissions();
        const status = await rememberedBitrateStatus();
        if (cancelled) return;
        // Replaces the previous server's reading outright: null until measured.
        setMeasuredBps(status?.bps ?? null);
      })();
      return () => {
        cancelled = true;
        Keyboard.dismiss();
      };
    }, []),
  );

  // Sign-out fires from the pushed server list with this screen mounted behind it, so a state
  // read on focus arrives a whole pop too late: the connected card is what the user watches the
  // transition uncover. isAuthenticated is synchronous, so the swap lands in the same frame as
  // the press, and the page goes back to its top because what replaces the connected screen is
  // a fraction of its height.
  const pageRef = useRef<ScrollView>(null);

  // The About rows live on this tab: a look at it, or a scroll on it, is when a session an Apple
  // TV sent should be found. The inbox folds bursts into one read and does nothing on tvOS.
  useFocusEffect(
    useCallback(() => {
      void pokeInbox();
    }, []),
  );
  const pokeOnScroll = useCallback(() => void pokeInbox(), []);
  useEffect(
    () =>
      subscribeAuthChange(() => {
        // Only the losing half moves the scroll: this signal also carries a recovered
        // connection, and that must not yank the page out from under someone reading it.
        if (!isAuthenticated()) {
          setScreenState("NOT_CONNECTED");
          pageRef.current?.scrollTo({ y: 0, animated: false });
        }
        void loadCurrentState();
      }),
    [],
  );

  // After a login from this screen, flip to the connected card, then drop the user on the root
  // view of the Library tab. The flow has already refreshed the library and cleared the folder
  // cache; awaiting the reload first lets the auth-change remounts settle before the pop runs,
  // otherwise it races the remount and the user is left on Settings. dismissTo rather than
  // navigate, for the reason in hooks/useFinishLogin.ts.
  const handleConnected = async () => {
    await loadCurrentState();
    router.dismissTo("/");
  };

  // Switching (and signing out) happens on the pushed server list, a real route so
  // Menu/back walks home for free. Focus reload picks up whatever happened there.
  const handleSwitchServer = () => {
    router.push("/connect/servers");
  };

  if (screenState === "LOADING") {
    return (
      <View style={styles.screenContainer}>
        <AmbientBackground />
        <View style={screenStyles.loadingContainer}>
          <LoadingRow label={t("settings.loading")} />
        </View>
      </View>
    );
  }

  const carried = carriedRungs(measuredBps);

  return (
    <View style={styles.screenContainer}>
      {/* Everything from here to the ScrollView is decoration, and the order is
          load-bearing rather than cosmetic: siblings paint in order, so all of it
          sits BEHIND the rows. On tvOS a view drawn above a focusable occludes it and
          the focus engine refuses to enter; pointerEvents cannot opt out of that.
          app/filters.tsx renders the same ghost title early for the same reason. The
          corners are also clear of the centred content column (1000pt wide, so
          x 460-1460 on a 1920 screen), so their frames never intersect a row. */}
      <AmbientBackground />
      <BrandCorners />

      <ScrollView
        ref={pageRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        onScrollEndDrag={pokeOnScroll}
        onMomentumScrollEnd={pokeOnScroll}
        focusable={false}>
        <View style={styles.contentContainer}>
          {/* Phone: same 28pt title header the Search tab uses, flush with the content line.
              TV has no screen titles (the top tab bar names the screen). */}
          {!Platform.isTV && <Text style={styles.screenTitle}>{t("tab.settings")}</Text>}

          <View
            style={[styles.sectionHeader, !Platform.isTV && styles.sectionHeaderFirst, !Platform.isTV && screenStyles.serverHeader, screenState === "NOT_CONNECTED" && styles.connectHeaderSpacing]}>
            {/* Fixed now: the login steps that used to retitle this are their own routes
                (app/connect), each carrying its own header. The logged-out spacing matches
                the stand-in screen Home and Search render, which is the same view. */}
            <Text style={styles.sectionHeaderText}>{t("settings.jellyfinServer")}</Text>
          </View>

          {screenState === "NOT_CONNECTED" && <ServerConnectFlow onConnected={handleConnected} />}

          {screenState === "CONNECTED" && (
            <ConnectedSection
              serverUrl={connectedServerUrl}
              userName={connectedUserName}
              userImageUri={connectedUserId ? getUserImageUrl(connectedServerUrl, connectedUserId) : undefined}
              onSwitchServer={handleSwitchServer}>
              {/* Shown unless the server has said no. Gating on a resolved access instead
                  mounted the row after /Users/Me came back, which re-rounded the card under
                  the reader on every cold open. */}
              {syncPlay?.access !== "None" ? (
                <ListRow
                  icon="people"
                  title={t("settings.syncplay")}
                  unread={!!syncPlay?.group}
                  subtitle={syncPlay?.group ? connectedLine(syncPlay.group.participants, syncPlay.group.state) : t("settings.syncplaySubtitle")}
                  trailingIcon="chevron-forward"
                  onPress={() => router.push("/syncplay")}
                  isLast
                />
              ) : null}
            </ConnectedSection>
          )}

          {screenState === "CONNECTED" && (
            <>
              <View style={[styles.sectionHeader, screenStyles.streamingHeader]}>
                <Text style={styles.sectionHeaderText}>{t("settings.streaming")}</Text>
              </View>
              <View style={styles.section}>
                {/* The preset's own mark, as its row on the Quality page draws it: the link's
                    rungs on Auto, the picture block on a pinned rung. */}
                <ListRow
                  icon={({ color }) => (videoQuality === ORIGINAL_INDEX ? <LinkLadder carried={carried} color={color} /> : <QualityMark value={videoQuality} color={color} />)}
                  title={t("settings.qualityRow")}
                  subtitle={qualityLabel(videoQuality)}
                  trailingIcon="chevron-forward"
                  onPress={() => router.push("/quality")}
                  isFirst
                />
                <ListRow
                  icon={SERVER_GLYPH}
                  title={t("settings.transcodingRow")}
                  subtitle={transcodingRowSubtitle(serverTranscoding, permissions)}
                  trailingIcon="chevron-forward"
                  onPress={() => router.push("/transcoding")}
                  isLast
                />
              </View>
            </>
          )}

          {/* In both states, as the stand-in every other tab renders logged out. */}
          <UiSection />
          {/* No version line under this: the Open Source page carries it. */}
          <AboutSection showDiagnostics={screenState === "CONNECTED"} />
        </View>
      </ScrollView>
    </View>
  );
}

const screenStyles = StyleSheet.create({
  // Phone only: 4pt more air under the screen title than sectionHeaderFirst gives.
  serverHeader: {
    paddingTop: 12,
  },
  // Matches the UI and About headers below it.
  streamingHeader: {
    paddingTop: Platform.isTV ? 16 : 14,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
