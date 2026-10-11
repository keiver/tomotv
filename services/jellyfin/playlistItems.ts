/**
 * Channels synthesized from the device's own tuner playlist parse (the @keiver/tomo-live channel
 * table): what the wall, guide and player use for an id the server has not ingested yet. The item
 * carries everything the engine's origin lane needs; server-side features wait for the real item.
 */
import { allPlaylistChannelIds, playlistChannelById, type PlaylistChannel } from "@keiver/tomo-live";
import type { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";

export { playlistChannelById, playlistChannelCount } from "@keiver/tomo-live";
export { allPlaylistChannelIds };

/** The playlist channel's tvg-logo, for a tile the server has no image for. */
export function playlistLogoUrl(channelId: string): string | null {
  return playlistChannelById(channelId)?.logoUrl ?? null;
}

function item(row: PlaylistChannel): JellyfinItem {
  return {
    Id: row.id,
    Name: row.name,
    Type: "TvChannel",
    Path: row.streamUrl,
    playlistPending: true,
    ...(row.number !== null ? { ChannelNumber: row.number } : {}),
  };
}

/** The channel as a list row, or null when no playlist carries the id. */
export function playlistItem(channelId: string): JellyfinItem | null {
  const row = playlistChannelById(channelId);
  return row ? item(row) : null;
}

/**
 * The channel as the engine plays it, read straight off its origin: IsInfiniteStream marks it live
 * for the lane gates, and there is no server rung (the server cannot open an item it lacks).
 */
export function playlistPlayable(channelId: string): JellyfinVideoItem | null {
  const row = playlistChannelById(channelId);
  if (!row) return null;
  return {
    ...item(row),
    liveStreamUrl: row.streamUrl,
    liveOriginKey: row.originKey,
    ...(Object.keys(row.headers).length > 0 ? { liveHttpHeaders: row.headers } : {}),
    MediaStreams: [],
    MediaSources: [{ Id: row.id, Path: row.streamUrl, Protocol: "Http", IsInfiniteStream: true, SupportsDirectPlay: true, SupportsTranscoding: false }],
  };
}

/**
 * The first `limit` playlist channels not in `exclude`, name-sorted, as list rows: what the wall
 * and guide append once the server's own catalog pages run out. Callers page by growing `exclude`
 * with what they have already landed.
 */
export function pendingPlaylistItemsPage(exclude: ReadonlySet<string>, limit: number): JellyfinItem[] {
  const pending: PlaylistChannel[] = [];
  for (const id of allPlaylistChannelIds()) {
    if (exclude.has(id)) continue;
    const row = playlistChannelById(id);
    if (row) pending.push(row);
  }
  pending.sort((a, b) => a.name.localeCompare(b.name));
  return pending.slice(0, limit).map(item);
}
