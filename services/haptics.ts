import { logger } from "@/utils/logger";
import { Platform } from "react-native";

/**
 * A light tap under the finger. Required on use, never at module scope: expo-haptics' podspec is iOS only, so
 * autolinking leaves it out of the tvOS build and evaluating it there throws.
 */
export async function tapFeedback(): Promise<void> {
  if (Platform.isTV) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Haptics = require("expo-haptics") as typeof import("expo-haptics");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch (error) {
    logger.debug("Haptics unavailable", { service: "Haptics", error: String(error) });
  }
}
