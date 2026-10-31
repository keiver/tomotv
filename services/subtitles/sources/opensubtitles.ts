/**
 * OpenSubtitles.com REST API, with the viewer's own key and account. Login gives a bearer token,
 * a search names a file id, and a download request answers with a link to the file.
 */
import type { OwnKeys, SubtitleFile, SubtitleHit, SubtitleQuery, SubtitleSource } from "../types";
import { SourceRefusal } from "../types";
import { CLIENT_NAME, providerBytes, providerFetch, unpackSubtitle } from "./http";

export const OPENSUBTITLES_BASE = "https://api.opensubtitles.com/api/v1";

interface OsAttributes {
  language?: string;
  release?: string;
  download_count?: number;
  ratings?: number;
  hearing_impaired?: boolean;
  foreign_parts_only?: boolean;
  machine_translated?: boolean;
  ai_translated?: boolean;
  moviehash_match?: boolean;
  from_trusted?: boolean;
  files?: { file_id?: number; file_name?: string }[];
  uploader?: { name?: string };
}

interface OsSearchAnswer {
  total_pages?: number;
  page?: number;
  data?: { id?: string; attributes?: OsAttributes }[];
}

interface OsLogin {
  token?: string;
  user?: { allowed_downloads?: number; remaining_downloads?: number };
}

interface OsDownload {
  link?: string;
  file_name?: string;
  remaining?: number;
  reset_time_utc?: string;
}

type Account = NonNullable<OwnKeys["opensubtitles"]>;

/** Tokens per account for the session: a login is good for a day and costs a request. */
const tokens = new Map<string, string>();

function accountKey(account: Account): string {
  return `${account.apiKey}|${account.username}`;
}

function headers(account: Account, token?: string): Record<string, string> {
  return {
    "Api-Key": account.apiKey,
    "User-Agent": CLIENT_NAME,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function login(account: Account): Promise<string> {
  const known = tokens.get(accountKey(account));
  if (known) return known;
  const response = await providerFetch("opensubtitles", `${OPENSUBTITLES_BASE}/login`, {
    method: "POST",
    headers: headers(account),
    body: JSON.stringify({ username: account.username, password: account.password }),
  });
  if (!response.ok) throw new SourceRefusal("opensubtitles", response.status, `opensubtitles login answered ${response.status}`);
  const body = (await response.json()) as OsLogin;
  if (!body.token) throw new SourceRefusal("opensubtitles", 401, "opensubtitles login gave no token");
  tokens.set(accountKey(account), body.token);
  return body.token;
}

/** The search query string: one language, the title or ids, and the episode numbers. */
export function openSubtitlesParams(query: SubtitleQuery, language: string): URLSearchParams {
  const params = new URLSearchParams({ languages: language, order_by: "download_count", order_direction: "desc" });
  if (query.imdbId) params.set(query.kind === "episode" ? "parent_imdb_id" : "imdb_id", query.imdbId.replace(/^tt/i, ""));
  else if (query.tmdbId) params.set(query.kind === "episode" ? "parent_tmdb_id" : "tmdb_id", query.tmdbId);
  else params.set("query", query.keywords);
  if (query.kind === "episode" && query.season !== undefined && query.episode !== undefined) {
    params.set("type", "episode");
    params.set("season_number", String(query.season));
    params.set("episode_number", String(query.episode));
  } else if (query.kind === "movie") {
    params.set("type", "movie");
    if (query.year) params.set("year", String(query.year));
  }
  return params;
}

export function openSubtitlesHit(entry: { id?: string; attributes?: OsAttributes }, language: string): SubtitleHit | null {
  const attributes = entry.attributes;
  const fileId = attributes?.files?.[0]?.file_id;
  if (!attributes || fileId === undefined) return null;
  return {
    id: String(fileId),
    source: "opensubtitles",
    name: attributes.release?.trim() || attributes.files?.[0]?.file_name?.trim() || String(fileId),
    language: (attributes.language ?? language).toLowerCase(),
    format: "",
    hashMatch: attributes.moviehash_match === true,
    forced: attributes.foreign_parts_only === true,
    hearingImpaired: attributes.hearing_impaired === true,
    machineTranslated: attributes.machine_translated === true || attributes.ai_translated === true,
    rating: typeof attributes.ratings === "number" ? attributes.ratings : null,
    downloads: typeof attributes.download_count === "number" ? attributes.download_count : null,
    author: attributes.uploader?.name?.trim() ?? "",
  };
}

export const openSubtitlesSource: SubtitleSource = {
  id: "opensubtitles",
  accepts(_query, context) {
    return context.findSubtitles && context.keys.opensubtitles !== null;
  },
  async search(query, language, context) {
    const account = context.keys.opensubtitles;
    if (!account) return [];
    const response = await providerFetch("opensubtitles", `${OPENSUBTITLES_BASE}/subtitles?${openSubtitlesParams(query, language)}`, { headers: headers(account) });
    if (!response.ok) return [];
    const answer = (await response.json()) as OsSearchAnswer;
    return (answer.data ?? []).map((entry) => openSubtitlesHit(entry, language)).filter((hit): hit is SubtitleHit => hit !== null);
  },
  async fetch(hit, context): Promise<SubtitleFile> {
    const account = context.keys.opensubtitles;
    if (!account) throw new SourceRefusal("opensubtitles", 401, "no opensubtitles account");
    const token = await login(account);
    const response = await providerFetch("opensubtitles", `${OPENSUBTITLES_BASE}/download`, {
      method: "POST",
      headers: headers(account, token),
      body: JSON.stringify({ file_id: Number(hit.id), sub_format: "srt" }),
    });
    if (response.status === 401) tokens.delete(accountKey(account));
    if (!response.ok) throw new SourceRefusal("opensubtitles", response.status, `opensubtitles download answered ${response.status}`);
    const info = (await response.json()) as OsDownload;
    if (!info.link) throw new Error("opensubtitles gave no download link");
    const bytes = await providerBytes("opensubtitles", info.link);
    const file = bytes ? unpackSubtitle(bytes, info.file_name ?? `${hit.name}.srt`) : null;
    if (!file) throw new Error("opensubtitles download held no subtitle");
    return { text: file.text, format: file.format || "srt" };
  },
};

/** For tests: forget every token. */
export function resetOpenSubtitlesTokens(): void {
  tokens.clear();
}
