import { AmbientBackground } from "@/components/ambient-background";
import { ConnectedSection } from "@/components/settings/ConnectedSection";
import { NotConnectedSection } from "@/components/settings/NotConnectedSection";
import { QuickConnectSection } from "@/components/settings/QuickConnectSection";
import { settingsStyles as styles } from "@/components/settings/styles";
import { UsernamePasswordSection } from "@/components/settings/UsernamePasswordSection";
import { clearFolderContentsCache } from "@/services/folderContentsCache";
import { useLibrary } from "@/contexts/LibraryContext";
import {
  authenticateByName,
  checkQuickConnectEnabled,
  connectToDemoServer,
  getSavedServers,
  getStoredServerName,
  removeSavedServer,
  renameSavedServer,
  resolveServerConnection,
  saveAuthResult,
  signOut,
} from "@/services/jellyfinApi";
import { subnetMismatchHint } from "@/services/networkDiscovery";
import { SavedServer } from "@/types/jellyfin";
import { useNetworkScan } from "@/hooks/useNetworkScan";
import { useQuickConnect } from "@/hooks/useQuickConnect";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

const STORAGE_KEYS = {
  SERVER_URL: "jellyfin_server_url",
  API_KEY: "jellyfin_api_key",
  USER_ID: "jellyfin_user_id",
  VIDEO_QUALITY: "app_video_quality",
  BURN_IN_IMAGE_SUBTITLES: "app_burn_in_image_subtitles",
};

const QUALITY_PRESETS = [
  { label: "480p", value: 0, description: "Fast - Lower" },
  { label: "540p", value: 1, description: "Balanced - Good" },
  { label: "720p", value: 2, description: "Smooth - High" },
  { label: "1080p", value: 3, description: "Best - Highest" },
  { label: "4K", value: 4, description: "Ultra - Maximum" },
];

type ScreenState = "LOADING" | "NOT_CONNECTED" | "QUICK_CONNECT" | "USERNAME_PASSWORD" | "CONNECTED";

export default function SettingsScreen() {
  const { refreshLibrary } = useLibrary();
  const router = useRouter();

  const [screenState, setScreenState] = useState<ScreenState>("LOADING");
  const [serverUrl, setServerUrl] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [serverName, setServerName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [connectedServerName, setConnectedServerName] = useState("");
  const [connectedServerUrl, setConnectedServerUrl] = useState("");
  const [videoQuality, setVideoQuality] = useState(2);
  const [burnInSubtitles, setBurnInSubtitles] = useState(true);
  const [isConnectingDemo, setIsConnectingDemo] = useState(false);
  const [savedServers, setSavedServers] = useState<SavedServer[]>([]);
  const [connectingServerId, setConnectingServerId] = useState<string | null>(null);

  const quickConnect = useQuickConnect();
  const scan = useNetworkScan();
  const serverUrlRef = useRef<TextInput>(null);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const loadCurrentState = async () => {
    try {
      const [savedUrl, savedKey, savedUserId, savedQuality, savedBurnIn, savedServerName, servers] = await Promise.all([
        SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL),
        SecureStore.getItemAsync(STORAGE_KEYS.API_KEY),
        SecureStore.getItemAsync(STORAGE_KEYS.USER_ID),
        SecureStore.getItemAsync(STORAGE_KEYS.VIDEO_QUALITY),
        SecureStore.getItemAsync(STORAGE_KEYS.BURN_IN_IMAGE_SUBTITLES),
        getStoredServerName(),
        getSavedServers(),
      ]);

      if (savedQuality) setVideoQuality(parseInt(savedQuality, 10));
      if (savedBurnIn !== null) setBurnInSubtitles(savedBurnIn === "true");
      setSavedServers(servers);

      // A stored session shows the connected card + Sign Out (and Video Quality).
      // This only reads saved creds — it never pings the server, preserving the
      // no-auto-connect behavior. The saved-server list stays available below for
      // switching without a destructive sign-out.
      if (savedUrl && savedKey && savedUserId) {
        setConnectedServerName(savedServerName || savedUrl);
        setConnectedServerUrl(savedUrl || "");
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

  // After any successful login, drop the user on the root view of the Library tab. Clearing the
  // folder cache makes the (mounted) libraries screen refetch fresh views; it also subscribes to
  // auth changes and refreshes itself.
  const goToLibraryRoot = useCallback(async () => {
    clearFolderContentsCache();
    router.navigate("/");
  }, [router]);

  React.useEffect(() => {
    if (quickConnect.status !== "AUTHENTICATED" || !quickConnect.authResult) return;
    // Mirror the demo-connect flow: await each step in sequence. Login reveals the Search tab,
    // which remounts the tab navigator; the awaits let that remount settle before goToLibraryRoot
    // navigates, otherwise navigate("/") races the remount and the user is left on Settings.
    (async () => {
      await refreshLibrary();
      await loadCurrentState();
      await goToLibraryRoot();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickConnect.status]);

  const handleConnectServer = async (address?: string) => {
    const trimmed = (address ?? serverUrl).trim();
    if (!trimmed) {
      Alert.alert("Missing Address", "Please enter your Jellyfin server IP, hostname, or URL.");
      return;
    }
    if (address !== undefined) setServerUrl(address);

    setIsValidating(true);
    try {
      // Accepts a bare IP/hostname (auto-discovers protocol + port) or a full URL.
      const { url: resolvedUrl, info } = await resolveServerConnection(trimmed);
      setServerUrl(resolvedUrl);
      setServerName(info.ServerName);

      const quickConnectEnabled = await checkQuickConnectEnabled(resolvedUrl);
      if (quickConnectEnabled) {
        quickConnect.initiate(resolvedUrl, info.ServerName);
        setScreenState("QUICK_CONNECT");
      } else {
        setScreenState("USERNAME_PASSWORD");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to connect to server.";
      // A private address on another subnet is a common dead end that the probe
      // errors alone can't explain, so name it when we can see it.
      const hint = subnetMismatchHint(trimmed, scan.local);
      Alert.alert("Connection Failed", hint ? `${message}\n\n${hint}` : message);
    } finally {
      setIsValidating(false);
      setConnectingServerId(null);
    }
  };

  const handleSelectServer = (server: SavedServer) => {
    // Tapping a saved card prefills the address and runs the normal login flow.
    setConnectingServerId(server.id);
    handleConnectServer(server.url);
  };

  const handleSelectDiscovered = (url: string) => {
    // Discovered rows are keyed by url, so that's what drives their spinner.
    setConnectingServerId(url);
    handleConnectServer(url);
  };

  const reloadSavedServers = async () => {
    try {
      setSavedServers(await getSavedServers());
    } catch (error) {
      logger.error("Error reloading saved servers", error);
    }
  };

  const promptRenameServer = (server: SavedServer) => {
    Alert.prompt(
      "Rename Server",
      "Enter a name for this server.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: async (text?: string) => {
            await renameSavedServer(server.id, text ?? "");
            await reloadSavedServers();
          },
        },
      ],
      "plain-text",
      server.name,
    );
  };

  const confirmRemoveServer = (server: SavedServer) => {
    Alert.alert("Remove Server", "Remove this saved server?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await removeSavedServer(server.id);
          await reloadSavedServers();
        },
      },
    ]);
  };

  // Long-press a saved card → edit (rename) or remove it.
  const handleServerOptions = (server: SavedServer) => {
    Alert.alert(server.name, undefined, [
      { text: "Edit Name", onPress: () => promptRenameServer(server) },
      { text: "Remove", style: "destructive", onPress: () => confirmRemoveServer(server) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleSignIn = async () => {
    const trimmedUser = username.trim();
    if (!trimmedUser) {
      Alert.alert("Missing Username", "Please enter your username.");
      return;
    }

    setIsSigningIn(true);
    try {
      const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
      const auth = await authenticateByName(cleanUrl, trimmedUser, password);
      await saveAuthResult(cleanUrl, auth.AccessToken, auth.User.Id, auth.User.Name, serverName, "password");
      await refreshLibrary();
      await loadCurrentState();
      await goToLibraryRoot();
    } catch (error) {
      Alert.alert("Sign In Failed", error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleConnectDemo = async () => {
    setIsConnectingDemo(true);
    try {
      await connectToDemoServer();
      await refreshLibrary();
      await loadCurrentState();
      await goToLibraryRoot();
    } catch (error) {
      Alert.alert("Demo Connection Failed", error instanceof Error ? error.message : "Unable to connect to demo server.");
    } finally {
      setIsConnectingDemo(false);
    }
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
            setServerUrl("");
            setUsername("");
            setPassword("");
            setServerName("");
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

  const handleBurnInSubtitlesToggle = async () => {
    const newValue = !burnInSubtitles;
    try {
      setBurnInSubtitles(newValue);
      await SecureStore.setItemAsync(STORAGE_KEYS.BURN_IN_IMAGE_SUBTITLES, newValue.toString());
    } catch (error) {
      logger.error("Error saving burn-in subtitles setting", error);
      setBurnInSubtitles(!newValue);
      Alert.alert("Error", "Failed to save subtitle setting");
    }
  };

  const switchToUsernamePassword = () => {
    quickConnect.cancel();
    setScreenState("USERNAME_PASSWORD");
  };

  const switchToQuickConnect = () => {
    setUsername("");
    setPassword("");
    quickConnect.initiate(serverUrl.trim(), serverName);
    setScreenState("QUICK_CONNECT");
  };

  const goBackToServerUrl = () => {
    quickConnect.cancel();
    setUsername("");
    setPassword("");
    setScreenState("NOT_CONNECTED");
  };

  if (screenState === "LOADING") {
    return (
      <View style={screenStyles.container}>
        <AmbientBackground />
        <View style={screenStyles.loadingContainer}>
          <ActivityIndicator size="small" color="#FFC312" />
          <Text style={screenStyles.loadingText}>Loading settings...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={screenStyles.container}>
      <AmbientBackground />
      <ScrollView
        style={screenStyles.scrollView}
        contentContainerStyle={screenStyles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        focusable={false}>
        <View style={screenStyles.contentContainer}>
          <View style={screenStyles.sectionHeader}>
            <Text style={screenStyles.sectionHeaderText}>JELLYFIN SERVER</Text>
          </View>

          {screenState === "NOT_CONNECTED" && (
            <NotConnectedSection
              serverUrl={serverUrl}
              setServerUrl={setServerUrl}
              serverUrlRef={serverUrlRef}
              isValidating={isValidating}
              isConnectingDemo={isConnectingDemo}
              onConnect={handleConnectServer}
              onConnectDemo={handleConnectDemo}
              savedServers={savedServers}
              connectingServerId={connectingServerId}
              onSelectServer={handleSelectServer}
              onServerOptions={handleServerOptions}
              scan={scan}
              onSelectDiscovered={handleSelectDiscovered}
            />
          )}

          {screenState === "QUICK_CONNECT" && (
            <QuickConnectSection code={quickConnect.code} status={quickConnect.status} error={quickConnect.error} onCancel={goBackToServerUrl} onSwitchToPassword={switchToUsernamePassword} />
          )}

          {screenState === "USERNAME_PASSWORD" && (
            <UsernamePasswordSection
              username={username}
              setUsername={setUsername}
              password={password}
              setPassword={setPassword}
              usernameRef={usernameRef}
              passwordRef={passwordRef}
              isSigningIn={isSigningIn}
              onSignIn={handleSignIn}
              onBack={goBackToServerUrl}
              onSwitchToQuickConnect={switchToQuickConnect}
              serverName={serverName}
            />
          )}

          {screenState === "CONNECTED" && <ConnectedSection serverName={connectedServerName} serverUrl={connectedServerUrl} onSignOut={handleSignOut} />}

          {screenState === "CONNECTED" && (
            <>
              <View style={screenStyles.sectionHeader}>
                <Text style={screenStyles.sectionHeaderText}>SUBTITLES</Text>
              </View>

              <View style={styles.section}>
                <Pressable
                  style={({ focused }) => [styles.listItem, styles.listItemFirst, styles.listItemLast, focused && { backgroundColor: "rgba(255, 255, 255, 0.1)" }]}
                  onPress={handleBurnInSubtitlesToggle}
                  tvParallaxProperties={{ magnification: 1.01 }}
                  isTVSelectable={true}
                  accessibilityLabel="Burn in image subtitles"
                  accessibilityRole="button"
                  accessibilityState={{ selected: burnInSubtitles }}
                  accessibilityHint="When a video only has image-based subtitles like Blu-ray PGS, draw them into the picture during transcoding">
                  <View style={styles.listItemContent}>
                    <View style={styles.listItemLeft}>
                      <Text style={styles.listItemTitle}>Burn In Image Subtitles</Text>
                      <Text style={styles.listItemSubtitle}>Show Blu-ray/DVD subtitles when no text subtitles exist</Text>
                    </View>
                    {burnInSubtitles && <Ionicons name="checkmark" size={Platform.isTV ? 28 : 24} color="#FFC312" />}
                  </View>
                </Pressable>
              </View>

              <View style={screenStyles.sectionHeader}>
                <Text style={screenStyles.sectionHeaderText}>VIDEO QUALITY</Text>
              </View>

              <View style={styles.section}>
                {QUALITY_PRESETS.map((preset, index) => (
                  <Pressable
                    key={preset.value}
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
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const screenStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: Platform.isTV ? 20 : 16,
    paddingBottom: Platform.isTV ? 60 : 40,
    alignItems: "center",
  },
  contentContainer: {
    width: "100%",
    maxWidth: Platform.isTV ? 1000 : 600,
    paddingHorizontal: Platform.isTV ? 60 : 16,
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
  sectionHeader: {
    paddingHorizontal: Platform.isTV ? 16 : 16,
    paddingTop: Platform.isTV ? 32 : 24,
    paddingBottom: Platform.isTV ? 12 : 8,
  },
  sectionHeaderText: {
    fontSize: Platform.isTV ? 28 : 16,
    fontWeight: "600",
    color: "#98989D",
    letterSpacing: -0.08,
  },
});
