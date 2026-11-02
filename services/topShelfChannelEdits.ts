/**
 * Writes the signed-in account's hidden and renamed channels into the App Group container, where the
 * Top Shelf extension (native/ios/TopShelf/ShelfChannelEdits.swift) reads them, and tells tvOS the
 * shelf changed. One JSON file, rewritten only when its content changes.
 */
import { subscribeAuthChange } from "@/services/jellyfinApi";
import { getLiveTvPreferences, subscribeLiveTvPreferences, type LiveTvPreferences } from "@/services/liveTvPreferences";
import { logger } from "@/utils/logger";
import { Directory, File, Paths } from "expo-file-system";
import { NativeModules, Platform } from "react-native";

const APP_GROUP = "group.dev.keiver.tomotv";
export const SHELF_CHANNEL_EDITS_FILE = "topshelf-channel-edits.json";

/** The document the extension decodes: the lists as the preferences hold them, ids and numbers included. */
export function shelfChannelEditsDocument(preferences: Pick<LiveTvPreferences, "hidden" | "renames">): string {
  return JSON.stringify({ hidden: preferences.hidden, renames: preferences.renames });
}

/** Guarded on the module: a Metro reload can carry JS newer than the installed binary. */
function available(): boolean {
  return Platform.isTV && !!NativeModules.TopShelfReload?.reload;
}

function editsFile(): File | null {
  const root = Paths.appleSharedContainers[APP_GROUP];
  return root ? new File(new Directory(root, "Library", "Caches"), SHELF_CHANNEL_EDITS_FILE) : null;
}

let lastWritten: string | null = null;

function publish(): void {
  const file = editsFile();
  if (!file) return;
  const document = shelfChannelEditsDocument(getLiveTvPreferences());
  if (document === lastWritten) return;
  try {
    new Directory(file.uri.slice(0, file.uri.lastIndexOf("/"))).create({ intermediates: true, idempotent: true });
    file.write(document);
    lastWritten = document;
    Promise.resolve(NativeModules.TopShelfReload.reload()).catch((error: unknown) => logger.warn("Top Shelf reload failed", error, { service: "TopShelfChannelEdits" }));
  } catch (error) {
    logger.warn("Top Shelf channel edits write failed", error, { service: "TopShelfChannelEdits" });
  }
}

/** Writes the current account's edits now and after every change or account switch; returns the stop function. */
export function startShelfChannelEdits(): () => void {
  if (!available()) return () => {};
  publish();
  const stopPreferences = subscribeLiveTvPreferences(publish);
  const stopAuth = subscribeAuthChange(publish);
  return () => {
    stopPreferences();
    stopAuth();
  };
}
