import { LoadingRow } from "@/components/loading-row";
import { AmbientBackground } from "@/components/ambient-background";
import { BrandCorners } from "@/components/brand-corners";
import { AboutSection } from "@/components/settings/AboutSection";
import { ConnectedSection } from "@/components/settings/ConnectedSection";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { LinkSpeedHeading } from "@/components/settings/LinkSpeedHeading";
import { LinkLadder } from "@/components/settings/LinkLadder";
import { ListRow } from "@/components/settings/ListRow";
import { QualityMark } from "@/components/settings/QualityMark";
import { ServerConnectFlow } from "@/components/settings/ServerConnectFlow";
import { QUALITY_SUBTITLE_LINE_HEIGHT, QUALITY_TITLE_LINE_HEIGHT, settingsStyles as styles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { carriedRungs, FLOOR_INDEX, linkCarriesPreset, ORIGINAL_INDEX, presetNeedsMbps } from "@/services/adaptiveQuality";
import { measureIfIdle, rememberedBitrateStatus } from "@/services/jellyfin/bitrateTest";
import { QUALITY_PRESETS as PLAYER_PRESETS } from "@/services/jellyfin/constants";
import { DEMO_USERNAME, getStoredUserName, isAuthenticated, isDemoMode, subscribeAuthChange } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { useFocusEffect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Keyboard, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

const STORAGE_KEYS = {
  SERVER_URL: "jellyfin_server_url",
  API_KEY: "jellyfin_api_key",
  USER_ID: "jellyfin_user_id",
  VIDEO_QUALITY: "app_video_quality",
};

// Original leads: it is the default and the only option that never re-encodes.
// `value` is the index into QUALITY_PRESETS in services/jellyfin/constants.ts
// and is what gets persisted, so the display order is free to differ from it.
// GB/hour figures derive from those bitrates (Mbps x 0.45).
// Labels name what the row controls, not a guess about the network — the
// network is measured and shown by LinkSpeedHeading, and each row's capacity mark
// checks that measurement with the player's own rule.
// The leading mark is drawn from `value`: a picture block per rung, the connection
// meter on Auto. No glyph is stored here.
const QUALITY_PRESETS: { label: string; value: number; description: string }[] = [
  { label: "Auto", value: 5, description: "" },
  { label: "Up to 4K", value: 4, description: "~9 GB/h" },
  { label: "Up to 1080p", value: 3, description: "~3.6 GB/h" },
  { label: "Up to 720p", value: 2, description: "~1.8 GB/h" },
  { label: "Up to 540p", value: 1, description: "~1.1 GB/h" },
  { label: "Up to 480p", value: 0, description: "~0.7 GB/h" },
];

type ScreenState = "LOADING" | "NOT_CONNECTED" | "CONNECTED";

export default function SettingsScreen() {
  const router = useRouter();

  const [screenState, setScreenState] = useState<ScreenState>("LOADING");
  const [connectedServerUrl, setConnectedServerUrl] = useState("");
  const [connectedUserName, setConnectedUserName] = useState("");
  // Default mirrors DEFAULT_QUALITY in jellyfinApi.ts (Original), so the
  // highlighted row matches what playback actually uses before a choice is saved
  const [videoQuality, setVideoQuality] = useState(5);

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

      // A stored session shows the connected card + Switch Server (and Video Quality).
      // This only reads saved creds — it never pings the server, preserving the
      // no-auto-connect behavior.
      if (savedUrl && savedKey && savedUserId) {
        setConnectedServerUrl(savedUrl || "");
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

  // Measured link to the connected server, feeding the quality heading and the rows'
  // capacity marks. On focus, not on mount: the tab stays mounted across a server switch.
  const [measuredBps, setMeasuredBps] = useState<number | null>(null);
  const [measuring, setMeasuring] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const state = await loadCurrentState();
        if (cancelled || state !== "CONNECTED") return;
        const status = await rememberedBitrateStatus();
        if (cancelled) return;
        // Replaces the previous server's reading outright: null until measured.
        setMeasuredBps(status?.bps ?? null);
        if (status?.fresh) {
          setMeasuring(false);
          return;
        }
        setMeasuring(true);
        const bps = await measureIfIdle();
        if (cancelled) return;
        if (bps != null) setMeasuredBps(bps);
        setMeasuring(false);
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

  // The Auto row states the ceiling the heading's meter draws, off the same
  // carriedRungs call, so the two cannot disagree. Every line here is sized to
  // the ~237pt subtitle budget on a 375pt phone: these rows never wrap.
  const carried = carriedRungs(measuredBps);
  const autoDescription =
    measuredBps == null
      ? "Adjusts to your server connection"
      : carried === 0
        ? `Server connection is below ${PLAYER_PRESETS[FLOOR_INDEX].label}`
        : `Server connection handles ${PLAYER_PRESETS[carried - 1].label}`;
  // A preset out of reach names the speed it wants, in the pill's own unit, so
  // the two numbers compare directly. Repeating one sentence down the list
  // stated the count four times and the shortfall never.
  const rowSubtitle = (preset: { value: number; description: string }) => {
    if (preset.value === PLAYER_PRESETS.length - 1) return autoDescription;
    return measuredBps != null && !linkCarriesPreset(measuredBps, preset.value) ? `${preset.description} · needs ${presetNeedsMbps(preset.value)} Mbps` : preset.description;
  };

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

  // tvOS can only move focus UP and OUT of a ScrollView while its contentOffset.y is exactly 0:
  // RCTScrollViewComponentView's shouldUpdateFocusInContext (RN 0.85, line 1391) rejects any
  // upward focus update whose target lives outside the scroll view whenever the view is scrolled
  // even slightly. A rejected update leaves the press to scroll the list instead, which is the
  // "first Up does nothing, second Up reaches Sign Out" behavior. Landing on the first row is the
  // only moment focus can leave upward, so pin the offset to 0 there — unanimated, since the focus
  // engine's own reveal scroll is already in flight and the correction is a few points at most.
  // The same rule blocks focus DOWN and out (isMovingDown, line 1392): an
  // unfinished downward scroll swallows the press, which is the "first Down does
  // nothing, second Down reaches Acknowledgements" behavior. The last row is the
  // mirror of the first, so pin the offset to the bottom there.
  const qualityListRef = useRef<ScrollView>(null);
  const pinListToTop = useCallback(() => {
    qualityListRef.current?.scrollTo({ y: 0, animated: false });
  }, []);
  const pinListToBottom = useCallback(() => {
    qualityListRef.current?.scrollToEnd({ animated: false });
  }, []);

  const handleQualityChange = async (qualityValue: number) => {
    try {
      setVideoQuality(qualityValue);
      // No confirmation dialog: the tick moves to the row and the row takes the
      // gold, which is the confirmation.
      await SecureStore.setItemAsync(STORAGE_KEYS.VIDEO_QUALITY, qualityValue.toString());
    } catch (error) {
      logger.error("Error saving video quality", error);
      Alert.alert("Error", "Failed to save video quality");
    }
  };

  if (screenState === "LOADING") {
    return (
      <View style={styles.screenContainer}>
        <AmbientBackground />
        <View style={screenStyles.loadingContainer}>
          <LoadingRow label="Loading settings..." labelStyle={screenStyles.loadingText} />
        </View>
      </View>
    );
  }

  // Signed out this tab holds one section, so on TV it floats mid-screen like the stand-in the
  // Home and Search tabs render. Same treatment, same view, and phones stay top-aligned.
  const centerConnect = screenState === "NOT_CONNECTED" && Platform.isTV;

  return (
    <View style={styles.screenContainer}>
      {/* Everything from here to the ScrollView is decoration, and the order is
          load-bearing rather than cosmetic: siblings paint in order, so all of it
          sits BEHIND the rows. On tvOS a view drawn above a focusable occludes it and
          the focus engine refuses to enter — pointerEvents cannot opt out of that.
          app/filters.tsx renders the same ghost title early for the same reason. The
          corners are also clear of the centred content column (1000pt wide, so
          x 460-1460 on a 1920 screen), so their frames never intersect a row. */}
      <AmbientBackground />
      <BrandCorners />

      <ScrollView
        ref={pageRef}
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, centerConnect && styles.connectCentered]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        focusable={false}>
        <View style={styles.contentContainer}>
          {/* Phone: same 28pt title header the Search tab uses, flush with the content line.
              TV has no screen titles (the top tab bar names the screen). */}
          {!Platform.isTV && <Text style={styles.screenTitle}>Settings</Text>}

          <View
            style={[
              styles.sectionHeader,
              !Platform.isTV && styles.sectionHeaderFirst,
              !Platform.isTV && screenStyles.serverHeader,
              screenState === "NOT_CONNECTED" && !centerConnect && styles.connectHeaderSpacing,
            ]}>
            {/* Fixed now: the login steps that used to retitle this are their own routes
                (app/connect), each carrying its own header. The logged-out spacing matches
                the stand-in screen Home and Search render, which is the same view. */}
            <Text style={styles.sectionHeaderText}>JELLYFIN SERVER</Text>
          </View>

          {screenState === "NOT_CONNECTED" && <ServerConnectFlow onConnected={handleConnected} />}

          {screenState === "CONNECTED" && <ConnectedSection serverUrl={connectedServerUrl} userName={connectedUserName} onSwitchServer={handleSwitchServer} />}

          {screenState === "CONNECTED" && (
            <>
              <LinkSpeedHeading measuredBps={measuredBps} measuring={measuring} />

              {/* The preset list is taller than the space left under the server card, so it
                  scrolls inside the section instead of running off the bottom of the screen.
                  The wrapper carries the section's radius + overflow: hidden (clipping rows to
                  the card corners) and its inset shadow, which stays pinned to the card edges
                  while the transparent rows scroll over it. */}
              <View style={styles.section}>
                <ScrollView ref={qualityListRef} style={styles.sectionScrollable} showsVerticalScrollIndicator={false} nestedScrollEnabled focusable={false}>
                  {QUALITY_PRESETS.map((preset, index) => {
                    const selected = videoQuality === preset.value;
                    return (
                      <ListRow
                        key={preset.value}
                        icon={({ color }) => (preset.value === ORIGINAL_INDEX ? <LinkLadder carried={carried} color={color} /> : <QualityMark value={preset.value} color={color} />)}
                        title={preset.label}
                        subtitle={rowSubtitle(preset)}
                        // Pinned leading: the section's height cap is QUALITY_ROW_HEIGHT times a
                        // row count, and that arithmetic only holds if these two lines measure
                        // what it assumes.
                        titleStyle={screenStyles.qualityLabel}
                        subtitleStyle={screenStyles.qualityDescription}
                        // The tick rides the selected row, which wears the gold at rest.
                        trailingIcon={selected ? "checkmark" : undefined}
                        selected={selected}
                        onPress={() => handleQualityChange(preset.value)}
                        onFocus={index === 0 ? pinListToTop : index === QUALITY_PRESETS.length - 1 ? pinListToBottom : undefined}
                        isFirst={index === 0}
                        accessibilityLabel={preset.label}
                        accessibilityHint={rowSubtitle(preset)}
                        accessibilityState={{ selected }}
                      />
                    );
                  })}
                </ScrollView>
                <SectionFooter>
                  <Text style={screenStyles.qualityNote}>Only applies when your connection is slow or your server has to convert a file. Everything else plays at its original resolution.</Text>
                </SectionFooter>
              </View>
            </>
          )}

          {/* Connected only, matching the logged-out view Home and Search render (which now
              shows the server list and nothing else), so the two cannot drift. Note for anyone
              touching the quality list above: this section's first row is what pinListToBottom
              exists for, being the first focusable below that nested ScrollView, and focus can
              only leave a scrolled tvOS ScrollView downward once its offset is already at the
              end. */}
          {/* No version line under this. The phone shows it in the Libraries masthead and the TV
              on its left spine, both of which are always on screen while signed in; a third copy
              here was the one sitting under the tab bar. */}
          {screenState === "CONNECTED" && <AboutSection />}
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
  // The band the card runs out into, a shade under the rows so it reads as a footer and not
  // as one more row.
  qualityNote: {
    backgroundColor: COLORS.SURFACE_SUNKEN,
    paddingHorizontal: Platform.isTV ? 28 : 16,
    paddingVertical: Platform.isTV ? 20 : 12,
    fontSize: Platform.isTV ? 18 : 12,
    lineHeight: Platform.isTV ? 26 : 17,
    color: COLORS.TEXT_TERTIARY,
  },
  qualityLabel: {
    lineHeight: QUALITY_TITLE_LINE_HEIGHT,
  },
  // marginTop 0 overrides ListRow's subtitle air — QUALITY_ROW_HEIGHT budgets
  // only the title's 2pt gap between the lines.
  qualityDescription: {
    fontSize: Platform.isTV ? 22 : 14,
    lineHeight: QUALITY_SUBTITLE_LINE_HEIGHT,
    marginTop: 0,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  // No marginTop: LoadingRow centres the label against the spinner.
  loadingText: {
    fontSize: Platform.isTV ? 30 : 18,
    color: COLORS.TEXT_SECONDARY,
  },
});
