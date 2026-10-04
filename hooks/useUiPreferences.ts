import { getUiPreferences, subscribeUiPreferences, type UiPreferences } from "@/services/uiPreferences";
import { useSyncExternalStore } from "react";

/** The interface preferences, following every change. */
export function useUiPreferences(): UiPreferences {
  return useSyncExternalStore(subscribeUiPreferences, getUiPreferences);
}
