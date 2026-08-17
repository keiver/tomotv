import { JellyfinVideoItem } from "@/types/jellyfin";

// Text-tier patterns, hoisted so per-card calls don't re-evaluate the literals.
// Ordered most-specific first; the first hit wins.
const SEASON_EPISODE = /\bS(\d{1,2})[ ._-]?E(\d{1,4})\b/i;
const SEASON_EPISODE_WORDS = /\bSeason[ ._-]?(\d{1,2})[ ._-]{1,3}Episode[ ._-]?(\d{1,4})\b/i;
// Episode kept at 2-3 digits: 4 would flirt with resolution strings.
const NXNN = /\b(\d{1,2})x(\d{2,3})\b/i;
const EPISODE_WORD = /\bEp(?:isode)?[ ._]{0,2}(\d{1,4})\b/i;
// Bare "E": 2-digit minimum so "E3 2019" (the expo) can't match.
const BARE_E = /\bE(\d{2,4})\b/i;
// Anime bare number ("[Group] Show - 05 (1080p)", "Show - 05v2", "Show - 1071"):
// a space-dash separator then 2-4 digits. The 2-digit minimum kills sequel
// names ("Rocky - 2"); the year guard at the call site kills "Movie - 2017".
const ANIME_BARE = /\s[-–—]\s?(\d{2,4})(?:v\d+)?\b/;
// An explicit marker corroborates server metadata against the year guard below.
const EXPLICIT_MARKER = /\bS\d{1,2}[ ._-]?E\d{1,4}\b|\bSeason[ ._-]?\d{1,2}[ ._-]{1,3}Episode\b|\b\d{1,2}x\d{2,3}\b/i;

type SeasonEpisodeSource = Pick<JellyfinVideoItem, "Name" | "Path" | "IndexNumber" | "ParentIndexNumber"> & Partial<Pick<JellyfinVideoItem, "Type">>;

/**
 * "S01E05" / "E05" tag for an item, or null when it isn't derivable.
 *
 * Server metadata wins (ParentIndexNumber = season, IndexNumber = episode)
 * unless it is a split year; an episode number alone is trusted only on Type
 * "Episode" — audio tracks carry IndexNumber as the track number. Otherwise the
 * name and then the filename are matched against the common release
 * conventions, including the season-less anime forms.
 */
export function formatSeasonEpisode(item: SeasonEpisodeSource): string | null {
  const texts = [item.Name, fileNameOf(item.Path)];

  if (item.ParentIndexNumber != null && item.IndexNumber != null) {
    if (isSplitYear(item.ParentIndexNumber, item.IndexNumber, texts)) return null;
    return seasonEpisodeTag(item.ParentIndexNumber, item.IndexNumber);
  }
  if (item.IndexNumber != null && item.Type === "Episode") {
    return episodeTag(item.IndexNumber);
  }

  // Music also follows "Artist - 05 - Title", so the bare-number form is off for audio.
  const isAudio = item.Type === "Audio";

  for (const text of texts) {
    if (!text) continue;

    let match = text.match(SEASON_EPISODE) ?? text.match(SEASON_EPISODE_WORDS) ?? text.match(NXNN);
    if (match) return seasonEpisodeTag(Number(match[1]), Number(match[2]));

    match = text.match(EPISODE_WORD) ?? text.match(BARE_E);
    if (match) return episodeTag(Number(match[1]));

    if (!isAudio) {
      match = text.match(ANIME_BARE);
      if (match) {
        const episode = Number(match[1]);
        if (episode < 1900 || episode > 2100) return episodeTag(episode);
      }
    }
  }
  return null;
}

/**
 * Jellyfin files a bare-year movie under a phantom series, splitting the year
 * into the pair ("...Newmar.1995.DVDRip" → S19E95). The pair is bogus when it
 * reassembles into a year the text carries and no explicit marker backs it up.
 */
function isSplitYear(season: number, episode: number, texts: (string | undefined)[]): boolean {
  const joined = `${season}${pad2(episode)}`;
  if (!/^(?:19|20)\d{2}$/.test(joined)) return false;
  const year = new RegExp(`\\b${joined}\\b`);
  return texts.some((text) => !!text && year.test(text)) && !texts.some((text) => !!text && EXPLICIT_MARKER.test(text));
}

/** Basename of a server-side path, which may be Windows-style. Allocation-free. */
function fileNameOf(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut >= 0 ? path.slice(cut + 1) : path;
}

function seasonEpisodeTag(season: number, episode: number): string {
  return `S${pad2(season)}E${pad2(episode)}`;
}

function episodeTag(episode: number): string {
  return `E${pad2(episode)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
