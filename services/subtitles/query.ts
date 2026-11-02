import type { JellyfinVideoItem } from "@/types/jellyfin";
import type { SubtitleQuery } from "./types";

type QueryItem = Pick<JellyfinVideoItem, "Name" | "Type" | "Path" | "ProductionYear" | "SeriesName" | "ParentIndexNumber" | "IndexNumber"> & {
  ProviderIds?: Record<string, string>;
};

/** Release tags and the trailing part of a file name that are not the title. */
const RELEASE_TAGS =
  /\b(19|20)\d{2}\b.*$|\b(2160p|1080p|720p|480p|4k|uhd|hdr|dv|web[- ]?dl|webrip|bluray|blu-ray|bdrip|brrip|dvdrip|hdtv|x264|x265|h\.?264|h\.?265|hevc|aac|ac3|dts|atmos|remux|proper|repack|extended|unrated|multi|dual)\b.*$/i;

const EPISODE_IN_NAME = /\bS(\d{1,2})\s?E(\d{1,3})\b/i;

/** The file name without its folders or extension. */
export function fileStem(path: string | undefined): string {
  const name = (path ?? "").split(/[\\/]/).pop() ?? "";
  return name.replace(/\.[^.]+$/, "");
}

/** A file name read as a title: dots and underscores to spaces, release tags and the year dropped. */
export function titleFromFileName(stem: string): string {
  return stem
    .replace(EPISODE_IN_NAME, " ")
    .replace(/[._]+/g, " ")
    .replace(RELEASE_TAGS, "")
    .replace(/[-\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function yearFromFileName(stem: string): number | undefined {
  const match = stem.match(/\b((?:19|20)\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

/**
 * What to ask a provider for. An episode asks by series, season and episode; a film by title and
 * year; a plain video by whatever its name and file name say, episode numbers included when the
 * file name carries them.
 */
export function subtitleQuery(item: QueryItem): SubtitleQuery {
  const stem = fileStem(item.Path);
  const providerIds = item.ProviderIds ?? {};
  const ids = { imdbId: providerIds.Imdb || undefined, tmdbId: providerIds.Tmdb || undefined };
  if (item.Type === "Episode" && item.SeriesName && item.ParentIndexNumber !== undefined && item.IndexNumber !== undefined) {
    return { kind: "episode", keywords: item.SeriesName.trim(), season: item.ParentIndexNumber, episode: item.IndexNumber, fileName: stem, ...ids };
  }
  if (item.Type === "Movie") {
    return { kind: "movie", keywords: item.Name.trim(), year: item.ProductionYear ?? yearFromFileName(stem), fileName: stem, ...ids };
  }
  const inName = (item.Name || stem).match(EPISODE_IN_NAME) ?? stem.match(EPISODE_IN_NAME);
  const keywords = titleFromFileName(item.Name && item.Name !== stem ? item.Name : stem) || item.Name.trim();
  if (inName) {
    return { kind: "episode", keywords, season: Number(inName[1]), episode: Number(inName[2]), fileName: stem, ...ids };
  }
  return { kind: "video", keywords, year: item.ProductionYear ?? yearFromFileName(stem), fileName: stem, ...ids };
}

/** The words a search field shows: the title, then "S04E06" for an episode. */
export function queryText(query: SubtitleQuery): string {
  if (query.kind === "episode" && query.season !== undefined && query.episode !== undefined) {
    return `${query.keywords} S${String(query.season).padStart(2, "0")}E${String(query.episode).padStart(2, "0")}`;
  }
  return query.keywords;
}

/** The query a typed text means: an "S04E06" in it sets the episode, the rest is the title; without one the base episode stays. */
export function queryFromText(text: string, base: SubtitleQuery): SubtitleQuery {
  const match = text.match(EPISODE_IN_NAME);
  const keywords = text
    .replace(EPISODE_IN_NAME, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (match) return { ...base, kind: "episode", keywords, season: Number(match[1]), episode: Number(match[2]) };
  return { ...base, keywords };
}

/** A second query asking by the file name itself, or null when the file name says nothing more than the title does. */
export function fileNameQuery(query: SubtitleQuery): SubtitleQuery | null {
  const words = query.fileName
    .replace(/[._]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!words || words.toLowerCase() === query.keywords.toLowerCase()) return null;
  const match = words.match(EPISODE_IN_NAME);
  if (match) return { ...query, kind: "episode", keywords: words, season: Number(match[1]), episode: Number(match[2]) };
  return { ...query, keywords: words };
}

/** The job label a list shows first: "S01 E03" for an episode, the year for a film, nothing otherwise. */
export function queryLabel(query: SubtitleQuery): string {
  if (query.kind === "episode" && query.season !== undefined && query.episode !== undefined) {
    return `S${String(query.season).padStart(2, "0")} E${String(query.episode).padStart(2, "0")}`;
  }
  return query.year ? String(query.year) : "";
}
