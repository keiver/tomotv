import { COLORS } from "@/constants/colors";
import * as Linking from "expo-linking";
import { DarkTheme, Stack, ThemeProvider, useNavigationContainerRef } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { LogBox, Platform } from "react-native";
import { useCallback, useEffect } from "react";
import "react-native-reanimated";

import { preloadAmbientBackgrounds } from "@/components/ambient-background";
import { AudioMiniPlayer } from "@/components/audio-mini-player";
import { downloadManager } from "@/services/downloads/manager";
import { flushOfflinePositions } from "@/services/downloads/offlineProgress";
import { resetPlaybackReportBackoff } from "@/services/jellyfin/playback";
import { nudgeBitrateMemory, warmBitrateMemory } from "@/services/jellyfin/bitrateTest";
import { ErrorBoundary } from "@/components/error-boundary";
import { MacKeyCommands } from "@/components/mac-key-commands";
import { PlayerHost } from "@/components/player-host";
import { AuthProvider } from "@/contexts/AuthContext";
import { LoadingProvider } from "@/contexts/LoadingContext";
import { LibraryProvider } from "@/contexts/LibraryContext";
import { LibraryFiltersProvider } from "@/contexts/LibraryFiltersContext";
import { PlayerSessionProvider } from "@/contexts/PlayerSessionContext";
import { useAppStateRefresh } from "@/hooks/useAppStateRefresh";
import { PlayQueueProvider } from "@/contexts/PlayQueueContext";
import { registerMultiAudioPlugin } from "@/services/multiAudioLoader";
import { logger } from "@/utils/logger";

/**
 * LogBox off, both platforms.
 *
 * All of this is development-only by construction: React Native does not install LogBox in
 * release builds, so nothing here changes shipped behaviour.
 *
 * `ignoreAllLogs()` alone is not enough, and was also only applied on TV before. It sets
 * LogBoxData's `isDisabled`, which suppresses the notification toasts and nothing else:
 * `LogBoxInspectorContainer.render()` (react-native 0.85) never reads that flag, so an
 * uncaught error still takes over the whole screen. React Native offers no switch for that
 * screen. On tvOS it is worse than useless: it claims focus, and the remote cannot reliably
 * get out of it.
 *
 * So the uncaught-error path is intercepted before LogBox ever sees it. RN installs its own
 * handler in Libraries/Core/setUpErrorHandling.js
 * (`ErrorUtils.setGlobalHandler` -> `ExceptionsManager.handleException` -> LogBox); replacing
 * that handler means the error is logged and goes no further. Deliberate trade-off: a crash in
 * development now surfaces in the log rather than on screen.
 *
 * Not covered, and not coverable from here: a JavaScript SYNTAX error opens LogBox from the
 * bundler before any app code runs. React Native makes that one non-dismissable on purpose,
 * because the bundle cannot execute at all.
 */
LogBox.ignoreAllLogs(true);
if (__DEV__) {
  const errorUtils = (globalThis as unknown as { ErrorUtils?: { setGlobalHandler: (cb: (error: unknown, isFatal?: boolean) => void) => void } }).ErrorUtils;
  errorUtils?.setGlobalHandler((error, isFatal) => {
    logger.error("Uncaught JS error, LogBox suppressed", error, { component: "AppRoot", isFatal: isFatal === true });
  });
}

// Without a theme, expo-router's NavigationContainer falls back to the LIGHT DefaultTheme, whose
// colors.background (rgb(242,242,242)) paints the surfaces behind/between screens — visible as a
// white sheet under the top screen during the iOS interactive back-swipe (expo/expo#42545,
// react-native-screens#3758). Match it to the app canvas so nothing light can peek through.
// `primary` is the app's tint: on iOS every native-stack header takes it for the back
// chevron and its label (tintColor = headerTintColor ?? colors.primary,
// native-stack/views/useHeaderConfigProps.js:114), so the brand gold replaces the system
// blue without a per-screen override. Same value the tab bar and every FocusableButton use.
const AppDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: COLORS.BACKGROUND,
    primary: COLORS.ACCENT,
  },
};

export default function RootLayout() {
  // Register native plugins on app startup
  useEffect(() => {
    registerMultiAudioPlugin();
    preloadAmbientBackgrounds();
    // Reconciles the download manifest with the files on disk. Playback asks isReady()
    // synchronously, so it has to be true before any route can start something.
    void downloadManager.hydrate().then(() => flushOfflinePositions());
    // Background link measurement so playback routing reads warm memory
    // instead of ever probing on the session-start path.
    warmBitrateMemory();
  }, []);

  // Foregrounding is when the device may have changed networks. Also the moment a session
  // spent offline gets its resume positions to the server, and reporting stops standing down.
  const warmOnForeground = useCallback(() => {
    warmBitrateMemory();
    resetPlaybackReportBackoff();
    void flushOfflinePositions();
  }, []);
  useAppStateRefresh(warmOnForeground, "BitrateWarmup");

  // Browsing keeps the reading inside its refresh window. Skipped on the playback
  // routes and the panel before them: a probe there races the stream it sizes.
  const navigationRef = useNavigationContainerRef();
  useEffect(() => {
    return navigationRef.addListener("state", () => {
      // Cast: no ReactNavigation.RootParamList is declared, so the return type is `never`.
      const route = (navigationRef.getCurrentRoute() as { name?: string } | undefined)?.name;
      if (route === "player" || route === "audio-player" || route === "video-info") return;
      nudgeBitrateMemory();
    });
  }, [navigationRef]);

  // Deep links are sticky for the life of the PROCESS, not the JS context.
  // LinkingAppDelegateSubscriber writes every incoming URL into
  // ExpoLinkingRegistry.shared.initialURL (a Swift singleton) and nothing clears it; on iOS and
  // tvOS expo-router's getInitialURL is exactly that value (expo-router/build/link/linking.js:61-67
  // -> Linking.getLinkingURL()), and expo-router never calls clearInitialURL. A Metro reload
  // replaces the JS context but not the process, so the fresh JS asks for the initial URL and gets
  // the same deep link back — remounting /player on that videoId at every reload, hours later, an
  // item the current server may not even have. Clearing it here costs nothing: expo-router reads
  // the initial URL synchronously while building its store (global-state/useStore.js:56-61), long
  // before this effect runs, so the launching link still routes. Links that arrive later are
  // events (Linking.addEventListener), not this cache, so Top Shelf and the regression suite are
  // untouched.
  useEffect(() => {
    Linking.clearInitialURL();
  }, []);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <LoadingProvider>
          <LibraryProvider>
            <PlayQueueProvider>
              {/* The video player is mounted OUTSIDE the navigator, below, and driven through this
                  provider. It has to be: popping /player unmounts <Video>, and RCTVideo's teardown
                  nils the AVPlayer, which takes any Picture in Picture window down with it. Apple
                  says the same thing — the object that owns playback "must not be part of your view
                  hierarchy" if it is to survive PiP (WWDC20, Master Picture in Picture on tvOS). */}
              <PlayerSessionProvider>
                {/* Library filter selections live here (not in the (library) stack) so the Filters
                  route can be a ROOT screen that covers the tabs — a route inside (tabs) leaves the
                  native tab bar on screen to steal focus on tvOS. Both share this one provider. */}
                <LibraryFiltersProvider>
                  <ThemeProvider value={AppDarkTheme}>
                    <Stack screenOptions={{ contentStyle: { backgroundColor: COLORS.BACKGROUND } }}>
                      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                      {/* Regular push, NOT a fullScreenModal: UIModalPresentationFullScreen takes the RN
                      root view out of the window, so every native view below it sees window == nil and
                      back again. expo-tvos-search tears its UIHostingController out of the VC hierarchy
                      on that signal, and SwiftUI's .searchable never re-registers — the Search tab comes
                      back with no search field and no way to focus one. A root push covers the tabs just
                      the same (see filters/photo-viewer) and never leaves the window. */}
                      <Stack.Screen
                        name="player"
                        options={{
                          headerShown: false,
                          animation: "fade",
                          // The route is opaque black on both sides of the AVKit presentation, so
                          // react-native-screens' 500ms default dissolve is 500ms of nothing.
                          animationDuration: Platform.isTV ? undefined : 150,
                        }}
                      />
                      {/* Audio queue playback: same regular-push rules as player (TV remote events,
                      Menu pops natively). The native audio UI is PRESENTED by the Swift module over
                      this screen, not rendered by it. The fade is entrance-only: the screen flips
                      itself to animation "none" once pushed, so the pop is a cut and AVKit's own
                      dismissal is the only exit animation. */}
                      <Stack.Screen
                        name="audio-player"
                        options={{
                          headerShown: false,
                          animation: "fade",
                          // Opaque black route, same reasoning as player above.
                          animationDuration: Platform.isTV ? undefined : 150,
                        }}
                      />
                      {/* Regular push, NOT a modal: react-native-screens modals are presented outside
                      the RN root view, so RCTTVRemoteHandler press recognizers (root-view-attached)
                      never fire and the screen receives no TV remote events. */}
                      <Stack.Screen
                        name="photo-viewer"
                        options={{
                          headerShown: false,
                          animation: "fade",
                        }}
                      />
                      {/* Video Info panel. iPhone: native page sheet (presentation "modal") — slides
                      up, swipe-to-dismiss, and UIKit owns the layout in every orientation. NOT a
                      formSheet: react-native-screens blanks formSheet content on any detent relayout
                      (expand or rotation — RNS #2522/#2770); the page sheet has no detent math to
                      break. The presenting view stays in the window, so the fullScreenModal search
                      lesson above doesn't apply. tvOS: regular push styled as a floating card
                      (stack rules: no modals, Menu pops natively off the CTAs). iPad: transparent
                      modal, because a sheet there is readable-width and UIKit exposes no control
                      over what shows beside it, the screen draws its own blurred backdrop, which
                      only works while the presenting view stays in the window. */}
                      <Stack.Screen
                        name="video-info"
                        options={
                          Platform.isTV
                            ? { headerShown: false, animation: "fade" }
                            : Platform.OS === "ios" && Platform.isPad
                              ? { headerShown: false, presentation: "transparentModal", animation: "fade", contentStyle: { backgroundColor: "transparent" } }
                              : { headerShown: false, presentation: "modal" }
                        }
                      />
                      {/* Root route (covers the tabs) so the native tab bar can't steal focus while the
                      Filters panel is open. Regular push (not a modal) so it receives TV remote events.
                      Phone gets a transparent UINavigationBar whose back chevron is the close; the screen
                      titles it with the folder and hangs Clear All off it. TV shows no bar at all: its
                      items never take remote focus, so the panel keeps its own focusable row. */}
                      <Stack.Screen
                        name="filters"
                        options={
                          Platform.isTV
                            ? { headerShown: false, animation: "fade" }
                            : { headerShown: true, headerTransparent: true, headerShadowVisible: false, headerTitleStyle: { color: COLORS.TEXT_PRIMARY }, animation: "fade" }
                        }
                      />
                      {/* The login steps, one root route each so Menu walks back through them.
                      Root, not inside a tab, for the same reason as filters: the native tab bar
                      stays on screen there and swallows the Menu press — which is exactly how
                      these steps used to quit the app. Regular push, never a modal.

                      They are ROOT screens rather than a nested app/connect stack because iOS
                      draws the back item itself, and only for a screen that has a predecessor in
                      the same UINavigationController. As the first screen of a nested stack,
                      Quick Connect was that controller's root and could never have one. Phone
                      gets the standard push so the back item, the transition and the
                      interactive swipe agree; TV crossfades and shows no header at all. */}
                      <Stack.Screen
                        name="connect/servers"
                        options={{
                          headerShown: !Platform.isTV,
                          headerTransparent: true,
                          headerTitle: "",
                          headerBackTitle: "Back",
                          animation: Platform.isTV ? "fade" : "default",
                        }}
                      />
                      <Stack.Screen
                        name="connect/quick-connect"
                        options={{
                          headerShown: !Platform.isTV,
                          headerTransparent: true,
                          headerTitle: "",
                          // The step's own Cancel, moved into the bar: back here IS cancelling.
                          headerBackTitle: "Cancel",
                          animation: Platform.isTV ? "fade" : "default",
                        }}
                      />
                      <Stack.Screen
                        name="connect/login"
                        options={{
                          headerShown: !Platform.isTV,
                          headerTransparent: true,
                          headerTitle: "",
                          headerBackTitle: "Back",
                          animation: Platform.isTV ? "fade" : "default",
                        }}
                      />
                      {/* Open-source acknowledgements, pushed from Help. Same regular-push rules as
                      filters/photo-viewer (TV remote events, Menu pops natively). */}
                      <Stack.Screen
                        name="licenses"
                        options={{
                          headerShown: false,
                          animation: "fade",
                        }}
                      />
                      {/* The generated npm notice, pushed from Open Source. Same options: both
                      screens draw their own back row and would sit under a native header. */}
                      <Stack.Screen
                        name="bundled-licenses"
                        options={{
                          headerShown: false,
                          animation: "fade",
                        }}
                      />
                    </Stack>
                  </ThemeProvider>
                </LibraryFiltersProvider>
                {/* Renders nothing until a route asks for playback, and parks itself off screen
                    whenever the route has something focusable to show. */}
                <PlayerHost />
                {/* Transport for music whose native player has been dismissed. Phone only: an
                    absolute overlay above focusables occludes the tvOS focus engine. */}
                <AudioMiniPlayer />
                {/* Escape as the back key. Renders null anywhere but a Mac. */}
                <MacKeyCommands />
              </PlayerSessionProvider>
              <StatusBar style="light" />
            </PlayQueueProvider>
          </LibraryProvider>
        </LoadingProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export const unstable_settings = {
  anchor: "(tabs)",
};
