import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

// If focus never leaves the card (navigation failed, or nothing stole focus), clear the bar anyway so
// it can't stick on screen.
const SAFETY_TIMEOUT_MS = 5000;
// How long the bar stays mounted after navigation ends — covers CardNavProgress's
// complete-then-fade handoff (140ms fill + 200ms fade) before the overlay unmounts.
const LINGER_MS = 350;

/**
 * Card-local "navigation in progress" state for the per-card progress bar. A card calls
 * `startNavProgress()` on press and `resetNavProgress()` when it loses focus — on tvOS the destination
 * screen grabbing focus blurs the source card, which is the natural handoff that brackets the load
 * gap. Phone has no focus engine and the card's onBlur never fires, so the equivalent handoff there
 * is the SCREEN losing navigation focus once the destination has pushed over it. A safety timeout
 * guarantees the bar never sticks if neither happens (e.g. the press didn't navigate).
 *
 * `visible` gates the bar's MOUNT: idle cards render no overlay at all (each bar costs shared
 * values, animated styles, and a blend-mode layer per card — dead weight across a whole grid).
 * It turns on with the press and lingers LINGER_MS after navigation ends so the
 * complete-then-fade plays before the unmount.
 */
export function useCardNavProgress() {
  const [navigating, setNavigating] = useState(false);
  const [visible, setVisible] = useState(false);
  // Mirrors `navigating` for the callbacks: resetNavProgress fires on EVERY blur/focus-return,
  // and a card that never navigated must not schedule linger timers or touch state.
  const navigatingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lingerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearLinger = useCallback(() => {
    if (lingerRef.current) {
      clearTimeout(lingerRef.current);
      lingerRef.current = null;
    }
  }, []);

  const resetNavProgress = useCallback(() => {
    clearTimer();
    if (!navigatingRef.current) return;
    navigatingRef.current = false;
    setNavigating(false);
    clearLinger();
    lingerRef.current = setTimeout(() => setVisible(false), LINGER_MS);
  }, [clearTimer, clearLinger]);

  const startNavProgress = useCallback(() => {
    clearTimer();
    clearLinger();
    navigatingRef.current = true;
    setVisible(true);
    setNavigating(true);
    timeoutRef.current = setTimeout(resetNavProgress, SAFETY_TIMEOUT_MS);
  }, [clearTimer, clearLinger, resetNavProgress]);

  // Clear any pending timers on unmount.
  useEffect(
    () => () => {
      clearTimer();
      clearLinger();
    },
    [clearTimer, clearLinger],
  );

  // Phone handoff: the navigation blur fires after the destination's push transition completes, so
  // the complete-then-fade plays while the card is covered and the bar is gone by the time the user
  // pops back. tvOS keeps the card-blur handoff untouched.
  useFocusEffect(
    useCallback(() => {
      if (Platform.isTV) return;
      return resetNavProgress;
    }, [resetNavProgress]),
  );

  return { navigating, visible, startNavProgress, resetNavProgress };
}
