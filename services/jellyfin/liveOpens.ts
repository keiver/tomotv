/**
 * The live streams this app opened on a server and has not closed, on disk. The server keeps a
 * tuner stream open until every open is closed, so an open a killed app never closed is closed
 * on the next launch. The server and device alone are kept; the token is the signed-in one.
 */
import { logger } from "@/utils/logger";
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

export const LIVE_OPENS_FILENAME = "live-opens.json";

export interface LiveOpen {
  server: string;
  deviceId: string;
}

let opens: Record<string, LiveOpen> | null = null;

function opensFile(): File {
  // tvOS grants an app no writable Documents; its caches are the persistent store it has.
  return new File(Platform.isTV ? Paths.cache : Paths.document, LIVE_OPENS_FILENAME);
}

function load(): Record<string, LiveOpen> {
  if (opens) return opens;
  try {
    const file = opensFile();
    opens = file.exists ? (JSON.parse(file.textSync()) as Record<string, LiveOpen>) : {};
  } catch (error) {
    logger.warn("Live opens read failed", error, { service: "LiveOpens" });
    opens = {};
  }
  return opens;
}

function save(): void {
  try {
    const file = opensFile();
    if (file.exists) file.delete();
    file.create();
    file.write(JSON.stringify(opens ?? {}));
  } catch (error) {
    logger.warn("Live opens write failed", error, { service: "LiveOpens" });
  }
}

export function recordOpen(liveStreamId: string, open: LiveOpen): void {
  load()[liveStreamId] = open;
  save();
}

export function recordClose(liveStreamId: string): void {
  const held = load();
  if (!(liveStreamId in held)) return;
  delete held[liveStreamId];
  save();
}

/** Every open still recorded, by live stream id. */
export function recordedOpens(): Record<string, LiveOpen> {
  return { ...load() };
}

/** Test seam. */
export function resetLiveOpens(): void {
  opens = null;
}
