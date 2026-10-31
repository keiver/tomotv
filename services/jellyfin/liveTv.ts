/**
 * Live TV through the on-device engine. A manifest channel plays from its origin with no server
 * open; any other source is opened on the server and read from its origin, the server's relay, or
 * the server's remux when this device cannot reach the origin. The server never re-encodes a channel.
 */
import { JellyfinItem, JellyfinMediaSource, JellyfinProgram, JellyfinSeriesTimer, JellyfinTimer, JellyfinVideoItem } from "@/types/jellyfin";
import { CACHE } from "@/constants/app";
import { engineCodecAllowlists } from "@/services/localRemux";
import { activeGuideUrls, fetchExternalAiringPrograms } from "@/services/externalGuide";
import { channelListKey, favoriteKey, getLiveTvPreferences, type ChannelFavorite, type LiveTvCategory } from "@/services/liveTvPreferences";
import { setPlaybackStage } from "@/services/playbackStage";
import { cachedRequest } from "@/services/requestCache";
import { logger } from "@/utils/logger";
import { invalidateRecordingReads } from "./cacheKeys";
import { applyChannelEdits } from "./channelEdits";
import * as SecureStore from "expo-secure-store";
import { getSavedAccounts } from "./accounts";
import { accountTokenKey, API_TIMEOUTS } from "./constants";
import { fetchWithTimeout } from "./http";
import { rawLiveInput } from "./liveInput";
import { recordClose, recordedOpens, recordOpen } from "./liveOpens";
import { playlistPlayable, playlistStandIn, playlistStandInsAllowed, standInItem } from "./playlistItems";
import { didConfigReadFail, getAuthHeader, getConfig, throwRequestError } from "./session";
import { lastKnownTunerData } from "./tunerGroups";
import { type ChannelOrigin, clearOpenFailure, manifestDrm, mergeOriginHeaders, originKeyOf, originReach, playlistChannelById, splitPipeHeaders } from "@keiver/tomo-live";

export type { ChannelOrigin };
export { dashProtection, drmKeyFormat, noteOpenFailed, openRecentlyFailed } from "@keiver/tomo-live";

const LIVE_BITRATE_CAP = 200_000_000;

/**
 * Every codec the engine copies or decodes, declared as direct play on MPEG-TS and as the codecs of
 * the one transcoding profile: when the server must carry a channel this device cannot reach, the
 * codecs match and its HLS is a copy of the channel (live HLS is TS-only on Jellyfin).
 */
function liveDeviceProfile() {
  const { video, audio } = engineCodecAllowlists();
  return {
    Name: "Tomo TV live",
    MaxStreamingBitrate: LIVE_BITRATE_CAP,
    MaxStaticBitrate: LIVE_BITRATE_CAP,
    DirectPlayProfiles: [
      { Type: "Video", Container: "ts,mpegts", VideoCodec: video.join(","), AudioCodec: audio.join(",") },
      { Type: "Audio", Container: "ts,mpegts,mp3,aac,adts", AudioCodec: audio.join(",") },
    ],
    TranscodingProfiles: [{ Type: "Video", Container: "ts", Protocol: "hls", VideoCodec: video.join(","), AudioCodec: audio.join(","), Context: "Streaming" }],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [],
  };
}

/** Jellyfin's relay of an open tuner stream (a shared TS stream, an HDHomeRun): a byte copy of the channel. */
const RELAY_PATH = /\/LiveTv\/LiveStreamFiles\//i;

/** The reasons a TranscodingUrl may carry and still be taken as a copy of the channel. */
const COPY_REASONS = new Set(["DirectPlayError"]);

/** The server's HLS of an open channel when it copies the channel; null when it would re-encode any of it. */
export function remuxOf(server: string, transcodingUrl: string | null | undefined): string | null {
  if (!transcodingUrl) return null;
  const reasons = /[?&]TranscodeReasons=([^&]*)/i.exec(transcodingUrl)?.[1];
  const named = reasons ? decodeURIComponent(reasons).split(",").filter(Boolean) : [];
  return named.every((reason) => COPY_REASONS.has(reason)) ? `${server}${transcodingUrl}` : null;
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

/** The URL the engine opens for a manifest channel: the master as given, a DASH MPD checked here for DRM. */
async function manifestInput(source: JellyfinMediaSource, masterUrl: string): Promise<string> {
  if (!isDashSource(source)) return masterUrl;
  const system = await manifestDrm(masterUrl, source.RequiredHttpHeaders, API_TIMEOUTS.SHORT);
  if (system) throw new Error(`channel is DRM protected (${system})`);
  return masterUrl;
}

function isDashSource(source: JellyfinMediaSource): boolean {
  return source.Container === "dash" || /\.mpd(?:$|\?)/i.test(source.Path ?? "");
}

const CATEGORY_PARAMS: Record<LiveTvCategory, string> = { news: "isNews", sports: "isSports", kids: "isKids", movie: "isMovie", series: "isSeries" };

/** Channels listed with no current programme get the one airing now from the device guides already open.
 *  Bounded by the page the caller fetched; any failure leaves the page as the server sent it. */
export async function fillAiringFromGuides<T extends JellyfinVideoItem>(channels: T[]): Promise<T[]> {
  const bare = channels.filter((channel) => channel.Type === "TvChannel" && !channel.CurrentProgram);
  if (bare.length === 0) return channels;
  try {
    const data = lastKnownTunerData();
    const urls = activeGuideUrls(getLiveTvPreferences(), data?.tvgUrls ?? []);
    if (urls.length === 0) return channels;
    const requests = bare.map((channel) => ({ channelId: channel.Id, tvgId: data?.tvgById[channel.Id], tvgName: data?.tvgNameById[channel.Id], name: channel.Name ?? "" }));
    const airing = await fetchExternalAiringPrograms(urls, requests, Date.now());
    if (airing.length === 0) return channels;
    const byChannel = new Map(airing.map((program) => [program.ChannelId, program]));
    return channels.map((channel) => (byChannel.has(channel.Id) ? { ...channel, CurrentProgram: byChannel.get(channel.Id) } : channel));
  } catch {
    return channels;
  }
}

/** One page of channels in the server's channel order; the whole list when no page is asked for. */
export async function fetchChannels(page: { startIndex?: number; limit?: number; sortBy?: "SortName" | "Name"; favorite?: boolean } = {}): Promise<{ items: JellyfinItem[]; total?: number }> {
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
    ...(page.favorite ? { isFavorite: "true" } : {}),
  });
  const response = await fetchWithTimeout(
    `${config.server}/LiveTv/Channels?${query.toString()}`,
    { headers: { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
    API_TIMEOUTS.NORMAL,
  );
  if (!response.ok) throwRequestError(response, `Failed to fetch channels: ${response.status}`);
  const json = await response.json();
  return { items: applyChannelEdits(await fillAiringFromGuides((json.Items ?? []) as JellyfinItem[])), total: json.TotalRecordCount };
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
  return applyChannelEdits(((json.Items ?? []) as JellyfinItem[]).map(({ Id, Name, Type, ChannelNumber }) => ({ Id, Name, Type, ...(ChannelNumber ? { ChannelNumber } : {}) }) as JellyfinItem));
}

/** Category flags move only when guide data refreshes, so mounts share one read for a while; the guide's refresh drops it. */
const CATEGORY_CHANNELS_TTL_MS = 60 * 60 * 1000;

/** The ids of the server's channels in a category, in the guide's order for the sort. */
export async function fetchCategoryChannelIds(category: LiveTvCategory, sortBy: "SortName" | "Name"): Promise<string[]> {
  const config = await getConfig();
  return cachedRequest(
    `guide:category:${config.server}:${config.userId}:${category}:${sortBy}`,
    async () => (await fetchChannelOrder({ sortBy, category })).map((channel) => channel.Id),
    CATEGORY_CHANNELS_TTL_MS,
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

/** The channels with these ids, in the ids' order. An id the server does not know yet stands in
 *  as the device's own playlist parse of it; one no playlist carries either is dropped. */
export async function fetchChannelsByIds(ids: readonly string[]): Promise<JellyfinItem[]> {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += IDS_PER_REQUEST) chunks.push(ids.slice(start, start + IDS_PER_REQUEST));
  // Without includeItemTypes the server drops most live channels from an ids query.
  const pages = await Promise.all(chunks.map((chunk) => fetchChannelItems({ ids: chunk.join(",") })));
  const byId = new Map<string, JellyfinItem>();
  for (const item of pages.flat()) if (item.Type === "TvChannel") byId.set(item.Id, item);
  const standIns = ids.some((id) => !byId.has(id) && playlistChannelById(id)) && (await playlistStandInsAllowed());
  return applyChannelEdits(
    ids.flatMap((id) => {
      const row = byId.has(id) || !standIns ? null : playlistChannelById(id);
      const item = byId.get(id) ?? (row ? standInItem(row) : null);
      return item ? [item] : [];
    }),
  );
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
  return fillAiringFromGuides(channels.map((channel) => ({ ...channel, CurrentProgram: airing.get(channel.Id) ?? null })));
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
  return applyChannelEdits(
    list.flatMap((entry) => {
      const item = byKey.get(favoriteKey(entry));
      return item ? [item] : [];
    }),
  );
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
  // An id the server has not ingested yet plays off the device's own playlist parse of the tuner.
  const playable = itemResponse?.status === 404 || infoResponse?.status === 404 ? await playlistPlayable(channelId) : null;
  if (playable) {
    logger.info("Live channel resolved from the playlist table", { service: "LiveTv", channel: playable.Name });
    return { channel: playable, playable };
  }
  if (itemResponse && !itemResponse.ok) throwRequestError(itemResponse, `Failed to fetch channel: ${itemResponse.status}`);
  if (infoResponse && !infoResponse.ok) throwRequestError(infoResponse, `Failed to fetch channel playback info: ${infoResponse.status}`);
  // The player's Info tab shows the airing programme's rating and genre.
  const [channel] = await fillAiringFromGuides<JellyfinVideoItem>([item ?? (await itemResponse!.json())]);
  const info = options.info ?? (await infoResponse!.json());
  const source: JellyfinMediaSource | undefined = info.MediaSources?.[0];
  const described = { ...channel, MediaSources: info.MediaSources, MediaStreams: source?.MediaStreams ?? [], PlaySessionId: info.PlaySessionId };
  if (source && !isManifestSource(source)) {
    const raw = await rawLiveInput(source);
    if (!raw) return { channel, playable: null };
    logger.info("Live channel resolved without a server open", { service: "LiveTv", channel: channel.Name });
    return {
      channel,
      playable: {
        ...described,
        liveStreamUrl: raw.url,
        liveOriginKey: raw.originKey,
        ...(raw.headers ? { liveHttpHeaders: raw.headers } : {}),
      },
    };
  }
  if (!source) return { channel, playable: null };

  if (!options.quiet) setPlaybackStage("opening");
  const origin = await manifestOrigin(source);
  logger.info("Live channel resolved to its origin", { service: "LiveTv", channel: channel.Name });
  return {
    channel,
    playable: { ...described, liveStreamUrl: origin.url, ...(origin.headers ? { liveHttpHeaders: origin.headers } : {}), ...(isDashSource(source) ? {} : { livePlaylist: true }) },
  };
}

async function manifestOrigin(source: JellyfinMediaSource): Promise<ChannelOrigin> {
  const url = await manifestInput(source, source.Path!);
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
  if (!response.ok) {
    // An id the server has not ingested yet: its origin is the playlist entry the device parsed.
    const row = response.status === 404 ? await playlistStandIn(channelId) : null;
    if (row) return { url: row.streamUrl, originKey: row.originKey, ...(Object.keys(row.headers).length > 0 ? { headers: row.headers } : {}) };
    throwRequestError(response, `Failed to fetch channel playback info: ${response.status}`);
  }
  const info = await response.json();
  const source: JellyfinMediaSource | undefined = info.MediaSources?.[0];
  // Jellyfin's placeholder when no tuner lists the channel (LiveTvMediaSourceProvider.cs): the item's own id, no path.
  if (source && !source.Path && source.Id === channelId) return "untuned";
  if (source && !isManifestSource(source)) {
    const raw = await rawLiveInput(source);
    return raw ? { url: raw.url, originKey: raw.originKey, ...(raw.headers ? { headers: raw.headers } : {}) } : null;
  }
  if (!source) return null;
  return { url: source.Path!, ...(source.RequiredHttpHeaders ? { headers: source.RequiredHttpHeaders } : {}) };
}

/**
 * Open a channel's live stream and describe it as a playable item: what the engine reads, every
 * stream the server probed, and the ids the reports and the close need. The engine reads the
 * provider's own URL when this device reaches it, else the server's relay of the open (a shared
 * TS stream, an HDHomeRun), else the server's HLS copy of it (`remux`, asked for in a second open),
 * and never a re-encode: a channel the server could only re-encode fails here.
 */
export async function openChannel(channelId: string, item?: JellyfinVideoItem, options: { quiet?: boolean; remux?: boolean } = {}): Promise<JellyfinVideoItem> {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) };
  const origin: LiveOrigin = { server: config.server, deviceId: config.deviceId, apiKey: config.apiKey };
  const body = {
    UserId: config.userId,
    DeviceProfile: liveDeviceProfile(),
    // The server builds a TranscodingUrl only for a source it will not direct play.
    EnableDirectPlay: !options.remux,
    EnableDirectStream: !options.remux,
    EnableTranscoding: true,
    AutoOpenLiveStream: true,
    MaxStreamingBitrate: LIVE_BITRATE_CAP,
  };
  // A ring neighbour opens in the background and must not narrate over the channel on screen.
  if (!options.quiet) setPlaybackStage("opening");
  const infoRequest = fetchWithTimeout(`${config.server}/Items/${channelId}/PlaybackInfo?UserId=${config.userId}`, { method: "POST", headers, body: JSON.stringify(body) }, API_TIMEOUTS.EXTENDED);
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
  const [channel] = await fillAiringFromGuides<JellyfinVideoItem>([item ?? (await itemResponse!.json())]);
  const info = await infoResponse.json();
  const source: JellyfinMediaSource | undefined = info.MediaSources?.[0];
  if (!source) throw new Error(`The server did not open ${channel.Name}${info.ErrorCode ? ` (${info.ErrorCode})` : ""}`);
  let input: { url: string; headers?: Record<string, string>; originKey?: string; via: "relay" | "manifest" | "origin" | "remux" } | null = null;
  try {
    if (options.remux) {
      const remux = remuxOf(config.server, source.TranscodingUrl);
      if (remux) input = { url: remux, via: "remux" };
    } else if (source.Path && RELAY_PATH.test(source.Path)) {
      input = { url: liveStreamUrlFor(config.server, config.apiKey, source.Path), via: "relay" };
    } else if (isManifestSource(source)) {
      input = { url: await manifestInput(source, source.Path!), headers: source.RequiredHttpHeaders, via: "manifest" };
    } else if (source.Path && /^https?$/i.test(source.Protocol ?? "")) {
      const { url, headers: own } = splitPipeHeaders(source.Path);
      if ((await originReach(url)) === "reachable") input = { url, headers: mergeOriginHeaders(source.RequiredHttpHeaders, own), originKey: originKeyOf(url), via: "origin" };
    }
  } catch (error) {
    // The server holds the tuner for an open nobody will play.
    void closeLiveStream(source.LiveStreamId, origin);
    throw error;
  }
  if (!input) {
    // An open that answered with a stream nobody can play still holds the tuner.
    void closeLiveStream(source.LiveStreamId, origin);
    if (!options.remux) return openChannel(channelId, channel, { ...options, remux: true });
    throw new Error(`The server can carry ${channel.Name} only by re-encoding it${info.ErrorCode ? ` (${info.ErrorCode})` : ""}`);
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
    via: input.via,
    liveStreamId: source.LiveStreamId,
    streams: (source.MediaStreams ?? []).map((stream) => `${stream.Type}:${stream.Codec}`).join(","),
  });
  return {
    ...channel,
    MediaSources: info.MediaSources,
    MediaStreams: source.MediaStreams ?? [],
    PlaySessionId: info.PlaySessionId,
    LiveStreamId: source.LiveStreamId ?? undefined,
    liveStreamUrl: input.url,
    liveHttpHeaders: input.headers && Object.keys(input.headers).length > 0 ? input.headers : undefined,
    liveOriginKey: input.originKey,
    ...(input.via === "manifest" && !isDashSource(source) ? { livePlaylist: true } : {}),
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

/** The recording a timer is writing now; null while it has none. */
export async function fetchInProgressRecording(timerId: string): Promise<JellyfinItem | null> {
  const response = await liveTvRequest(`/LiveTv/Recordings?${await userQuery({ isInProgress: "true" })}`, {}, API_TIMEOUTS.QUICK);
  const json = (await response.json()) as { Items?: (JellyfinItem & { TimerId?: string })[] };
  return json.Items?.find((item) => item.TimerId === timerId) ?? null;
}

/** The first bytes of a recording's file as written so far; empty while nothing has reached disk (the server answers 416). */
export async function readRecordingStart(itemId: string): Promise<Uint8Array> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) throw new Error("Jellyfin server not configured.");
  const response = await fetchWithTimeout(
    `${config.server}/Items/${encodeURIComponent(itemId)}/Download`,
    { headers: { Authorization: getAuthHeader(config.deviceId, config.apiKey), Range: "bytes=0-187" } },
    API_TIMEOUTS.QUICK,
  );
  if (response.status === 416) return new Uint8Array(0);
  if (!response.ok) throwRequestError(response, `Recording read failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function fetchProgram(programId: string): Promise<JellyfinProgram> {
  const response = await liveTvRequest(`/LiveTv/Programs/${encodeURIComponent(programId)}?${await userQuery({ fields: "PrimaryImageAspectRatio" })}`);
  return (await response.json()) as JellyfinProgram;
}
