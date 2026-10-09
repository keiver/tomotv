import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { isPlaybackHeld } from "@/services/playbackHold";
import { logger } from "@/utils/logger";

/**
 * Custom hook that triggers a callback when the app returns from the background.
 * Launch reads "inactive" in a release build, and inactive alone never left the foreground.
 *
 * Skipped while playback holds the link: the refresh storm (cache wipe plus one
 * refetch per mounted folder screen) competes with stream startup. Screens refetch on focus.
 *
 * @param onForeground - Callback to execute when app enters foreground
 * @param context - Context name for logging (e.g., "LibraryContext")
 * @param onSkipped - Called when playback made the refresh skip, so a screen can owe one for later
 */
export function useAppStateRefresh(onForeground: () => void, context: string, onSkipped?: () => void): void {
  const wasBackgrounded = useRef(AppState.currentState === "background");
  const onSkippedRef = useRef(onSkipped);
  useEffect(() => {
    onSkippedRef.current = onSkipped;
  });

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "background") {
        wasBackgrounded.current = true;
        return;
      }
      if (nextAppState !== "active" || !wasBackgrounded.current) return;
      wasBackgrounded.current = false;
      if (isPlaybackHeld()) {
        logger.debug("Foreground refresh skipped (playback active)", { context });
        onSkippedRef.current?.();
      } else {
        logger.info("App came to foreground, triggering refresh", { context });
        onForeground();
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [onForeground, context]);
}
