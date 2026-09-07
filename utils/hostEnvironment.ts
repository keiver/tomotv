import { NativeModules, Platform } from "react-native";

/** The machine the app is on, as the diagnostics story names it. */
export type DeviceName = "iPhone" | "iPad" | "Mac" | "Apple TV";

type Environment = { isMac?: boolean; model?: string; cores?: number; memoryBytes?: number };

/**
 * native/ios/MultiAudioResourceLoader/DeviceEnvironment. React Native cannot tell a Mac: an
 * iOS build run by macOS reads as "pad" and Platform.isMacCatalyst is a compile-time flag.
 * A missing module reads as no Mac and no hardware, which is every test and Android.
 */
function readEnvironment(): Environment {
  if (Platform.OS !== "ios") return {};
  const module = NativeModules.DeviceEnvironment as (Environment & { getConstants?: () => Environment }) | undefined;
  if (!module) return {};
  if (typeof module.isMac === "boolean") return module;
  try {
    return module.getConstants?.() ?? {};
  } catch {
    return {};
  }
}

const ENVIRONMENT = readEnvironment();

export const IS_MAC = ENVIRONMENT.isMac === true;

export const THIS_DEVICE: DeviceName = Platform.isTV ? "Apple TV" : IS_MAC ? "Mac" : Platform.OS === "ios" && Platform.isPad ? "iPad" : "iPhone";

/** Apple's model identifier ("AppleTV6,2"), null where the native module is absent. */
export const DEVICE_MODEL: string | null = typeof ENVIRONMENT.model === "string" && ENVIRONMENT.model ? ENVIRONMENT.model : null;
export const DEVICE_CORES: number | null = typeof ENVIRONMENT.cores === "number" ? ENVIRONMENT.cores : null;
export const DEVICE_MEMORY_BYTES: number | null = typeof ENVIRONMENT.memoryBytes === "number" ? ENVIRONMENT.memoryBytes : null;

/** Apple TV only: four models, named as Apple sells them. A phone keeps its identifier. */
const APPLE_TV_NAMES: Record<string, string> = {
  "AppleTV5,3": "Apple TV HD",
  "AppleTV6,2": "Apple TV 4K",
  "AppleTV11,1": "Apple TV 4K (2nd generation)",
  "AppleTV14,1": "Apple TV 4K (3rd generation)",
};

export function marketingName(model: string | null): string | null {
  return model ? (APPLE_TV_NAMES[model] ?? null) : null;
}
