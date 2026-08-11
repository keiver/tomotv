import { AmbientBackground } from "@/components/ambient-background";
import { FiltersGhostTitle } from "@/components/filters-ghost-title";
import { ConnectedSection } from "@/components/settings/ConnectedSection";
import { InfoRow } from "@/components/settings/InfoRow";
import { ServerConnectFlow } from "@/components/settings/ServerConnectFlow";
import { settingsStyles as styles } from "@/components/settings/styles";
import { DEMO_USERNAME, getStoredServerName, getStoredUserName, isDemoMode, signOut } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

// Resolves to the running binary's CFBundleShortVersionString, not to app.json — a
// device holding an older build reports that older build, which is what a version
// mark should say. buildNumber is left off: app.json pins it at "1", which says
// nothing true about an installed binary.
// Version only. The OS name and number are not stated: whoever is holding the remote
// already knows which box they are looking at.
const VERSION_LINE = Constants.expoConfig?.version ?? "";

// The left-edge spine carries both. Uppercased by the ghost component, so this reads
// "TOMO TV 2.1.0" once rotated.
const SPINE_LABEL = VERSION_LINE ? `Tomo TV ${VERSION_LINE}` : "Tomo TV";

const DOCS_HOST = "tomotv.app";

// Corner furniture is inset by 2% of its axis, floored at the overscan safe area.
// 2% of 1920 is 38pt and 2% of 1080 is 22pt, but a real Apple TV reports
// {59, 90, 59, 90} — the raw percentage would drop both corners into the band a TV
// is free to crop. Same Math.max that gridEdgePadding applies to the library grid.
const TV_SAFE_X = 90;
const TV_SAFE_Y = 60;
const CORNER_RATIO = 0.02;

// Large enough to resolve from arm's length, small enough to stay a corner mark. The
// 10:1 rule wants ~400pt of code for a 2m couch; this yields ~190pt, so it is a
// lean-in affordance rather than a sofa scan.
const QR_SIZE = 240;

const STORAGE_KEYS = {
  SERVER_URL: "jellyfin_server_url",
  API_KEY: "jellyfin_api_key",
  USER_ID: "jellyfin_user_id",
  VIDEO_QUALITY: "app_video_quality",
};

// Original leads: it is the default and the only option that never re-encodes.
// `value` is the index into QUALITY_PRESETS in services/jellyfinApi.ts and is
// what gets persisted, so the display order is free to differ from it.
const QUALITY_PRESETS = [
  { label: "Original", value: 5, description: "No re-encoding" },
  { label: "480p", value: 0, description: "Fast - Lower" },
  { label: "540p", value: 1, description: "Balanced - Good" },
  { label: "720p", value: 2, description: "Smooth - High" },
  { label: "1080p", value: 3, description: "Best - Highest" },
  { label: "4K", value: 4, description: "Ultra - Maximum" },
];

type ScreenState = "LOADING" | "NOT_CONNECTED" | "CONNECTED";

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const cornerX = Math.max(width * CORNER_RATIO, insets.left, insets.right, IS_TV ? TV_SAFE_X : 0);
  const cornerY = Math.max(height * CORNER_RATIO, insets.bottom, IS_TV ? TV_SAFE_Y : 0);

  const openLicenses = useCallback(() => router.push("/licenses"), [router]);

  const [screenState, setScreenState] = useState<ScreenState>("LOADING");
  const [connectedServerName, setConnectedServerName] = useState("");
  const [connectedServerUrl, setConnectedServerUrl] = useState("");
  const [connectedUserName, setConnectedUserName] = useState("");
  // Default mirrors DEFAULT_QUALITY in jellyfinApi.ts (Original), so the
  // highlighted row matches what playback actually uses before a choice is saved
  const [videoQuality, setVideoQuality] = useState(5);

  const loadCurrentState = async () => {
    try {
      const [savedUrl, savedKey, savedUserId, savedQuality, savedServerName, savedUserName, demoActive] = await Promise.all([
        SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL),
        SecureStore.getItemAsync(STORAGE_KEYS.API_KEY),
        SecureStore.getItemAsync(STORAGE_KEYS.USER_ID),
        SecureStore.getItemAsync(STORAGE_KEYS.VIDEO_QUALITY),
        getStoredServerName(),
        getStoredUserName(),
        isDemoMode(),
      ]);

      if (savedQuality) setVideoQuality(parseInt(savedQuality, 10));

      // A stored session shows the connected card + Sign Out (and Video Quality).
      // This only reads saved creds — it never pings the server, preserving the
      // no-auto-connect behavior. The saved-server list stays available below for
      // switching without a destructive sign-out.
      if (savedUrl && savedKey && savedUserId) {
        setConnectedServerName(savedServerName || savedUrl);
        setConnectedServerUrl(savedUrl || "");
        // Demo sessions store no username (demo.ts writes only url/key/userId),
        // but the login itself is AuthenticateByName with the fixed
        // DEMO_USERNAME account, so the flag maps to that name.
        setConnectedUserName(demoActive ? DEMO_USERNAME : savedUserName || "");
        setScreenState("CONNECTED");
      } else {
        setScreenState("NOT_CONNECTED");
      }
    } catch (error) {
      logger.error("Error loading settings state", error);
      setScreenState("NOT_CONNECTED");
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadCurrentState();
      return () => {
        Keyboard.dismiss();
      };
    }, []),
  );

  // After a login from this screen, flip to the connected card, then drop the user on the root
  // view of the Library tab. The flow has already refreshed the library and cleared the folder
  // cache; awaiting the reload first lets the auth-change remounts settle before navigate("/")
  // runs, otherwise it races the remount and the user is left on Settings.
  const handleConnected = async () => {
    await loadCurrentState();
    router.navigate("/");
  };

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut();
            setScreenState("NOT_CONNECTED");
            // signOut() already clears both manager caches; don't re-fetch here, since with
            // credentials gone that would just fire a request with an empty server URL.
          } catch (error) {
            logger.error("Error signing out", error);
            Alert.alert("Error", "Failed to sign out.");
          }
        },
      },
    ]);
  };

  // tvOS can only move focus UP and OUT of a ScrollView while its contentOffset.y is exactly 0:
  // RCTScrollViewComponentView's shouldUpdateFocusInContext (RN 0.85, line 1391) rejects any
  // upward focus update whose target lives outside the scroll view whenever the view is scrolled
  // even slightly. A rejected update leaves the press to scroll the list instead, which is the
  // "first Up does nothing, second Up reaches Sign Out" behavior. Landing on the first row is the
  // only moment focus can leave upward, so pin the offset to 0 there — unanimated, since the focus
  // engine's own reveal scroll is already in flight and the correction is a few points at most.
  const qualityListRef = useRef<ScrollView>(null);
  const pinListToTop = useCallback(() => {
    qualityListRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  const handleQualityChange = async (qualityValue: number) => {
    try {
      setVideoQuality(qualityValue);
      await SecureStore.setItemAsync(STORAGE_KEYS.VIDEO_QUALITY, qualityValue.toString());
      Alert.alert("Success", `Video quality set to ${QUALITY_PRESETS[qualityValue]?.label || "Unknown"}`);
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
          <ActivityIndicator size="small" color="#FFC312" />
          <Text style={screenStyles.loadingText}>Loading settings...</Text>
        </View>
      </View>
    );
  }

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

      {/* tvOS only, both of them. The spine needs a band of horizontal room the phone
          does not have — its content runs to within 20pt of each edge — and a QR is
          useless on the device you would scan it with. The phone keeps the version at
          the end of the scroll, where iOS About screens put it. */}
      {IS_TV && (
        <>
          <FiltersGhostTitle name={SPINE_LABEL} variant="vertical" />

          <View style={[screenStyles.cornerQr, { right: cornerX, bottom: cornerY }]}>
            <Image
              source={require("@/assets/images/tomotv-qr-1000px.png")}
              style={screenStyles.cornerQrImage}
              accessible={true}
              accessibilityRole="image"
              accessibilityLabel={`QR code for the setup guide at ${DOCS_HOST}`}
            />
            <Text style={screenStyles.cornerQrCaption}>{DOCS_HOST}</Text>
          </View>
        </>
      )}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        focusable={false}>
        <View style={styles.contentContainer}>
          {/* Phone: same 28pt title header as the Search and Library tabs — title at inset+8,
              10pt below it. TV has no screen titles (the top tab bar names the screen). */}
          {!Platform.isTV && <Text style={styles.screenTitle}>Settings</Text>}

          <View style={[styles.sectionHeader, !Platform.isTV && styles.sectionHeaderFirst]}>
            {/* Fixed now: the login steps that used to retitle this are their own routes
                (app/connect), each carrying its own header. */}
            <Text style={styles.sectionHeaderText}>JELLYFIN SERVER</Text>
          </View>

          {screenState === "NOT_CONNECTED" && <ServerConnectFlow onConnected={handleConnected} />}

          {screenState === "CONNECTED" && <ConnectedSection serverName={connectedServerName} serverUrl={connectedServerUrl} userName={connectedUserName} onSignOut={handleSignOut} />}

          {screenState === "CONNECTED" && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>VIDEO QUALITY</Text>
              </View>

              {/* The preset list is taller than the space left under the server card, so it
                  scrolls inside the section instead of running off the bottom of the screen.
                  The wrapper carries the section's radius + overflow: hidden (clipping rows to
                  the card corners) and its inset shadow, which stays pinned to the card edges
                  while the transparent rows scroll over it. */}
              <View style={styles.section}>
                <ScrollView ref={qualityListRef} style={styles.sectionScrollable} showsVerticalScrollIndicator={false} nestedScrollEnabled focusable={false}>
                  {QUALITY_PRESETS.map((preset, index) => (
                    <Pressable
                      key={preset.value}
                      onFocus={index === 0 ? pinListToTop : undefined}
                      style={({ focused }) => [
                        styles.listItem,
                        index === 0 && styles.listItemFirst,
                        index === QUALITY_PRESETS.length - 1 && styles.listItemLast,
                        focused && { backgroundColor: "rgba(255, 255, 255, 0.1)" },
                      ]}
                      onPress={() => handleQualityChange(preset.value)}
                      tvParallaxProperties={{ magnification: 1.01 }}
                      isTVSelectable={true}
                      accessibilityLabel={`${preset.label} quality`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: videoQuality === preset.value }}
                      accessibilityHint={`Set video quality to ${preset.label}. ${preset.description}`}>
                      <View style={styles.listItemContent}>
                        <View style={styles.listItemLeft}>
                          <Text style={styles.listItemTitle}>{preset.label}</Text>
                          <Text style={styles.listItemSubtitle}>{preset.description}</Text>
                        </View>
                        {videoQuality === preset.value && <Ionicons name="checkmark" size={Platform.isTV ? 28 : 24} color="#FFC312" />}
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            </>
          )}

          {/* Not optional and not decoration. app/licenses.tsx carries the license
              texts and the LGPL source offer for FFmpeg, GnuTLS, libtasn1,
              libunistring and Nettle, and the Help tab was the only thing that
              pushed it. Renders whether or not a server is connected — the offer
              cannot be behind a login. */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>ABOUT</Text>
          </View>
          <View style={styles.section}>
            <InfoRow icon="ribbon-outline" title="Acknowledgements" onPress={openLicenses} accessory="chevron" isFirst isLast />
          </View>

          {/* Phone's home for the version, where iOS About screens put it. */}
          {!IS_TV && !!VERSION_LINE && <Text style={screenStyles.phoneVersion}>{VERSION_LINE}</Text>}
        </View>
      </ScrollView>
    </View>
  );
}

const screenStyles = StyleSheet.create({
  // No fill and no radius: the asset is amber modules on transparency, so it sits
  // straight on the canvas. A white plate behind it would just be a box.
  cornerQr: {
    position: "absolute",
    alignItems: "center",
  },
  cornerQrImage: {
    width: QR_SIZE,
    height: QR_SIZE,
  },
  cornerQrCaption: {
    fontSize: 22,
    fontWeight: "600",
    color: "#8E8E93",
    letterSpacing: 0.5,
    marginTop: 6,
  },
  phoneVersion: {
    fontSize: 13,
    color: "#8E8E93",
    textAlign: "center",
    marginTop: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: Platform.isTV ? 30 : 18,
    color: "#98989D",
  },
});
