import type { JellyfinVideoItem } from "@/types/jellyfin";

/** Where a subtitle can come from, in the order the chain asks. */
export type SubtitleSourceId = "server" | "opensubtitles" | "subdl" | "subsource" | "podnapisi" | "gestdown";

export const SOURCE_ORDER: readonly SubtitleSourceId[] = ["server", "opensubtitles", "subdl", "subsource", "podnapisi", "gestdown"];

/** What a file is, as far as a subtitle provider needs to know. */
export interface SubtitleQuery {
  /** The words a provider searches by: the film's title, or the series name for an episode. */
  keywords: string;
  kind: "movie" | "episode" | "video";
  year?: number;
  season?: number;
  episode?: number;
  /** The file name without its extension, for providers that match releases. */
  fileName: string;
  imdbId?: string;
  tmdbId?: string;
}

/** One subtitle a provider offers. */
export interface SubtitleHit {
  /** Unique within its source. */
  id: string;
  source: SubtitleSourceId;
  /** Release or file name, what the viewer reads. */
  name: string;
  /** Canonical two-letter language. */
  language: string;
  /** File extension without the dot, or "" until the file is read. */
  format: string;
  hashMatch: boolean;
  forced: boolean;
  hearingImpaired: boolean;
  machineTranslated: boolean;
  /** 0 to 10, or null when the source gives none. */
  rating: number | null;
  downloads: number | null;
  author: string;
}

/** A subtitle file as fetched: its text and the extension it came with. */
export interface SubtitleFile {
  text: string;
  format: string;
}

/** Accounts and keys the viewer pasted; a source with no key is skipped. */
export interface OwnKeys {
  opensubtitles: { apiKey: string; username: string; password: string } | null;
  subdl: string | null;
  subsource: string | null;
}

export const NO_KEYS: OwnKeys = { opensubtitles: null, subdl: null, subsource: null };

/** What the chain knows about the account and the item before asking anyone. */
export interface SearchContext {
  itemId: string;
  /** The account may use the server's own providers. */
  serverAllowed: boolean;
  /** The viewer allows sources outside the server. */
  findSubtitles: boolean;
  keys: OwnKeys;
}

/** A provider said no: a refusal the chain remembers for the session. */
export class SourceRefusal extends Error {
  readonly status: number;
  readonly source: SubtitleSourceId;
  constructor(source: SubtitleSourceId, status: number, message: string) {
    super(message);
    this.name = "SourceRefusal";
    this.source = source;
    this.status = status;
  }
}

export interface SubtitleSource {
  id: SubtitleSourceId;
  accepts(query: SubtitleQuery, context: SearchContext): boolean;
  search(query: SubtitleQuery, language: string, context: SearchContext): Promise<SubtitleHit[]>;
  fetch(hit: SubtitleHit, context: SearchContext): Promise<SubtitleFile>;
}

/** Why a pick stayed on the device instead of becoming a server sidecar. */
export type DeviceReason = "permission" | "savingOff" | "uploadRefused" | "language";

export type SubtitleJobStatus = "idle" | "searching" | "found" | "none" | "failed" | "applying" | "applied";

/** One file's search, with its own query and language so a badly named file spoils nothing else. */
export interface SubtitleJob {
  item: JellyfinVideoItem;
  /** Short label a list shows first: "S01 E03" for an episode, the year for a film, "" otherwise. */
  label: string;
  title: string;
  query: SubtitleQuery;
  language: string;
  status: SubtitleJobStatus;
  results: SubtitleHit[];
  /** The chain's note on sources that refused, for the state line. */
  note: string | null;
  picked: SubtitleHit | null;
  applied: { where: "server" | "device"; language: string; deviceReason?: DeviceReason } | null;
  error: string | null;
}
