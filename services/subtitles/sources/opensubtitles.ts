/**
 * OpenSubtitles.com REST API under Tomo's own key. A search names a file id, and a download request
 * answers with a link to the file; a download signs in first when the viewer keeps an account.
 */
import type { OwnKeys, SubtitleFile, SubtitleHit, SubtitleQuery, SubtitleSource } from "../types";
import { DownloadLimit, SourceRefusal } from "../types";
import { logger } from "@/utils/logger";
import { CLIENT_NAME, providerBytes, providerFetch, unpackSubtitle } from "./http";

const DEFAULT_HOST = "api.opensubtitles.com";
const VIP_HOST = "vip-api.opensubtitles.com";
export const OPENSUBTITLES_BASE = `https://${DEFAULT_HOST}/api/v1`;

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
  /** The host the signed-in account's requests go to. */
  base_url?: string;
  user?: { allowed_downloads?: number; remaining_downloads?: number };
}

/** A signed-in account: its token and the host its downloads go to. */
interface Session {
  token: string;
  host: string;
}

interface OsDownload {
  link?: string;
  file_name?: string;
  remaining?: number;
  reset_time_utc?: string;
}

type Account = NonNullable<OwnKeys["opensubtitles"]>;

/** Sign-ins per username for the app session: a login is good for a day and costs a request. */
const sessions = new Map<string, Session>();
/** Username and password pairs the login refused; the API asks never to send them again. */
const refusedSignIns = new Set<string>();

/** Tomo's consumer key, inlined at build time; empty in a build made without it. */
export function openSubtitlesAppKey(): string {
  return process.env.EXPO_PUBLIC_OPENSUBTITLES_API_KEY ?? "";
}

function headers(token?: string): Record<string, string> {
  return {
    "Api-Key": openSubtitlesAppKey(),
    "User-Agent": CLIENT_NAME,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function login(account: Account): Promise<Session> {
  const known = sessions.get(account.username);
  if (known) return known;
  const response = await providerFetch("opensubtitles", `${OPENSUBTITLES_BASE}/login`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ username: account.username, password: account.password }),
  });
  if (!response.ok) throw new SourceRefusal("opensubtitles", response.status, `opensubtitles login answered ${response.status}`);
  const body = (await response.json()) as OsLogin;
  if (!body.token) throw new SourceRefusal("opensubtitles", 401, "opensubtitles login gave no token");
  const session = { token: body.token, host: body.base_url === VIP_HOST ? VIP_HOST : DEFAULT_HOST };
  sessions.set(account.username, session);
  return session;
}

/** The viewer's sign-in, or none when there is no account or the login refused it: the download then goes on the app key alone. */
async function signIn(account: Account | null): Promise<Session | undefined> {
  if (!account) return undefined;
  const pair = `${account.username}\n${account.password}`;
  if (refusedSignIns.has(pair)) return undefined;
  try {
    return await login(account);
  } catch (error) {
    if (!(error instanceof SourceRefusal)) throw error;
    if (error.status === 400 || error.status === 401) refusedSignIns.add(pair);
    return undefined;
  }
}

async function requestDownload(hit: SubtitleHit, session: Session | undefined): Promise<Response> {
  try {
    return await providerFetch("opensubtitles", `https://${session?.host ?? DEFAULT_HOST}/api/v1/download`, {
      method: "POST",
      headers: headers(session?.token),
      body: JSON.stringify({ file_id: Number(hit.id), sub_format: "srt" }),
    });
  } catch (error) {
    // 406 is the day's downloads used up: the IP's free ones without a sign-in, the account's with one.
    if (error instanceof SourceRefusal && error.status === 406) throw new DownloadLimit("opensubtitles", 406, session !== undefined);
    throw error;
  }
}

/** An id as the API takes it: digits only, without "tt" or leading zeroes. */
function bareId(id: string): string {
  return id.replace(/^tt/i, "").replace(/^0+(?=\d)/, "");
}

/** The search query string: an item's own id alone when it has one, else the title with the episode numbers or the year. */
export function openSubtitlesParams(query: SubtitleQuery, language: string): URLSearchParams {
  const params = new URLSearchParams({ languages: language, order_by: "download_count", order_direction: "desc" });
  if (query.imdbId) params.set("imdb_id", bareId(query.imdbId));
  else if (query.tmdbId) params.set("tmdb_id", bareId(query.tmdbId));
  else {
    params.set("query", query.keywords.toLowerCase());
    if (query.kind === "episode" && query.season !== undefined && query.episode !== undefined) {
      params.set("type", "episode");
      params.set("season_number", String(query.season));
      params.set("episode_number", String(query.episode));
    } else if (query.kind === "movie") {
      params.set("type", "movie");
      if (query.year) params.set("year", String(query.year));
    }
  }
  // The API answers 301 to any query whose parameters are out of alphabetical order or whose words are not lower case.
  params.sort();
  return params;
}

export function openSubtitlesHit(entry: { id?: string; attributes?: OsAttributes }, language: string): SubtitleHit | null {
  const attributes = entry.attributes;
  const fileId = attributes?.files?.[0]?.file_id;
  if (!attributes || fileId === undefined) return null;
  return {
    id: String(fileId),
    source: "opensubtitles",
    name: attributes.files?.[0]?.file_name?.trim() || attributes.release?.trim() || String(fileId),
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
    return context.findSubtitles && openSubtitlesAppKey() !== "";
  },
  async search(query, language) {
    const response = await providerFetch("opensubtitles", `${OPENSUBTITLES_BASE}/subtitles?${openSubtitlesParams(query, language)}`, { headers: headers() });
    if (!response.ok) {
      logger.warn("OpenSubtitles search answered without results", { service: "Subtitles", status: response.status });
      return [];
    }
    const answer = (await response.json()) as OsSearchAnswer;
    logger.debug("OpenSubtitles search", { service: "Subtitles", status: response.status, count: answer.data?.length ?? 0 });
    return (answer.data ?? []).map((entry) => openSubtitlesHit(entry, language)).filter((hit): hit is SubtitleHit => hit !== null);
  },
  async fetch(hit, context): Promise<SubtitleFile> {
    const account = context.keys.opensubtitles;
    const session = await signIn(account);
    let response: Response;
    try {
      response = await requestDownload(hit, session);
    } catch (error) {
      // A token past its day answers 401: sign in again once and retry.
      if (!account || !session || !(error instanceof SourceRefusal) || error.status !== 401) throw error;
      sessions.delete(account.username);
      response = await requestDownload(hit, await signIn(account));
    }
    if (!response.ok) throw new SourceRefusal("opensubtitles", response.status, `opensubtitles download answered ${response.status}`);
    const info = (await response.json()) as OsDownload;
    if (!info.link) throw new Error("opensubtitles gave no download link");
    const bytes = await providerBytes("opensubtitles", info.link);
    const file = bytes ? unpackSubtitle(bytes, info.file_name ?? `${hit.name}.srt`) : null;
    if (!file) throw new Error("opensubtitles download held no subtitle");
    return { text: file.text, format: file.format || "srt" };
  },
};

/** For tests: forget every sign-in and every refused one. */
export function resetOpenSubtitlesTokens(): void {
  sessions.clear();
  refusedSignIns.clear();
}
