/**
 * The viewer's edits to the channel list, applied where channels leave the fetch layer: a hidden
 * channel is dropped from every list, a renamed one shows its name and keeps the server's in
 * SourceName, which favorites, groups and guide matching key by.
 */
import { channelDisplayName, getLiveTvPreferences, isHiddenChannel } from "@/services/liveTvPreferences";
import { invalidateByPrefix } from "@/services/requestCache";
import type { JellyfinItem } from "@/types/jellyfin";

/** Ids of channels dropped here so far, for lists that know a channel by its id alone (a programme). */
const hiddenIds = new Set<string>();

export function applyChannelEdits<T extends JellyfinItem>(items: readonly T[]): T[] {
  const preferences = getLiveTvPreferences();
  if (preferences.hidden.length === 0 && preferences.renames.length === 0) return [...items];
  const kept: T[] = [];
  for (const item of items) {
    if (item.Type !== "TvChannel") {
      kept.push(item);
      continue;
    }
    if (isHiddenChannel(preferences, item)) {
      hiddenIds.add(item.Id);
      continue;
    }
    hiddenIds.delete(item.Id);
    kept.push(withChannelEdits(item, preferences));
  }
  return kept;
}

/** One channel with its rename and never dropped: a hidden channel's own panel still opens. */
export function withChannelEdits<T extends JellyfinItem>(item: T, preferences = getLiveTvPreferences()): T {
  if (item.Type !== "TvChannel") return item;
  const source = item.SourceName ?? item.Name;
  const name = channelDisplayName(preferences, item);
  if (name === source) return item.SourceName === undefined ? item : { ...item, Name: source, SourceName: undefined };
  return item.Name === name && item.SourceName === source ? item : { ...item, Name: name, SourceName: source };
}

export function isHiddenChannelId(id: string): boolean {
  return hiddenIds.has(id);
}

/** Channel lists cached before an edit: the guide's pages and the search's lineup read again. */
export function invalidateChannelListReads(): void {
  invalidateByPrefix("guide:channels:");
  invalidateByPrefix("liveChannelNames:");
}
