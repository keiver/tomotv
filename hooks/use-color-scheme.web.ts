import { useSyncExternalStore } from "react";

type ColorScheme = "light" | "dark" | null;

const QUERY = "(prefers-color-scheme: dark)";

const canMatch = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

function subscribe(onChange: () => void): () => void {
  if (!canMatch()) return () => {};
  const mediaQuery = window.matchMedia(QUERY);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

const getSnapshot = (): ColorScheme => (canMatch() ? (window.matchMedia(QUERY).matches ? "dark" : "light") : "light");

// The server has no preference to read, and "light" is what the client renders
// until matchMedia answers, so the two agree and hydration never mismatches.
const getServerSnapshot = (): ColorScheme => "light";

/**
 * Web-specific color scheme hook using matchMedia. Subscribes through
 * useSyncExternalStore, which reads the preference during render and gives SSR
 * its own snapshot, so there is no mount effect setting state a second time.
 */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
