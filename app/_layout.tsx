import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, LogBox } from "react-native";
import { useEffect } from "react";
import "react-native-reanimated";

import { ErrorBoundary } from "@/components/error-boundary";
import { SearchPreloader } from "@/components/search-preloader";
import { AuthProvider } from "@/contexts/AuthContext";
import { LoadingProvider } from "@/contexts/LoadingContext";
import { LibraryProvider } from "@/contexts/LibraryContext";
import { PlayQueueProvider } from "@/contexts/PlayQueueContext";
import { registerMultiAudioPlugin } from "@/services/multiAudioLoader";

// Suppress yellow box warnings on TV platforms
if (Platform.isTV) {
  LogBox.ignoreAllLogs(true);
}

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
              <Stack screenOptions={{ contentStyle: { backgroundColor: "#3d3d3d" } }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                  name="player"
                  options={{
                    headerShown: false,
                    presentation: "fullScreenModal",
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
              </Stack>
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
