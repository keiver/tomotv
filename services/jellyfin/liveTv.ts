/**
 * Live TV through the on-device engine. A manifest channel plays from its origin with no server
 * open; any other source is opened on the server and read through it. The server's HLS transcode
 * is the rung below the engine, opened when the engine cannot play the channel.
 */
import { JellyfinItem, JellyfinMediaSource, JellyfinProgram, JellyfinSeriesTimer, JellyfinTimer, JellyfinVideoItem } from "@/types/jellyfin";
import { CACHE } from "@/constants/app";
import { engineCodecAllowlists } from "@/services/localRemux";
import { channelListKey, favoriteKey, LIVE_TV_CATEGORIES, type ChannelFavorite, type LiveTvCategory } from "@/services/liveTvPreferences";
import { setPlaybackStage } from "@/services/playbackStage";
import { cachedRequest } from "@/services/requestCache";
import { logger } from "@/utils/logger";
import { invalidateRecordingReads } from "./cacheKeys";
import * as SecureStore from "expo-secure-store";
import { getSavedAccounts } from "./accounts";
import { accountTokenKey, API_TIMEOUTS } from "./constants";
import { fetchWithTimeout } from "./http";
import { rawLiveInput } from "./liveInput";
import { recordClose, recordedOpens, recordOpen } from "./liveOpens";
import { didConfigReadFail, getAuthHeader, getConfig, getQualitySettings, throwRequestError } from "./session";
import { type ChannelOrigin, clearOpenFailure } from "@keiver/tomo-live";

export type { ChannelOrigin };
export { noteOpenFailed, openRecentlyFailed } from "@keiver/tomo-live";

const LIVE_BITRATE_CAP = 200_000_000;

/** A fixed Streaming Quality pick caps the server's live transcode; Auto leaves the server its own clamps (live has no link reading). */
async function liveTranscodeBitrate(): Promise<number> {
  const quality = await getQualitySettings();
  return quality.mode === "fixed" ? quality.bitrate : LIVE_BITRATE_CAP;
}

/**
 * Every codec the engine copies or decodes, declared as direct play on MPEG-TS. The one transcoding
 * profile is what the server answers with a TranscodingUrl: live HLS is TS-only on Jellyfin (an fMP4
 * profile is ignored and the reply degrades to a progressive stream), and AVPlayer plays HEVC in TS.
 */
function liveDeviceProfile(maxBitrate: number = LIVE_BITRATE_CAP) {
  const { video, audio } = engineCodecAllowlists();
  return {
    Name: "Tomo TV live",
    MaxStreamingBitrate: maxBitrate,
    MaxStaticBitrate: maxBitrate,
    DirectPlayProfiles: [
      { Type: "Video", Container: "ts,mpegts", VideoCodec: video.join(","), AudioCodec: audio.join(",") },
      { Type: "Audio", Container: "ts,mpegts,mp3,aac,adts", AudioCodec: audio.join(",") },
    ],
    TranscodingProfiles: [{ Type: "Video", Container: "ts", Protocol: "hls", VideoCodec: "h264,hevc", AudioCodec: "aac,ac3,eac3", Context: "Streaming" }],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [],
  };
}

/** The server writes its own bind address into Path; the client reaches it on the address it signed into. */
export function liveStreamUrlFor(server: string, apiKey: string, path: string): string {
  let relative = path.replace(/^https?:\/\/[^/]+/, "");
  if (!relative.startsWith("/")) relative = `/${relative}`;
  return `${server}${relative}${relative.includes("?") ? "&" : "?"}ApiKey=${apiKey}`;
}

/** The server never marks a manifest (HLS or DASH) direct play; its Path is the origin URL, untouched. */
function isManifestSource(source: JellyfinMediaSource): boolean {
  if (!source.Path || !/^https?$/i.test(source.Protocol ?? "")) return false;
  return source.Container === "hls" || source.Container === "dash" || /\.(?:m3u8?|mpd)(?:$|\?)/i.test(source.Path);
}

/** The variants a multivariant playlist declares, in order; empty for a media playlist. */
function variantsOf(master: string): { bandwidth: number; uri: string; grouped: boolean }[] {
  const lines = master.split(/\r?\n/).map((line) => line.trim());
  const variants: { bandwidth: number; uri: string; grouped: boolean }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const attributes = lines[i].slice("#EXT-X-STREAM-INF:".length);
    const uri = lines.slice(i + 1).find((line) => line && !line.startsWith("#"));
    if (!uri) continue;
    variants.push({ bandwidth: Number(/(?:^|,)BANDWIDTH=(\d+)/.exec(attributes)?.[1] ?? 0), uri, grouped: /(?:^|,)(?:AUDIO|SUBTITLES)=/.test(attributes) });
  }
  return variants;
}

function absolute(uri: string, base: string): string | null {
  try {
    return new URL(uri, base).toString();
  } catch {
    return null;
  }
}

/**
 * The top-bitrate variant of a multivariant playlist, absolute, or null when the text is a media
 * playlist or every variant hangs audio or subtitles off a rendition group (a variant playlist
 * alone would then lose them). Opening one variant instead of the master spares the demuxer a
 * playlist and a first segment per variant: measured 10.4s against 2.1s on a four-variant origin.
 */
export function topVariantUrl(master: string, masterUrl: string): string | null {
  const variants = variantsOf(master);
  if (variants.length === 0 || variants.some((variant) => variant.grouped)) return null;
  const best = variants.reduce((top, variant) => (variant.bandwidth > top.bandwidth ? variant : top));
  return absolute(best.uri, masterUrl);
}

/**
 * The key scheme of a playlist that no lane can play: SAMPLE-AES (FFmpeg decodes none of it) or
 * a key format other than a plain key (FairPlay, Widevine, PlayReady). AES-128 with a key URI
 * is not that: FFmpeg fetches the key and decrypts, as the server's ffmpeg does.
 */
export function drmKeyFormat(playlist: string): string | null {
  for (const line of playlist.split(/\r?\n/)) {
    const tag = /^#EXT-X-(?:SESSION-)?KEY:(.*)$/.exec(line.trim());
    if (!tag) continue;
    const attributes = `,${tag[1]}`;
    const method = /,METHOD=([A-Z0-9-]+)/.exec(attributes)?.[1] ?? "NONE";
    const keyFormat = /,KEYFORMAT="([^"]*)"/.exec(attributes)?.[1] ?? "identity";
    if (method.startsWith("SAMPLE-AES")) return keyFormat === "identity" ? method : keyFormat;
    if (method !== "NONE" && keyFormat !== "identity") return keyFormat;
  }
  return null;
}

/** The DRM system an MPD names in its first ContentProtection, null for a clear presentation. */
export function dashProtection(mpd: string): string | null {
  const tag = /<ContentProtection\b([^>]*)>/i.exec(mpd);
  if (!tag) return null;
  return /\bschemeIdUri="(urn:uuid:[^"]+)"/i.exec(tag[1])?.[1] ?? /\bvalue="([^"]+)"/i.exec(tag[1])?.[1] ?? "ContentProtection";
}

/**
 * The URL the engine opens for a manifest channel: an HLS master's top variant when it yields
 * one, a DASH MPD whole. Reads the manifest (and one HLS media playlist) first, so a DRM channel
 * fails here, in a second, and not after the engine and the server have both timed out on it.
 */
async function originVariantUrl(masterUrl: string, headers: Record<string, string> | undefined): Promise<string> {
  let master: string;
  let base = masterUrl;
  try {
    const response = await fetchWithTimeout(masterUrl, { headers: headers ?? {} }, API_TIMEOUTS.SHORT);
    if (!response.ok) return masterUrl;
    master = await response.text();
    // A shortlink master: its variants resolve against where it landed.
    if (response.url) base = response.url;
  } catch (error) {
    logger.debug("Origin master unreadable ahead of the engine, opening it whole", { service: "LiveTv", error: String(error) });
    return masterUrl;
  }
  if (/<MPD\b/i.test(master)) {
    const system = dashProtection(master);
    if (system) throw new Error(`channel is DRM protected (${system})`);
    return masterUrl;
  }
  const sessionKey = drmKeyFormat(master);
  if (sessionKey) throw new Error(`channel is DRM protected (${sessionKey})`);
  const variant = topVariantUrl(master, base);
  const media = variant ?? (variantsOf(master)[0] ? absolute(variantsOf(master)[0].uri, base) : null);
  if (media) {
    try {
      const response = await fetchWithTimeout(media, { headers: headers ?? {} }, API_TIMEOUTS.SHORT);
      const key = response.ok ? drmKeyFormat(await response.text()) : null;
      if (key) throw new Error(`channel is DRM protected (${key})`);
    } catch (error) {
      if (error instanceof Error && /DRM protected/.test(error.message)) throw error;
      logger.debug("Origin variant unreadable ahead of the engine", { service: "LiveTv", error: String(error) });
    }
  }
  return variant ?? masterUrl;
}

const CATEGORY_PARAMS: Record<LiveTvCategory, string> = { news: "isNews", sports: "isSports", kids: "isKids", movie: "isMovie", series: "isSeries" };

/** One page of channels in the server's channel order; the whole list when no page is asked for. */
export async function fetchChannels(
  page: { startIndex?: number; limit?: number; sortBy?: "SortName" | "Name"; category?: LiveTvCategory; favorite?: boolean } = {},
): Promise<{ items: JellyfinItem[]; total?: number }> {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const query = new URLSearchParams({
    userId: config.userId,
    addCurrentProgram: "true",
    enableUserData: "true",
    enableImages: "true",
    enableTotalRecordCount: "true",
    fields: "ChannelInfo,PrimaryImageAspectRatio",
    ...(page.startIndex !== undefined ? { startIndex: String(page.startIndex) } : {}),
    ...(page.limit !== undefined ? { limit: String(page.limit) } : {}),
    ...(page.sortBy ? { sortBy: page.sortBy } : {}),
    ...(page.category ? { [CATEGORY_PARAMS[page.category]]: "true" } : {}),
    ...(page.favorite ? { isFavorite: "true" } : {}),
  });
  const response = await fetchWithTimeout(
    `${config.server}/LiveTv/Channels?${query.toString()}`,
    { headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
    API_TIMEOUTS.NORMAL,
  );
  if (!response.ok) throwRequestError(response, `Failed to fetch channels: ${response.status}`);
  const json = await response.json();
  return { items: (json.Items ?? []) as JellyfinItem[], total: json.TotalRecordCount };
}

/**
 * The whole lineup in the order the guide shows for the sort, held to a category when given; ids and names
 * only. Measured 0.2 s and 2.9 MB on an 11k-channel server, where the full read took 5.5 s and timed out cold.
 */
export async function fetchChannelOrder(order: { sortBy?: "SortName" | "Name"; category?: LiveTvCategory } = {}): Promise<JellyfinItem[]> {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const query = new URLSearchParams({
    userId: config.userId,
    addCurrentProgram: "false",
    enableUserData: "false",
    enableImages: "false",
    enableTotalRecordCount: "false",
    ...(order.sortBy ? { sortBy: order.sortBy } : {}),
    ...(order.category ? { [CATEGORY_PARAMS[order.category]]: "true" } : {}),
  });
  const response = await fetchWithTimeout(
    `${config.server}/LiveTv/Channels?${query.toString()}`,
    { headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
    API_TIMEOUTS.NORMAL,
  );
  if (!response.ok) throwRequestError(response, `Failed to fetch channel order: ${response.status}`);
  const json = await response.json();
  return ((json.Items ?? []) as JellyfinItem[]).map(({ Id, Name, Type }) => ({ Id, Name, Type }) as JellyfinItem);
}

/** Category flags move only when guide data refreshes, so mounts share one read for a while. */
const CHANNEL_CATEGORIES_TTL_MS = 60 * 60 * 1000;

/** The categories with at least one channel: the flags come from XMLTV programme categories, so most servers have few. */
export async function fetchChannelCategories(): Promise<LiveTvCategory[]> {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  return cachedRequest(
    `channelCategories:${config.server}:${config.userId}`,
    async () => {
      const headers = { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) };
      const present = await Promise.all(
        LIVE_TV_CATEGORIES.map(async (category) => {
          const query = new URLSearchParams({ userId: config.userId, limit: "0", enableTotalRecordCount: "true", [CATEGORY_PARAMS[category]]: "true" });
          const response = await fetchWithTimeout(`${config.server}/LiveTv/Channels?${query.toString()}`, { headers }, API_TIMEOUTS.NORMAL);
          if (!response.ok) throwRequestError(response, `Failed to count channels: ${response.status}`);
          const json = await response.json();
          return (json.TotalRecordCount ?? 0) > 0;
        }),
      );
      return LIVE_TV_CATEGORIES.filter((_, index) => present[index]);
    },
    CHANNEL_CATEGORIES_TTL_MS,
  );
}

const LISTED_CHANNEL_FIELDS = "ChannelInfo,PrimaryImageAspectRatio";
/** Ids per /Items call, keeping the query string short. */
const IDS_PER_REQUEST = 100;

async function fetchChannelItems(params: Record<string, string>): Promise<JellyfinItem[]> {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const query = new URLSearchParams({ userId: config.userId, includeItemTypes: "TvChannel", fields: LISTED_CHANNEL_FIELDS, enableImages: "true", enableUserData: "true", ...params });
  const response = await fetchWithTimeout(
    `${config.server}/Items?${query.toString()}`,
    { headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
    API_TIMEOUTS.NORMAL,
  );
  if (!response.ok) throwRequestError(response, `Failed to fetch channels: ${response.status}`);
  const json = await response.json();
  return (json.Items ?? []) as JellyfinItem[];
}

/** The channels with these ids, in the ids' order; ids the server does not know are dropped. */
export async function fetchChannelsByIds(ids: readonly string[]): Promise<JellyfinItem[]> {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += IDS_PER_REQUEST) chunks.push(ids.slice(start, start + IDS_PER_REQUEST));
  // Without includeItemTypes the server drops most live channels from an ids query.
  const pages = await Promise.all(chunks.map((chunk) => fetchChannelItems({ ids: chunk.join(",") })));
  const byId = new Map<string, JellyfinItem>();
  for (const item of pages.flat()) if (item.Type === "TvChannel") byId.set(item.Id, item);
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

/** These channels in this order, each with its art, number and the programme it airs now. */
export async function fetchChannelWindow(ids: readonly string[]): Promise<JellyfinItem[]> {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const query = new URLSearchParams({ userId: config.userId, channelIds: ids.join(","), isAiring: "true", enableImages: "false", enableUserData: "false", enableTotalRecordCount: "false" });
  const [channels, response] = await Promise.all([
    fetchChannelsByIds(ids),
    fetchWithTimeout(
      `${config.server}/LiveTv/Programs?${query.toString()}`,
      { headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
      API_TIMEOUTS.NORMAL,
    ),
  ]);
  if (!response.ok) throwRequestError(response, `Failed to fetch airing programmes: ${response.status}`);
  const airing = new Map(((await response.json()).Items as JellyfinProgram[] | undefined)?.map((program) => [program.ChannelId, program]) ?? []);
  return channels.map((channel) => ({ ...channel, CurrentProgram: airing.get(channel.Id) ?? null }));
}

/**
 * The channels a list names, in its order, without paging the catalog. Stored ids come back by id;
 * an entry whose id answers for another channel here (ids repeat across servers) is found by name.
 */
export async function fetchListedChannels(list: readonly ChannelFavorite[]): Promise<JellyfinItem[]> {
  if (list.length === 0) return [];
  const byKey = new Map<string, JellyfinItem>();
  for (const item of await fetchChannelsByIds(list.flatMap((entry) => (entry.id ? [entry.id] : [])))) byKey.set(channelListKey(item), item);
  const missing = list.filter((entry) => !byKey.has(favoriteKey(entry)));
  const found = await Promise.all(
    missing.map(async (entry) => {
      const matches = await fetchChannelItems({ recursive: "true", searchTerm: entry.name, limit: "20" });
      return matches.find((item) => channelListKey(item) === favoriteKey(entry));
    }),
  );
  for (const item of found) if (item) byKey.set(channelListKey(item), item);
  return list.flatMap((entry) => {
    const item = byKey.get(favoriteKey(entry));
    return item ? [item] : [];
  });
}

/**
 * A channel described for playback. A manifest origin, or a raw TS stream the server lets clients read directly,
 * comes off the read-only PlaybackInfo and goes to the engine with no server open; any other source is opened on
 * the server. `info` is that PlaybackInfo when the caller already holds it.
 */
export async function resolveChannel(
  channelId: string,
  item?: JellyfinVideoItem,
  options: { quiet?: boolean; info?: { MediaSources?: JellyfinMediaSource[]; PlaySessionId?: string } } = {},
): Promise<JellyfinVideoItem> {
  const described = await describeChannel(channelId, item, options);
  return described.playable ?? openChannel(channelId, described.channel, { quiet: options.quiet });
}

/** The channel as the engine reads it without a server open, or null when only an open reads it (a preview's terms). */
export async function resolveChannelWithoutOpen(channelId: string): Promise<JellyfinVideoItem | null> {
  return (await describeChannel(channelId, undefined, { quiet: true })).playable;
}

async function describeChannel(
  channelId: string,
  item: JellyfinVideoItem | undefined,
  options: { quiet?: boolean; info?: { MediaSources?: JellyfinMediaSource[]; PlaySessionId?: string } },
): Promise<{ channel: JellyfinVideoItem; playable: JellyfinVideoItem | null }> {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const headers = { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) };
  const [itemResponse, infoResponse] = await Promise.all([
    item ? null : fetchWithTimeout(`${config.server}/Items/${channelId}?userId=${config.userId}&EnableUserData=true`, { headers }, API_TIMEOUTS.NORMAL),
    options.info ? null : fetchWithTimeout(`${config.server}/Items/${channelId}/PlaybackInfo?UserId=${config.userId}`, { headers }, API_TIMEOUTS.NORMAL),
  ]);
  if (itemResponse && !itemResponse.ok) throwRequestError(itemResponse, `Failed to fetch channel: ${itemResponse.status}`);
  if (infoResponse && !infoResponse.ok) throwRequestError(infoResponse, `Failed to fetch channel playback info: ${infoResponse.status}`);
  const channel: JellyfinVideoItem = item ?? (await itemResponse!.json());
  const info = options.info ?? (await infoResponse!.json());
  const source: JellyfinMediaSource | undefined = info.MediaSources?.[0];
  const described = { ...channel, MediaSources: info.MediaSources, MediaStreams: source?.MediaStreams ?? [], PlaySessionId: info.PlaySessionId };
  if (source && !isManifestSource(source)) {
    const raw = await rawLiveInput(config.server, config.apiKey, channelId, source);
    if (!raw) return { channel, playable: null };
    logger.info("Live channel resolved without a server open", { service: "LiveTv", channel: channel.Name, via: raw.via });
    return {
      channel,
      playable: {
        ...described,
        liveStreamUrl: raw.url,
        liveOriginKey: raw.originKey,
        ...(raw.headers ? { liveHttpHeaders: raw.headers } : {}),
        ...(raw.fallbackUrl ? { liveFallbackUrl: raw.fallbackUrl } : {}),
      },
    };
  }
  if (!source) return { channel, playable: null };

  if (!options.quiet) setPlaybackStage("opening");
  const origin = await manifestOrigin(source);
  logger.info("Live channel resolved to its origin", { service: "LiveTv", channel: channel.Name, variant: origin.url !== source.Path });
  return { channel, playable: { ...described, liveStreamUrl: origin.url, ...(origin.headers ? { liveHttpHeaders: origin.headers } : {}) } };
}

async function manifestOrigin(source: JellyfinMediaSource): Promise<ChannelOrigin> {
  const url = await originVariantUrl(source.Path!, source.RequiredHttpHeaders);
  return { url, ...(source.RequiredHttpHeaders ? { headers: source.RequiredHttpHeaders } : {}) };
}

/**
 * A channel's origin for a frame grab, off the read-only PlaybackInfo: nothing is opened on the
 * server, and the playlist goes as given (the engine picks the variant a card needs, through its
 * own HTTP, which App Transport Security does not gate). Null for a channel the server carries,
 * "untuned" for one it lists that no tuner carries.
 */
export async function resolveChannelOrigin(channelId: string): Promise<ChannelOrigin | "untuned" | null> {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const headers = { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) };
  const response = await fetchWithTimeout(`${config.server}/Items/${channelId}/PlaybackInfo?UserId=${config.userId}`, { headers }, API_TIMEOUTS.NORMAL);
  if (!response.ok) throwRequestError(response, `Failed to fetch channel playback info: ${response.status}`);
  const info = await response.json();
  const source: JellyfinMediaSource | undefined = info.MediaSources?.[0];
  // Jellyfin's placeholder when no tuner lists the channel (LiveTvMediaSourceProvider.cs): the item's own id, no path.
  if (source && !source.Path && source.Id === channelId) return "untuned";
  if (source && !isManifestSource(source)) {
    const raw = await rawLiveInput(config.server, config.apiKey, channelId, source);
    return raw ? { url: raw.url, originKey: raw.originKey, ...(raw.headers ? { headers: raw.headers } : {}), ...(raw.fallbackUrl ? { fallbackUrl: raw.fallbackUrl } : {}) } : null;
  }
  if (!source) return null;
  return { url: source.Path!, ...(source.RequiredHttpHeaders ? { headers: source.RequiredHttpHeaders } : {}) };
}

/**
 * Open a channel's live stream and describe it as a playable item: the raw tuner bytes,
 * every stream the server probed, and the ids the reports and the close need.
 * `serverOnly` opens it for the server's transcode alone, the lane a channel takes when the engine cannot play it;
 * that open carries the Streaming Quality preset as its bitrate ceiling, the way the file transcode does.
 */
export async function openChannel(channelId: string, item?: JellyfinVideoItem, options: { quiet?: boolean; serverOnly?: boolean } = {}): Promise<JellyfinVideoItem> {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) };
  const origin: LiveOrigin = { server: config.server, deviceId: config.deviceId, apiKey: config.apiKey };
  const maxBitrate = options.serverOnly ? await liveTranscodeBitrate() : LIVE_BITRATE_CAP;
  const body = {
    UserId: config.userId,
    DeviceProfile: liveDeviceProfile(maxBitrate),
    // The server builds a TranscodingUrl only for a source it will not direct play.
    EnableDirectPlay: !options.serverOnly,
    EnableDirectStream: !options.serverOnly,
    EnableTranscoding: true,
    AutoOpenLiveStream: true,
    MaxStreamingBitrate: maxBitrate,
  };
  // The open probes the origin on the server (measured 11.8s cold), longer than a normal call; the
  // fallback's open is capped at the normal budget, above that.
  // A ring neighbour opens in the background and must not narrate over the channel on screen.
  if (!options.quiet) setPlaybackStage("opening");
  const infoRequest = fetchWithTimeout(
    `${config.server}/Items/${channelId}/PlaybackInfo?UserId=${config.userId}`,
    { method: "POST", headers, body: JSON.stringify(body) },
    options.serverOnly ? API_TIMEOUTS.NORMAL : API_TIMEOUTS.EXTENDED,
  );
  // The item's failure surfaces at once; an open that still goes through beside it is released as it lands.
  const releaseOpenWhenItLands = () => void infoRequest.then((response) => (response.ok ? closeOpenedStream(response, origin) : undefined)).catch(() => {});
  let itemResponse: Response | null = null;
  try {
    itemResponse = item ? null : await fetchWithTimeout(`${config.server}/Items/${channelId}?userId=${config.userId}&EnableUserData=true`, { headers }, API_TIMEOUTS.NORMAL);
  } catch (error) {
    releaseOpenWhenItLands();
    throw error;
  }
  if (itemResponse && !itemResponse.ok) {
    releaseOpenWhenItLands();
    throwRequestError(itemResponse, `Failed to fetch channel: ${itemResponse.status}`);
  }
  const infoResponse = await infoRequest;
  if (!infoResponse.ok) throwRequestError(infoResponse, `Failed to open channel: ${infoResponse.status}`);
  const channel: JellyfinVideoItem = item ?? (await itemResponse!.json());
  const info = await infoResponse.json();
  const source: JellyfinMediaSource | undefined = info.MediaSources?.[0];
  const raw = !options.serverOnly && !!source?.Path && source.SupportsDirectPlay === true;
  const manifest = !options.serverOnly && !!source && !raw && isManifestSource(source);
  // The server's transcode URL already carries the session, the live stream and the token.
  const liveTranscodeUrl = source?.SupportsTranscoding && source.TranscodingUrl ? `${config.server}${source.TranscodingUrl}` : undefined;
  const engineInput = !!source?.Path && (raw || manifest);
  if (!source || (!engineInput && !liveTranscodeUrl)) {
    // An open that answered with a stream nobody can play still holds the tuner.
    void closeLiveStream(source?.LiveStreamId, origin);
    throw new Error(`The server did not open ${channel.Name}${info.ErrorCode ? ` (${info.ErrorCode})` : ""}`);
  }
  let liveStreamUrl: string | undefined;
  try {
    liveStreamUrl = !engineInput ? undefined : manifest ? await originVariantUrl(source.Path!, source.RequiredHttpHeaders) : liveStreamUrlFor(config.server, config.apiKey, source.Path!);
  } catch (error) {
    // The server holds the tuner for an open nobody will play.
    void closeLiveStream(source.LiveStreamId, origin);
    throw error;
  }
  clearOpenFailure(channelId);
  if (source.LiveStreamId) {
    openOrigins.set(source.LiveStreamId, origin);
    recordOpen(source.LiveStreamId, { server: config.server, deviceId: config.deviceId });
  }
  logger.info("Live channel opened", {
    service: "LiveTv",
    channel: channel.Name,
    container: source.Container,
    origin: !engineInput ? "none" : manifest ? "manifest" : "server",
    serverTranscode: !!liveTranscodeUrl,
    liveStreamId: source.LiveStreamId,
    streams: (source.MediaStreams ?? []).map((stream) => `${stream.Type}:${stream.Codec}`).join(","),
  });
  return {
    ...channel,
    MediaSources: info.MediaSources,
    MediaStreams: source.MediaStreams ?? [],
    PlaySessionId: info.PlaySessionId,
    LiveStreamId: source.LiveStreamId ?? undefined,
    ...(liveStreamUrl ? { liveStreamUrl } : {}),
    ...(liveTranscodeUrl ? { liveTranscodeUrl } : {}),
    ...(manifest && source.RequiredHttpHeaders ? { liveHttpHeaders: source.RequiredHttpHeaders } : {}),
    // The origin a resolve carried in is not this lane's input.
    ...(options.serverOnly ? { liveStreamUrl: undefined, liveHttpHeaders: undefined } : {}),
  };
}

/** The live stream an open's PlaybackInfo answer names, closed; nothing when it named none. */
async function closeOpenedStream(infoResponse: Response, origin: LiveOrigin): Promise<void> {
  try {
    const info = (await infoResponse.json()) as { MediaSources?: JellyfinMediaSource[] };
    await closeLiveStream(info.MediaSources?.[0]?.LiveStreamId, origin);
  } catch (error) {
    logger.warn("Live open could not be read back for its close", error, { service: "LiveTv" });
  }
}

type LiveOrigin = { server: string; deviceId: string; apiKey: string };

/** The server and credentials each open this run made went out on; a switch must not redirect its close. */
const openOrigins = new Map<string, LiveOrigin>();

/**
 * Release the tuner on the server that opened it; the server holds it for every open that never closes.
 * A 2xx or 4xx ends the record of the open; a 5xx or no answer keeps it, so the close is retried at the next launch or foreground.
 */
export async function closeLiveStream(liveStreamId: string | null | undefined, origin?: LiveOrigin): Promise<void> {
  if (!liveStreamId) return;
  try {
    const config = origin ?? openOrigins.get(liveStreamId) ?? (await getConfig());
    if (!config.server || !config.apiKey) return;
    const response = await fetchWithTimeout(
      `${config.server}/LiveStreams/Close?liveStreamId=${encodeURIComponent(liveStreamId)}`,
      { method: "POST", headers: { Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
      API_TIMEOUTS.SHORT,
    );
    // Once closed, the run no longer holds the open, so a record a 5xx keeps is the foreground sweep's to resend.
    openOrigins.delete(liveStreamId);
    if (response.status >= 500) {
      logger.warn("Live stream close not taken", { service: "LiveTv", status: response.status, liveStreamId });
      return;
    }
    recordClose(liveStreamId);
    if (!response.ok) logger.warn("Live stream close refused", { service: "LiveTv", status: response.status, liveStreamId });
  } catch (error) {
    openOrigins.delete(liveStreamId);
    logger.warn("Live stream close failed", error, { service: "LiveTv", liveStreamId });
  }
}

/**
 * Recorded opens this run does not hold are closed: on the signed-in server with its token, on another server with
 * that account's saved token, and forgotten only when no saved account can reach them. Run at launch and on foreground.
 */
export async function closeLeftoverOpens(): Promise<void> {
  const held = recordedOpens();
  const ids = Object.keys(held).filter((liveStreamId) => !openOrigins.has(liveStreamId));
  if (ids.length === 0) return;
  const config = await getConfig();
  // Credentials that could not be read are not credentials for another server: the records wait.
  if (didConfigReadFail()) return;
  let accounts: Awaited<ReturnType<typeof getSavedAccounts>> | null = null;
  for (const liveStreamId of ids) {
    const open = held[liveStreamId];
    if (open.server === config.server && config.apiKey) {
      await closeLiveStream(liveStreamId, { ...open, apiKey: config.apiKey });
      continue;
    }
    accounts ??= await getSavedAccounts().catch(() => []);
    const trimmed = open.server.replace(/\/+$/, "");
    const account = accounts.find((a) => a.deviceId === open.deviceId && a.serverUrl.replace(/\/+$/, "") === trimmed);
    const token = account ? await SecureStore.getItemAsync(accountTokenKey(account.serverId, account.userId)).catch(() => null) : null;
    if (token) await closeLiveStream(liveStreamId, { ...open, apiKey: token });
    else recordClose(liveStreamId);
  }
  const kept = ids.filter((liveStreamId) => liveStreamId in recordedOpens()).length;
  logger.info("Live opens left by a previous run", { service: "LiveTv", count: ids.length, kept });
}

async function liveTvRequest(path: string, init: RequestInit = {}, timeout: number = API_TIMEOUTS.NORMAL): Promise<Response> {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey), ...(init.headers ?? {}) };
  const response = await fetchWithTimeout(`${config.server}${path}`, { ...init, headers }, timeout);
  if (!response.ok) throwRequestError(response, `Live TV request failed: ${response.status}`);
  return response;
}

async function userQuery(extra: Record<string, string> = {}): Promise<string> {
  const config = await getConfig();
  return new URLSearchParams({ userId: config.userId ?? "", ...extra }).toString();
}

export interface GuideWindow {
  /** Channels whose programs to load; every channel when empty. */
  channelIds: string[];
  startMs: number;
  endMs: number;
}

/** Every program overlapping the window, by start time; image tags for the cell's thumbnail, no user data. */
export async function fetchGuidePrograms({ channelIds, startMs, endMs }: GuideWindow): Promise<JellyfinProgram[]> {
  const config = await getConfig();
  const body = {
    UserId: config.userId,
    ChannelIds: channelIds.length > 0 ? channelIds : undefined,
    MinEndDate: new Date(startMs).toISOString(),
    MaxStartDate: new Date(endMs).toISOString(),
    SortBy: ["StartDate"],
    EnableImages: true,
    EnableUserData: false,
    EnableTotalRecordCount: false,
    Fields: ["ChannelInfo", "Genres", "PrimaryImageAspectRatio"],
  };
  const response = await liveTvRequest("/LiveTv/Programs", { method: "POST", body: JSON.stringify(body) }, API_TIMEOUTS.EXTENDED);
  const json = await response.json();
  return (json.Items ?? []) as JellyfinProgram[];
}

/** When the server's guide ends: the start of its last program, or null for a guide with none. */
export async function fetchGuideHorizon(): Promise<number | null> {
  const config = await getConfig();
  const body = {
    UserId: config.userId,
    SortBy: ["StartDate"],
    SortOrder: ["Descending"],
    Limit: 1,
    EnableImages: false,
    EnableUserData: false,
    EnableTotalRecordCount: false,
    Fields: [],
  };
  const response = await liveTvRequest("/LiveTv/Programs", { method: "POST", body: JSON.stringify(body) });
  const json = await response.json();
  const start = ((json.Items ?? []) as JellyfinProgram[])[0]?.StartDate;
  return start ? Date.parse(start) : null;
}

export async function fetchTimers(): Promise<JellyfinTimer[]> {
  const response = await liveTvRequest("/LiveTv/Timers");
  const json = await response.json();
  return (json.Items ?? []) as JellyfinTimer[];
}

export async function fetchSeriesTimers(): Promise<JellyfinSeriesTimer[]> {
  const response = await liveTvRequest("/LiveTv/SeriesTimers");
  const json = await response.json();
  return (json.Items ?? []) as JellyfinSeriesTimer[];
}

/** The server's prefilled timer for a program; the same body creates a single timer or a series rule. */
export async function fetchTimerDefaults(programId?: string): Promise<JellyfinSeriesTimer> {
  const query = programId ? `?programId=${encodeURIComponent(programId)}` : "";
  const response = await liveTvRequest(`/LiveTv/Timers/Defaults${query}`);
  return (await response.json()) as JellyfinSeriesTimer;
}

/** A timer write starts or stops a recording, so cached recording reads go stale at once. */
async function invalidateAfterTimerWrite(recordingItemId?: string): Promise<void> {
  const config = await getConfig();
  invalidateRecordingReads(config.userId, recordingItemId);
}

export async function createTimer(defaults: JellyfinSeriesTimer): Promise<void> {
  await liveTvRequest("/LiveTv/Timers", { method: "POST", body: JSON.stringify(defaults) });
  await invalidateAfterTimerWrite();
}

export async function createSeriesTimer(defaults: JellyfinSeriesTimer): Promise<void> {
  await liveTvRequest("/LiveTv/SeriesTimers", { method: "POST", body: JSON.stringify(defaults) });
  await invalidateAfterTimerWrite();
}

// recordingItemId: the in-progress recording this timer is writing, when the caller has it.
export async function cancelTimer(timerId: string, recordingItemId?: string): Promise<void> {
  await liveTvRequest(`/LiveTv/Timers/${encodeURIComponent(timerId)}`, { method: "DELETE" });
  await invalidateAfterTimerWrite(recordingItemId);
}

export async function cancelSeriesTimer(seriesTimerId: string): Promise<void> {
  await liveTvRequest(`/LiveTv/SeriesTimers/${encodeURIComponent(seriesTimerId)}`, { method: "DELETE" });
  await invalidateAfterTimerWrite();
}

/** Whether the account may schedule and cancel recordings; the server answers 403 to timer writes without it. */
export async function fetchLiveTvManagement(): Promise<boolean> {
  const response = await liveTvRequest("/Users/Me");
  const user = (await response.json()) as { Policy?: { EnableLiveTvManagement?: boolean } };
  return user.Policy?.EnableLiveTvManagement === true;
}

/** Every recordings library's folder id, the CollectionFolder an item's Ancestors name as its library. */
export async function fetchRecordingFolderIds(): Promise<string[]> {
  const config = await getConfig();
  return cachedRequest(
    `recordingFolders:${config.server}:${config.userId}`,
    async () => {
      const response = await liveTvRequest(`/LiveTv/Recordings/Folders?${await userQuery()}`, {}, API_TIMEOUTS.QUICK);
      const json = (await response.json()) as { Items?: { Id: string }[] };
      return (json.Items ?? []).map((folder) => folder.Id);
    },
    CACHE.DEFAULT_TTL_MS,
  );
}

/** Finished recordings, ordinary playable items in the server's recordings library. */
export async function fetchRecordings(): Promise<{ items: JellyfinItem[]; total?: number }> {
  const response = await liveTvRequest(
    `/LiveTv/Recordings?${await userQuery({ enableImages: "true", enableUserData: "true", fields: "PrimaryImageAspectRatio,Overview", sortBy: "StartDate", sortOrder: "Descending" })}`,
  );
  const json = await response.json();
  return { items: (json.Items ?? []) as JellyfinItem[], total: json.TotalRecordCount };
}

export async function fetchProgram(programId: string): Promise<JellyfinProgram> {
  const response = await liveTvRequest(`/LiveTv/Programs/${encodeURIComponent(programId)}?${await userQuery({ fields: "PrimaryImageAspectRatio" })}`);
  return (await response.json()) as JellyfinProgram;
}
