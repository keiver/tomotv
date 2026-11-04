/**
 * Recordings whose file is a provider's refusal and that this account could not delete: Jellyfin adds the file back
 * on its next folder refresh, so the recordings list skips these ids. Kept per server.
 */
import { getCachedConfig } from "@/services/jellyfin/session";
import { logger } from "@/utils/logger";
import { Settings } from "react-native";

const KEY = "refusedRecordings";

function readDocument(): Record<string, string[]> {
  try {
    const raw = Settings.get(KEY);
    const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
    return doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

/** The ids hidden on the signed-in server. */
export function hiddenRefusedRecordings(): ReadonlySet<string> {
  const ids = readDocument()[getCachedConfig().server];
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
}

export function hideRefusedRecording(itemId: string): void {
  const { server } = getCachedConfig();
  if (!server || !itemId) return;
  try {
    const doc = readDocument();
    const ids = new Set(Array.isArray(doc[server]) ? doc[server] : []);
    ids.add(itemId);
    Settings.set({ [KEY]: JSON.stringify({ ...doc, [server]: [...ids] }) });
  } catch (error) {
    logger.warn("Refused recording write failed", error, { service: "RefusedRecordings" });
  }
}
