import { engineLog } from "./config";
import { engineModule, isLocalRemuxAvailable } from "./native";

/** SpatialAudioBridge's license notices as the linked build ships them; null without the engine. */
export async function spatialAudioNotices(): Promise<string | null> {
  if (!isLocalRemuxAvailable() || typeof engineModule().spatialAudioNotices !== "function") return null;
  try {
    const text: unknown = await engineModule().spatialAudioNotices();
    return typeof text === "string" && text.length > 0 ? text : null;
  } catch (error) {
    engineLog().warn("SpatialAudioBridge notices unavailable", error, { service: "LocalRemux" });
    return null;
  }
}
