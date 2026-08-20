import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { isPlaybackHeld } from "@/services/playbackHold";
import { logger } from "@/utils/logger";

/**
 * Custom hook that triggers a callback when the app comes to the foreground
 * (transitions from background/inactive to active state)
 *
 * Skipped while playback holds the link: the refresh storm (cache wipe plus one
 * refetch per mounted folder screen) competes with stream startup. Screens refetch on focus.
 *
 * @param onForeground - Callback to execute when app enters foreground
 * @param context - Context name for logging (e.g., "LibraryContext")
 */
export function useAppStateRefresh(onForeground: () => void, context: string): void {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // Refresh when app comes to foreground (background/inactive -> active)
      if (appState.current.match(/inactive|background/) && nextAppState === "active") {
        if (isPlaybackHeld()) {
          logger.debug("Foreground refresh skipped (playback active)", { context });
        } else {
          logger.info("App came to foreground, triggering refresh", {
            context,
            previousState: appState.current,
          });
          onForeground();
        }
      }
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [onForeground, context]);
}
