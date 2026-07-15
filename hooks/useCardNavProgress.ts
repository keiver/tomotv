import { useCallback, useEffect, useRef, useState } from "react";

// If focus never leaves the card (navigation failed, or nothing stole focus), clear the bar anyway so
// it can't stick on screen.
const SAFETY_TIMEOUT_MS = 5000;

/**
 * Card-local "navigation in progress" state for the per-card progress bar. A card calls
 * `startNavProgress()` on press and `resetNavProgress()` when it loses focus — on tvOS the destination
 * screen grabbing focus blurs the source card, which is the natural handoff that brackets the load
 * gap. A safety timeout guarantees the bar never sticks if focus never leaves.
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

  return { navigating, startNavProgress, resetNavProgress };
}
