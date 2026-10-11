/**
 * Dev screenshot aid for the Mac build: pins the window to the App Store capture
 * size (applestore/captures/mac). Toggled by a long press on the platform pill in
 * Open Source; the flag lives in the device defaults so a reload keeps the lock.
 */
import { IS_MAC } from "@/utils/hostEnvironment";
import { NativeModules, Settings } from "react-native";

const KEY = "dev_screenshot_size_lock";
/** AppKit points: 2880x1800 px on a 2x display. */
export const SCREENSHOT_WINDOW_SIZE = { width: 1440, height: 900 };

type DeviceEnvironmentModule = { setWindowSizeLock?: (enabled: boolean, width: number, height: number) => void };

export function isScreenshotSizeLocked(): boolean {
  try {
    return Settings.get(KEY) === 1;
  } catch {
    return false;
  }
}

function apply(enabled: boolean): void {
  (NativeModules.DeviceEnvironment as DeviceEnvironmentModule | undefined)?.setWindowSizeLock?.(enabled, SCREENSHOT_WINDOW_SIZE.width, SCREENSHOT_WINDOW_SIZE.height);
}

/** Flips the lock, stores it, and returns the new state. */
export function toggleScreenshotSizeLock(): boolean {
  const next = !isScreenshotSizeLocked();
  try {
    Settings.set({ [KEY]: next ? 1 : 0 });
  } catch {
    // The window still pins for this run; only the reload persistence is lost.
  }
  apply(next);
  return next;
}

/** Re-pins a stored lock at launch. */
export function applyScreenshotSizeLockAtLaunch(): void {
  if (!__DEV__ || !IS_MAC) return;
  if (isScreenshotSizeLocked()) apply(true);
}
