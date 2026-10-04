/**
 * Whether the connected server offers Live TV, persisted so the tab bar mounts with the
 * right triggers next launch. Updated where the user views land (fetchUserViews).
 */
import { logger } from "@/utils/logger";
import { Settings } from "react-native";

export const LIVE_TV_AVAILABILITY_KEY = "app_live_tv_available";

let current: boolean | null = null;
const listeners = new Set<() => void>();

export function getLiveTvAvailability(): boolean {
  if (current === null) current = Settings.get(LIVE_TV_AVAILABILITY_KEY) === 1;
  return current;
}

export function updateLiveTvAvailability(hasLiveTv: boolean): void {
  if (getLiveTvAvailability() === hasLiveTv) return;
  current = hasLiveTv;
  try {
    Settings.set({ [LIVE_TV_AVAILABILITY_KEY]: hasLiveTv ? 1 : 0 });
  } catch (error) {
    logger.warn("Live TV availability write failed", error, { service: "LiveTvAvailability" });
  }
  for (const listener of listeners) listener();
}

export function subscribeLiveTvAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
