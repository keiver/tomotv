import { NativeModules, Platform } from "react-native";

/**
 * Whether the app is running on a Mac (an iOS build run by macOS, or Catalyst).
 *
 * React Native cannot tell: the idiom reads as "pad" and Platform.isMacCatalyst
 * is a compile-time flag, false for a "Designed for iPad" build. The answer comes
 * from ProcessInfo, through native/ios/MultiAudioResourceLoader/DeviceEnvironment.
 * A missing module or constant reads false, which is every phone and Apple TV.
 */
function readIsMac(): boolean {
  if (Platform.OS !== "ios") return false;
  const module = NativeModules.DeviceEnvironment as { isMac?: boolean; getConstants?: () => { isMac?: boolean } } | undefined;
  if (!module) return false;
  if (typeof module.isMac === "boolean") return module.isMac;
  try {
    return module.getConstants?.().isMac === true;
  } catch {
    return false;
  }
}

export const IS_MAC = readIsMac();
