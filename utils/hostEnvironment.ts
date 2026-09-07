import { NativeModules, Platform } from "react-native";

/** The machine the app is on, as the diagnostics story names it. */
export type DeviceName = "iPhone" | "iPad" | "Mac" | "Apple TV";

type Environment = { isMac?: boolean; model?: string; marketingName?: string | null; cores?: number; memoryBytes?: number };

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
/** The model as Apple sells it ("iPhone 17 Pro"); null for a Mac or a model the module does not know. */
export const DEVICE_MARKETING_NAME: string | null = typeof ENVIRONMENT.marketingName === "string" && ENVIRONMENT.marketingName ? ENVIRONMENT.marketingName : null;
export const DEVICE_CORES: number | null = typeof ENVIRONMENT.cores === "number" ? ENVIRONMENT.cores : null;
export const DEVICE_MEMORY_BYTES: number | null = typeof ENVIRONMENT.memoryBytes === "number" ? ENVIRONMENT.memoryBytes : null;
