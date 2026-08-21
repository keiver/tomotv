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

// Kinds Jellyfin fills from music tags: IndexNumber is the track, ParentIndexNumber
// the disc (AudioFileProber). Never a season/episode pair, whatever the name says.
const TRACK_NUMBERED_TYPES = new Set(["Audio", "AudioBook"]);

export type SeasonEpisodeSource = Pick<JellyfinVideoItem, "Name" | "Path" | "IndexNumber" | "ParentIndexNumber"> & Partial<Pick<JellyfinVideoItem, "Type">>;

/**
 * "S01E05" / "E05" tag for an item, or null when it isn't derivable. Server metadata
 * wins over the name and then the filename; an episode number alone is trusted only on
 * Type "Episode", and music kinds never get a tag at all.
 */
export function formatSeasonEpisode(item: SeasonEpisodeSource): string | null {
  if (TRACK_NUMBERED_TYPES.has(item.Type ?? "")) return null;

  const texts = [item.Name, fileNameOf(item.Path)];

  if (item.ParentIndexNumber != null && item.IndexNumber != null) {
    if (isSplitYear(item.ParentIndexNumber, item.IndexNumber, texts)) return null;
    return seasonEpisodeTag(item.ParentIndexNumber, item.IndexNumber);
  }
  if (item.IndexNumber != null && item.Type === "Episode") {
    return episodeTag(item.IndexNumber);
  }

  for (const text of texts) {
    if (!text) continue;

    let match = text.match(SEASON_EPISODE) ?? text.match(SEASON_EPISODE_WORDS) ?? text.match(NXNN);
    if (match) return seasonEpisodeTag(Number(match[1]), Number(match[2]));

    match = text.match(EPISODE_WORD) ?? text.match(BARE_E);
    if (match) return episodeTag(Number(match[1]));

    match = text.match(ANIME_BARE);
    if (match) {
      const episode = Number(match[1]);
      if (episode < 1900 || episode > 2100) return episodeTag(episode);
    }
  }
  return null;
}

/** Track number, on the kinds that carry one. */
function trackNumberOf(item: SeasonEpisodeSource): number | null {
  return TRACK_NUMBERED_TYPES.has(item.Type ?? "") ? (item.IndexNumber ?? null) : null;
}

/** "S01E05" says what it is; a bare track number needs the card to label it. */
export type IndexBadge = { kind: "seasonEpisode"; label: string } | { kind: "track"; disc: number | null; label: number };

/** A card's index badge: the season/episode tag, else the disc and track a music item carries. */
export function formatIndexBadge(item: SeasonEpisodeSource): IndexBadge | null {
  const tag = formatSeasonEpisode(item);
  if (tag !== null) return { kind: "seasonEpisode", label: tag };

  const track = trackNumberOf(item);
  if (track === null) return null;

  return { kind: "track", disc: item.ParentIndexNumber ?? null, label: track };
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
