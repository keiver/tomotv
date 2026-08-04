import { JellyfinVideoItem } from "@/types/jellyfin";

/**
 * "S01E05" tag for an item, or null when it isn't derivable.
 *
 * Server metadata (ParentIndexNumber = season, IndexNumber = episode) wins;
 * otherwise the name and then the filename are matched against the common
 * release conventions: "S01E05" (any of " ._-" between the parts) and "1x05".
 */
export function formatSeasonEpisode(item: Pick<JellyfinVideoItem, "Name" | "Path" | "IndexNumber" | "ParentIndexNumber">): string | null {
  if (item.ParentIndexNumber != null && item.IndexNumber != null) {
    return tag(item.ParentIndexNumber, item.IndexNumber);
  }

  // Path is the server-side location, so it may be Windows-style.
  const fileName = item.Path?.split(/[\\/]/).pop();
  for (const text of [item.Name, fileName]) {
    if (!text) continue;
    const match = text.match(/\bS(\d{1,2})[ ._-]?E(\d{1,3})\b/i) ?? text.match(/\b(\d{1,2})x(\d{2,3})\b/i);
    if (match) return tag(Number(match[1]), Number(match[2]));
  }
  return null;
}

function tag(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}
