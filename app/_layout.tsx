import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, LogBox } from "react-native";
import { useEffect } from "react";
import "react-native-reanimated";

import { ErrorBoundary } from "@/components/error-boundary";
import { SearchPreloader } from "@/components/search-preloader";
import { AuthProvider } from "@/contexts/AuthContext";
import { LoadingProvider } from "@/contexts/LoadingContext";
import { LibraryProvider } from "@/contexts/LibraryContext";
import { LibraryFiltersProvider } from "@/contexts/LibraryFiltersContext";
import { PlayQueueProvider } from "@/contexts/PlayQueueContext";
import { registerMultiAudioPlugin } from "@/services/multiAudioLoader";

// Suppress yellow box warnings on TV platforms
if (Platform.isTV) {
  LogBox.ignoreAllLogs(true);
}

// Without a theme, expo-router's NavigationContainer falls back to the LIGHT DefaultTheme, whose
// colors.background (rgb(242,242,242)) paints the surfaces behind/between screens — visible as a
// white sheet under the top screen during the iOS interactive back-swipe (expo/expo#42545,
// react-native-screens#3758). Match it to the app canvas so nothing light can peek through.
const AppDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: "#141414",
  },
};

export default function RootLayout() {
  // Register native plugins on app startup
  useEffect(() => {
    registerMultiAudioPlugin();
  }, []);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <LoadingProvider>
          <LibraryProvider>
            <PlayQueueProvider>
              {/* Library filter selections live here (not in the (library) stack) so the Filters
                  route can be a ROOT screen that covers the tabs — a route inside (tabs) leaves the
                  native tab bar on screen to steal focus on tvOS. Both share this one provider. */}
              <LibraryFiltersProvider>
                <ThemeProvider value={AppDarkTheme}>
                  <Stack screenOptions={{ contentStyle: { backgroundColor: "#141414" } }}>
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
                    {/* Root route (covers the tabs) so the native tab bar can't steal focus while the
                      Filters panel is open. Regular push (not a modal) so it receives TV remote events. */}
                    <Stack.Screen
                      name="filters"
                      options={{
                        headerShown: false,
                        animation: "fade",
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
                  </Stack>
                </ThemeProvider>
              </LibraryFiltersProvider>
              {/* Warm the native search subsystem from launch; lives for the whole session. */}
              <SearchPreloader />
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
