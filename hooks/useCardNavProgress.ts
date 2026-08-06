import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

// If focus never leaves the card (navigation failed, or nothing stole focus), clear the bar anyway so
// it can't stick on screen.
const SAFETY_TIMEOUT_MS = 5000;

/**
 * Card-local "navigation in progress" state for the per-card progress bar. A card calls
 * `startNavProgress()` on press and `resetNavProgress()` when it loses focus — on tvOS the destination
 * screen grabbing focus blurs the source card, which is the natural handoff that brackets the load
 * gap. Phone has no focus engine and the card's onBlur never fires, so the equivalent handoff there
 * is the SCREEN losing navigation focus once the destination has pushed over it. A safety timeout
 * guarantees the bar never sticks if neither happens (e.g. the press didn't navigate).
 */
export function useCardNavProgress() {
  const [navigating, setNavigating] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const startNavProgress = useCallback(() => {
    clearTimer();
    setNavigating(true);
    timeoutRef.current = setTimeout(() => setNavigating(false), SAFETY_TIMEOUT_MS);
  }, [clearTimer]);

  const resetNavProgress = useCallback(() => {
    clearTimer();
    setNavigating(false);
  }, [clearTimer]);

  // Clear any pending timer on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  // Phone handoff: the navigation blur fires after the destination's push transition completes, so
  // the complete-then-fade plays while the card is covered and the bar is gone by the time the user
  // pops back. tvOS keeps the card-blur handoff untouched.
  useFocusEffect(
    useCallback(() => {
      if (Platform.isTV) return;
      return resetNavProgress;
    }, [resetNavProgress]),
  );

  return { navigating, startNavProgress, resetNavProgress };
}
