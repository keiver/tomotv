import { JellyfinItem } from "@/types/jellyfin";

/**
 * First-page cache for folder contents, keyed by folder id ("root" for the libraries view). Keeps
 * re-navigation instant within the TTL. Lives outside React so the auth flows in jellyfinApi can
 * clear it on connect / server-switch / sign-out without reaching into the hook.
 */
export type FolderCacheEntry = { items: JellyfinItem[]; total?: number; timestamp: number };

const cache = new Map<string, FolderCacheEntry>();

export function getFolderCache(key: string): FolderCacheEntry | undefined {
  return cache.get(key);
}

export function setFolderCache(key: string, entry: FolderCacheEntry): void {
  cache.set(key, entry);
}

export function deleteFolderCache(key: string): void {
  cache.delete(key);
}

/** Drop all cached folders (e.g. after auth changes) so the next visit refetches fresh. */
export function clearFolderContentsCache(): void {
  cache.clear();
}

/** Rewrite one item's UserData in every cached folder holding it; null drops those folders instead. */
export function patchFolderCacheItem(itemId: string, userData: JellyfinItem["UserData"] | null): void {
  cache.forEach((entry, key) => {
    if (!entry.items.some((item) => item.Id === itemId)) return;
    if (!userData) {
      cache.delete(key);
      return;
    }
    cache.set(key, { ...entry, items: entry.items.map((item) => (item.Id === itemId ? { ...item, UserData: { ...item.UserData, ...userData } } : item)) });
  });
}
