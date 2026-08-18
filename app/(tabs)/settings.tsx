import { AmbientBackground } from "@/components/ambient-background";
import { BrandCorners } from "@/components/brand-corners";
import { AboutSection } from "@/components/settings/AboutSection";
import { ConnectedSection } from "@/components/settings/ConnectedSection";
import { ServerConnectFlow } from "@/components/settings/ServerConnectFlow";
import { QUALITY_SUBTITLE_LINE_HEIGHT, QUALITY_TITLE_LINE_HEIGHT, settingsStyles as styles } from "@/components/settings/styles";
import { CARD_FOCUS } from "@/constants/app";
import { DEMO_USERNAME, getStoredServerName, getStoredUserName, isDemoMode, signOut } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const STORAGE_KEYS = {
  SERVER_URL: "jellyfin_server_url",
  API_KEY: "jellyfin_api_key",
  USER_ID: "jellyfin_user_id",
  VIDEO_QUALITY: "app_video_quality",
};

type IoniconName = keyof typeof Ionicons.glyphMap;

// Original leads: it is the default and the only option that never re-encodes.
// `value` is the index into QUALITY_PRESETS in services/jellyfin/constants.ts
// and is what gets persisted, so the display order is free to differ from it.
// GB/hour figures derive from those bitrates (Mbps x 0.45).
const QUALITY_PRESETS: { label: string; value: number; icon: IoniconName; description: string }[] = [
  { label: "Auto", value: 5, icon: "diamond-outline", description: "No server work" },
  { label: "Fast server & network", value: 4, icon: "flash-outline", description: "4K · ~9 GB/h" },
  { label: "Fast network", value: 3, icon: "wifi-outline", description: "1080p · ~3.6 GB/h" },
  { label: "Average network", value: 2, icon: "speedometer-outline", description: "720p · ~1.8 GB/h" },
  { label: "Slow network", value: 1, icon: "hourglass-outline", description: "540p · ~1.1 GB/h" },
  { label: "Data saver", value: 0, icon: "leaf-outline", description: "480p · ~0.7 GB/h" },
];

type ScreenState = "LOADING" | "NOT_CONNECTED" | "CONNECTED";

export default function SettingsScreen() {
  const router = useRouter();

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
  // cache; awaiting the reload first lets the auth-change remounts settle before the pop runs,
  // otherwise it races the remount and the user is left on Settings. dismissTo rather than
  // navigate, for the reason in hooks/useFinishLogin.ts.
  const handleConnected = async () => {
    await loadCurrentState();
    router.dismissTo("/");
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
      await SecureStore.setItemAsync(STORAGE_KEYS.VIDEO_QUALITY, qualityValue.toString());
      // Look the label up by `value`, never by index: `value` indexes the presets
      // in services/jellyfin/constants.ts, and this array's display order differs
      // (Original leads), so indexing it named the wrong preset.
      const label = QUALITY_PRESETS.find((preset) => preset.value === qualityValue)?.label;
      Alert.alert("Success", `Video quality set to ${label || "Unknown"}`);
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
      <BrandCorners />

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

          <View style={[styles.sectionHeader, !Platform.isTV && styles.sectionHeaderFirst, screenState === "NOT_CONNECTED" && styles.connectHeaderSpacing]}>
            {/* Fixed now: the login steps that used to retitle this are their own routes
                (app/connect), each carrying its own header. The logged-out spacing matches
                the stand-in screen Home and Search render, which is the same view. */}
            <Text style={styles.sectionHeaderText}>JELLYFIN SERVER</Text>
          </View>

          {screenState === "NOT_CONNECTED" && <ServerConnectFlow onConnected={handleConnected} />}

          {screenState === "CONNECTED" && <ConnectedSection serverName={connectedServerName} serverUrl={connectedServerUrl} userName={connectedUserName} onSignOut={handleSignOut} />}

          {screenState === "CONNECTED" && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>VIDEO QUALITY</Text>
                <Text style={styles.sectionHeaderNote}>Options below Original are converted by your server in stereo.</Text>
              </View>

              {/* The preset list is taller than the space left under the server card, so it
                  scrolls inside the section instead of running off the bottom of the screen.
                  The wrapper carries the section's radius + overflow: hidden (clipping rows to
                  the card corners) and its inset shadow, which stays pinned to the card edges
                  while the transparent rows scroll over it. */}
              <View style={styles.section}>
                <ScrollView ref={qualityListRef} style={styles.sectionScrollable} showsVerticalScrollIndicator={false} nestedScrollEnabled focusable={false}>
                  {QUALITY_PRESETS.map((preset, index) => {
                    // One shade of gold for both states: selected wears it at rest, focus wears
                    // it while roaming, and the selected row keeps it under focus.
                    const selected = videoQuality === preset.value;
                    const goldWhen = (focused: boolean, pressed: boolean) => focused || pressed || selected;
                    return (
                      <Pressable
                        key={preset.value}
                        onFocus={index === 0 ? pinListToTop : index === QUALITY_PRESETS.length - 1 ? pinListToBottom : undefined}
                        style={({ focused, pressed }) => [
                          styles.listItem,
                          index === 0 && styles.listItemFirst,
                          index === QUALITY_PRESETS.length - 1 && styles.listItemLast,
                          goldWhen(focused, pressed) && styles.listItemFocused,
                          // A gold row at the card's edge covers the card's inset lip; re-paint it.
                          goldWhen(focused, pressed) && index === 0 && styles.rowShadowTop,
                          goldWhen(focused, pressed) && index === QUALITY_PRESETS.length - 1 && styles.rowShadowBottom,
                        ]}
                        onPress={() => handleQualityChange(preset.value)}
                        tvParallaxProperties={{ magnification: 1.01 }}
                        isTVSelectable={true}
                        accessibilityLabel={preset.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityHint={preset.description}>
                        {({ focused, pressed }) => {
                          const onGold = goldWhen(focused, pressed);
                          return (
                            <View style={styles.listItemContent}>
                              <View style={screenStyles.qualityLeft}>
                                <Ionicons name={preset.icon} size={Platform.isTV ? 30 : 20} color={onGold ? CARD_FOCUS.TITLE_TEXT_FOCUSED : "#FFC312"} />
                                <View style={styles.listItemLeft}>
                                  {/* Pinned leading: the section's height cap is QUALITY_ROW_HEIGHT
                                      times a row count, and that arithmetic only holds if these two
                                      lines measure what it assumes. */}
                                  <Text style={[styles.listItemTitle, screenStyles.qualityLabel, onGold && styles.listItemTitleFocused]}>{preset.label}</Text>
                                  <Text style={[styles.listItemSubtitle, screenStyles.qualityDescription, onGold && styles.listItemSubtitleFocused]}>{preset.description}</Text>
                                </View>
                              </View>
                              {/* The tick rides the selected row through both fills. */}
                              {selected && <Ionicons name="checkmark" size={Platform.isTV ? 28 : 24} color={onGold ? CARD_FOCUS.TITLE_TEXT_FOCUSED : "#FFC312"} />}
                            </View>
                          );
                        }}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </>
          )}

          {/* Connected only, matching the logged-out view Home and Search render (which now
              shows the server list and nothing else), so the two cannot drift. Note for anyone
              touching the quality list above: this row is what pinListToBottom exists for — it
              is the first focusable below that nested ScrollView, and focus can only leave a
              scrolled tvOS ScrollView downward once its offset is already at the end. */}
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
  qualityLabel: {
    lineHeight: QUALITY_TITLE_LINE_HEIGHT,
  },
  // The smallest text on the screen: the numbers are supporting detail.
  qualityDescription: {
    fontSize: Platform.isTV ? 18 : 12,
    lineHeight: QUALITY_SUBTITLE_LINE_HEIGHT,
  },
  qualityLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: Platform.isTV ? 16 : 12,
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
