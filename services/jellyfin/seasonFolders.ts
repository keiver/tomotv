/**
 * Series folders the server's season grouping gets wrong, listed from their file paths:
 * a series with no season stated anywhere, and season folders the server could not number.
 */
import { CACHE } from "@/constants/app";
import { cachedRequest } from "@/services/requestCache";
import { JellyfinItem } from "@/types/jellyfin";
import { hasSeasonMarker, orderEpisodes } from "@/utils/seasonEpisode";
import { API_TIMEOUTS, BROWSE_FIELDS } from "./constants";
import { fetchWithTimeout } from "./http";
import { fetchAllItemPages } from "./itemPages";
import { getAuthHeader, JellyfinConfig, throwRequestError } from "./session";

/**
 * A series listed by its folders where the server's pathless seasons are its own regrouping:
 * every file inside a folder lists just the folders; loose files with no season stated
 * anywhere list flat in episode order, folders after. Null keeps the server's browse.
 */
export async function seriesFileListing(config: JellyfinConfig, seriesId: string, seasons: JellyfinItem[]): Promise<JellyfinItem[] | null> {
  if (!seasons.some((season) => !season.Path)) return null;
  const folders = seasons.filter((season) => !!season.Path);
  const episodes = await fetchSeriesEpisodes(config, seriesId, BROWSE_FIELDS);
  if (episodes.length === 0) return null;
  const loose = episodes.filter((episode) => !folders.some((folder) => isInsidePath(episode.Path, folder.Path!)));
  if (loose.length > 0 && loose.some(hasSeasonMarker)) return null;
  // The server's counts for these folders follow its season grouping, not the files inside.
  const counted = folders.map((folder) => {
    const count = episodes.filter((episode) => isInsidePath(episode.Path, folder.Path!)).length;
    return { ...folder, ChildCount: count, RecursiveItemCount: count };
  });
  return [...orderEpisodes(loose), ...counted];
}

/**
 * Episodes the server merged as versions because their folder path parsed to one pair
 * (VideoListResolver.GetEpisodeVersionKey), one item per file. Real versions keep the
 * marker in each file name ("S01E01 - 1080p") and stay merged.
 */
export async function splitMergedEpisodes<T extends JellyfinItem>(config: JellyfinConfig, items: T[], fields: string): Promise<T[]> {
  if (!items.some(isMergedEpisode)) return items;
  const out: T[] = [];
  for (const item of items) {
    const versions = isMergedEpisode(item) ? await fetchVersionItems(config, item.Id, fields) : null;
    out.push(...((versions ?? [item]) as T[]));
  }
  return out;
}

function isMergedEpisode(item: JellyfinItem): boolean {
  return item.Type === "Episode" && (item.MediaSourceCount ?? 1) > 1;
}

/**
 * Each file of a merged episode as its own item, without the pair its folder gave them; null
 * for real versions. The server hands every version the same extracted frame under its own tag,
 * so the Primary tag is dropped and each card gets a keyframe from its own file (itemArtwork).
 */
async function fetchVersionItems(config: JellyfinConfig, itemId: string, fields: string): Promise<JellyfinItem[] | null> {
  const sources = (await fetchItem(config, itemId, "Path,MediaSources"))?.MediaSources ?? [];
  if (sources.length < 2 || sources.some((source) => hasSeasonMarker({ Name: "", Path: source.Path ?? "" }))) return null;
  const versions = await Promise.all(sources.map((source) => fetchItem(config, source.Id, fields)));
  if (versions.some((version) => !version)) return null;
  return versions.map((version) => {
    const { Primary: _shared, ...images } = version!.ImageTags ?? {};
    return { ...version!, ImageTags: images, IndexNumber: undefined, ParentIndexNumber: undefined, MediaSourceCount: 1 };
  });
}

/**
 * A season folder the server could not number files its episodes under numbered seasons,
 * so its own listing is empty. Null when the folder is not one.
 */
export async function numberlessSeasonFiles(config: JellyfinConfig, folderId: string, fields = BROWSE_FIELDS): Promise<JellyfinItem[] | null> {
  const folder = await fetchItem(config, folderId, "Path");
  if (!folder || folder.Type !== "Season" || !folder.Path || folder.IndexNumber != null || !folder.SeriesId) return null;
  const folderPath = folder.Path;
  const episodes = await fetchSeriesEpisodes(config, folder.SeriesId, fields);
  return orderEpisodes(episodes.filter((episode) => isInsidePath(episode.Path, folderPath)));
}

/**
 * One item by id; a version id answers with that version, its own file first in MediaSources.
 * Keyed under folder: so played/resume writes evict it.
 */
function fetchItem(config: JellyfinConfig, itemId: string, fields: string): Promise<JellyfinItem | undefined> {
  return cachedRequest(
    `folder:${config.userId}:item:${itemId}:${fields}`,
    async () => {
      const query = new URLSearchParams({ userId: config.userId!, Fields: fields, EnableUserData: "true" });
      const response = await fetchWithTimeout(
        `${config.server}/Items/${itemId}?${query.toString()}`,
        { method: "GET", headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
        API_TIMEOUTS.QUICK,
      );
      if (!response.ok) {
        throwRequestError(response, `Failed to fetch item: ${response.status}`);
      }
      return (await response.json()) as JellyfinItem | undefined;
    },
    CACHE.DEFAULT_TTL_MS,
  );
}

/** Every episode of a series in one sweep, merged files split one per item. */
function fetchSeriesEpisodes(config: JellyfinConfig, seriesId: string, fields: string): Promise<JellyfinItem[]> {
  return cachedRequest(
    `folder:${config.userId}:episodes:${seriesId}:${fields}`,
    async () => {
      const episodes = await fetchAllItemPages(
        config,
        (startIndex, limit) =>
          new URLSearchParams({
            ParentId: seriesId,
            Recursive: "true",
            IncludeItemTypes: "Episode",
            Fields: `${fields},MediaSourceCount`,
            EnableUserData: "true",
            StartIndex: String(startIndex),
            Limit: String(limit),
            SortBy: "SortName",
            SortOrder: "Ascending",
          }),
        "series episodes",
      );
      return splitMergedEpisodes(config, episodes, fields);
    },
    CACHE.DEFAULT_TTL_MS,
  );
}

/** True when `path` sits under `dir`, compared as server paths that may be Windows-style. */
function isInsidePath(path: string | undefined, dir: string): boolean {
  if (!path) return false;
  const base = dir.replace(/\\/g, "/").replace(/\/+$/, "");
  return path.replace(/\\/g, "/").startsWith(`${base}/`);
}
