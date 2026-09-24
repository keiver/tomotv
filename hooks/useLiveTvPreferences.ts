import { getLiveTvPreferences, subscribeLiveTvPreferences, type LiveTvPreferences } from "@/services/liveTvPreferences";
import { useSyncExternalStore } from "react";

/** The live TV preferences, following every change. */
export function useLiveTvPreferences(): LiveTvPreferences {
  return useSyncExternalStore(subscribeLiveTvPreferences, getLiveTvPreferences);
}
