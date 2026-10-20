/**
 * Copies the engine's keyframes for the Continue Watching items into the App Group container,
 * where the Top Shelf extension (native/ios/TopShelf/ContentProvider.swift) finds them by item id.
 * Only frames already decoded for the row are copied; nothing here asks for a decode.
 */
import { wantsPosterFrame, type PosterItem } from "@/services/itemArtwork";
import { posterFrameGeneration, posterFrameIfCached, subscribePosterFrames } from "@/services/localRemux";
import { getUiPreferences, subscribeUiPreferences } from "@/services/uiPreferences";
import { logger } from "@/utils/logger";
import { Directory, File, Paths } from "expo-file-system";
import { NativeModules, Platform } from "react-native";

const APP_GROUP = "group.dev.keiver.tomotv";

/** Items whose shelf card would otherwise be the placeholder. */
export function shelfFrameCandidates<T extends PosterItem>(items: T[]): T[] {
  return items.filter(wantsPosterFrame);
}

/** `<itemId>.<md5>.jpg`: a new picture gets a new name. Item ids hold no dot. */
export function shelfFrameName(itemId: string, md5: string): string {
  return `${itemId}.${md5}.jpg`;
}

function shelfFrameItemId(name: string): string {
  return name.split(".")[0];
}

let lastItems: PosterItem[] = [];
let candidateIds = new Set<string>();
let lastDevicePosters: boolean | null = null;
let subscribed = false;
let chain: Promise<void> = Promise.resolve();
let publishQueued = false;

/** Guarded on the module: a Metro reload can carry JS newer than the installed binary. */
function available(): boolean {
  return Platform.isTV && !!NativeModules.TopShelfReload?.reload;
}

function shelfDirectory(): Directory | null {
  const root = Paths.appleSharedContainers[APP_GROUP];
  return root ? new Directory(root, "Library", "Caches", "topshelf-frames") : null;
}

function reloadShelf(): void {
  Promise.resolve(NativeModules.TopShelfReload.reload()).catch((error: unknown) => logger.warn("Top Shelf reload failed", error, { service: "TopShelfFrames" }));
}

function enqueue(step: () => Promise<void> | void): Promise<void> {
  chain = chain.then(step).catch((error: unknown) => logger.warn("Top Shelf frames update failed", error, { service: "TopShelfFrames" }));
  return chain;
}

function schedulePublish(): Promise<void> {
  if (publishQueued) return chain;
  publishQueued = true;
  return enqueue(() => {
    publishQueued = false;
    return publish();
  });
}

async function publish(): Promise<void> {
  const generation = posterFrameGeneration();
  const directory = shelfDirectory();
  if (!directory) return;
  directory.create({ intermediates: true, idempotent: true });
  const byItem = new Map<string, File[]>();
  for (const entry of directory.list()) {
    if (!(entry instanceof File)) continue;
    const id = shelfFrameItemId(entry.name);
    byItem.set(id, [...(byItem.get(id) ?? []), entry]);
  }
  let changed = false;
  for (const id of candidateIds) {
    const uri = posterFrameIfCached(id);
    if (typeof uri !== "string") continue;
    const source = new File(uri);
    // A file the pool has trimmed leaves the item's shelf copy as it is.
    const md5 = source.exists ? source.md5 : null;
    if (!md5) continue;
    const name = shelfFrameName(id, md5);
    const existing = byItem.get(id) ?? [];
    if (!existing.some((file) => file.name === name)) {
      try {
        await source.copy(new File(directory, name));
      } catch (error) {
        logger.warn("Top Shelf frame copy failed", error, { service: "TopShelfFrames", itemId: id });
        continue;
      }
      if (generation !== posterFrameGeneration()) return;
      changed = true;
    }
    for (const file of existing) {
      if (file.name === name) continue;
      file.delete();
      changed = true;
    }
  }
  for (const [id, files] of byItem) {
    if (candidateIds.has(id)) continue;
    for (const file of files) file.delete();
    changed = true;
  }
  if (changed) reloadShelf();
}

function subscribeOnce(): void {
  if (subscribed) return;
  subscribed = true;
  lastDevicePosters = getUiPreferences().devicePosters;
  subscribePosterFrames((itemId) => {
    if (candidateIds.has(itemId)) void schedulePublish();
  });
  subscribeUiPreferences(() => {
    const devicePosters = getUiPreferences().devicePosters;
    if (devicePosters === lastDevicePosters) return;
    lastDevicePosters = devicePosters;
    candidateIds = new Set(shelfFrameCandidates(lastItems).map((item) => item.Id));
    void schedulePublish();
  });
}

/** The row's resume list: its items without a server poster get their keyframes on the shelf. */
export function syncShelfFrames(items: PosterItem[]): Promise<void> {
  if (!available()) return Promise.resolve();
  subscribeOnce();
  lastItems = items;
  candidateIds = new Set(shelfFrameCandidates(items).map((item) => item.Id));
  return schedulePublish();
}

/** Item ids repeat across servers: a switch or sign out leaves no frame on the shelf. */
export function clearShelfFrames(): Promise<void> {
  if (!available()) return Promise.resolve();
  lastItems = [];
  candidateIds = new Set();
  return enqueue(() => {
    const directory = shelfDirectory();
    if (!directory?.exists) return;
    directory.delete();
    reloadShelf();
  });
}
