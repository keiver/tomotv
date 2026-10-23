/**
 * Channels synthesized from the device's own tuner playlist parse (the @keiver/tomo-live channel
 * table): what the wall, guide and player use for an id the server has not ingested yet. The item
 * carries everything the engine's origin lane needs; server-side features wait for the real item.
 */
import { allPlaylistChannelIds, playlistChannelById, type PlaylistChannel } from "@keiver/tomo-live";
import { cachedRequest } from "@/services/requestCache";
import type { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import { applyChannelEdits } from "./channelEdits";
import { API_TIMEOUTS } from "./constants";
import { fetchWithTimeout } from "./http";
import { originKeyOf } from "./liveInput";
import { plutoStreamUrl } from "./plutoSession";
import { getAuthHeader, getConfig } from "./session";
import { fetchTunerData, tunerDataSettled } from "./tunerGroups";

const POLICY_TTL_MS = 60 * 1000;

interface ParentalPolicy {
  MaxParentalRating?: number | null;
  BlockUnratedItems?: string[];
  BlockedTags?: string[];
  AllowedTags?: string[];
}

/** Whether no parental rule in the account's policy can hide a Live TV channel from it. */
export function policyHidesNoChannel(policy: ParentalPolicy | undefined): boolean {
  if (!policy) return false;
  return policy.MaxParentalRating == null && !(policy.BlockUnratedItems ?? []).includes("LiveTvChannel") && (policy.BlockedTags ?? []).length === 0 && (policy.AllowedTags ?? []).length === 0;
}

/**
 * The server answers 404 for a channel it hides from the account exactly as for one it has not
 * ingested, so the playlist stands in only where no parental rule can hide a channel. A policy
 * that cannot be read stands in for nothing.
 */
export async function playlistStandInsAllowed(): Promise<boolean> {
  try {
    const config = await getConfig();
    if (!config.server || !config.apiKey || !config.userId) return false;
    return await cachedRequest(
      `playlistStandIns:${config.server}:${config.userId}`,
      async () => {
        const headers = { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) };
        const response = await fetchWithTimeout(`${config.server}/Users/Me`, { headers }, API_TIMEOUTS.NORMAL);
        if (!response.ok) throw new Error(`Failed to read the account policy: ${response.status}`);
        return policyHidesNoChannel(((await response.json()) as { Policy?: ParentalPolicy }).Policy);
      },
      POLICY_TTL_MS,
    );
  } catch {
    return false;
  }
}

/** The playlist channel's tvg-logo, for a tile the server has no image for. */
export function playlistLogoUrl(channelId: string): string | null {
  return playlistChannelById(channelId)?.logoUrl ?? null;
}

/** The playlist row that may stand in for `channelId`: null when no playlist carries it or the account's policy forbids it. */
export async function playlistStandIn(channelId: string): Promise<PlaylistChannel | null> {
  const row = playlistChannelById(channelId);
  return row && (await playlistStandInsAllowed()) ? row : null;
}

/** The row as a list item. */
export function standInItem(row: PlaylistChannel): JellyfinItem {
  return {
    Id: row.id,
    Name: row.name,
    Type: "TvChannel",
    Path: row.streamUrl,
    playlistPending: true,
    ...(row.number !== null ? { ChannelNumber: row.number } : {}),
  };
}

/**
 * The row as the engine plays it, read straight off its origin: IsInfiniteStream marks it live
 * for the lane gates, and there is no server rung (the server cannot open an item it lacks).
 */
export function standInPlayable(row: PlaylistChannel): JellyfinVideoItem {
  return {
    ...standInItem(row),
    liveStreamUrl: row.streamUrl,
    liveOriginKey: row.originKey,
    ...(Object.keys(row.headers).length > 0 ? { liveHttpHeaders: row.headers } : {}),
    MediaStreams: [],
    MediaSources: [{ Id: row.id, Path: row.streamUrl, Protocol: "Http", IsInfiniteStream: true, SupportsDirectPlay: true, SupportsTranscoding: false }],
  };
}

/** The row with the link this device reads: a Pluto link moves to this device's session and its host. */
export async function sessionRow(row: PlaylistChannel): Promise<PlaylistChannel> {
  const streamUrl = await plutoStreamUrl(row.streamUrl);
  return streamUrl === row.streamUrl ? row : { ...row, streamUrl, originKey: originKeyOf(streamUrl) };
}

/** The channel as the engine plays it off the playlist, or null when nothing may stand in for the id. */
export async function playlistPlayable(channelId: string): Promise<JellyfinVideoItem | null> {
  const row = await playlistStandIn(channelId);
  return row ? standInPlayable(await sessionRow(row)) : null;
}

/**
 * The first `limit` playlist channels not in `exclude`, name-sorted, as list rows: what the wall
 * and guide append once the server's own catalog pages run out. Callers page by growing `exclude`
 * with what they have already landed.
 */
export async function pendingPlaylistItemsPage(exclude: ReadonlySet<string>, limit: number): Promise<JellyfinItem[]> {
  const pending: PlaylistChannel[] = [];
  for (const id of allPlaylistChannelIds()) {
    if (exclude.has(id)) continue;
    const row = playlistChannelById(id);
    if (row) pending.push(row);
  }
  if (pending.length === 0 || !(await playlistStandInsAllowed())) return [];
  pending.sort((a, b) => a.name.localeCompare(b.name));
  return applyChannelEdits(pending.slice(0, limit).map(standInItem));
}

/**
 * The pending channels that follow the server catalog's last page. While the tuner read is still
 * running a page with channels lands as it is and `waiting` asks for the next one at once, so a
 * short catalog paints before the playlist arrives; an empty page waits for the read itself.
 */
export async function pendingChannelsAfter(
  serverPage: readonly JellyfinItem[],
  loaded: readonly JellyfinItem[],
  limit: number,
): Promise<{ pending: JellyfinItem[]; hasMore: boolean; waiting: boolean }> {
  if (!tunerDataSettled()) {
    if (serverPage.length > 0) return { pending: [], hasMore: true, waiting: true };
    await fetchTunerData().catch(() => null);
  }
  const exclude = new Set([...loaded, ...serverPage].map((item) => item.Id));
  const pending = await pendingPlaylistItemsPage(exclude, limit);
  return { pending, hasMore: pending.length >= limit, waiting: false };
}
