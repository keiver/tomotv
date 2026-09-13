/**
 * Live TV through the on-device engine. The server opens the tuner stream: raw TS is read through
 * its own endpoint, an HLS manifest straight from the origin. The server's own HLS transcode of
 * the channel is carried along as the rung below the engine.
 */
import { JellyfinItem, JellyfinMediaSource, JellyfinProgram, JellyfinSeriesTimer, JellyfinTimer, JellyfinVideoItem } from "@/types/jellyfin";
import { engineCodecAllowlists } from "@/services/localRemux";
import { setPlaybackStage } from "@/services/playbackStage";
import { logger } from "@/utils/logger";
import { API_TIMEOUTS } from "./constants";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, getConfig, throwRequestError } from "./session";

const LIVE_BITRATE_CAP = 200_000_000;

/**
 * Every codec the engine copies or decodes, declared as direct play on MPEG-TS. The one transcoding
 * profile is what the server answers with a TranscodingUrl: live HLS is TS-only on Jellyfin (an fMP4
 * profile is ignored and the reply degrades to a progressive stream), and AVPlayer plays HEVC in TS.
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

/** Streams warmed for a flip: the server keeps an opened live stream and re-opens it instantly. */
const warmedAt = new Map<string, number>();
const warming = new Set<string>();
const WARM_TTL_MS = 120_000;
/** The warm opens' stream ids by channel: each is one consumer the server counts until it is closed. */
const warmedStreams = new Map<string, string>();
/** Warms still opening when their owner left: closed the moment they land instead of kept. */
const discardOnArrival = new Set<string>();

/**
 * Open a channel's stream on the server ahead of a flip: a cold open costs the server an ffprobe
 * of the origin (measured 11.8s), a warm one 0.0s. The open is held until closeWarmedChannels.
 */
export async function warmChannel(channelId: string): Promise<void> {
  if (warming.has(channelId)) {
    discardOnArrival.delete(channelId);
    return;
  }
  const last = warmedAt.get(channelId);
  if (warmedStreams.has(channelId) || (last !== undefined && Date.now() - last < WARM_TTL_MS)) return;
  warming.add(channelId);
  discardOnArrival.delete(channelId);
  try {
    const config = await getConfig();
    if (!config.server || !config.apiKey || !config.userId) return;
    const headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) };
    const body = {
      UserId: config.userId,
      DeviceProfile: liveDeviceProfile(),
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AutoOpenLiveStream: true,
      MaxStreamingBitrate: LIVE_BITRATE_CAP,
    };
    const response = await fetchWithTimeout(`${config.server}/Items/${channelId}/PlaybackInfo?UserId=${config.userId}`, { method: "POST", headers, body: JSON.stringify(body) }, API_TIMEOUTS.EXTENDED);
    if (!response.ok) return;
    warmedAt.set(channelId, Date.now());
    const info = await response.json();
    const liveStreamId: string | undefined = info.MediaSources?.[0]?.LiveStreamId;
    if (!liveStreamId) return;
    if (discardOnArrival.delete(channelId)) {
      warmedAt.delete(channelId);
      await closeLiveStream(liveStreamId);
      return;
    }
    warmedStreams.set(channelId, liveStreamId);
  } catch (error) {
    logger.debug("Channel warm-up failed", { service: "LiveTv", channelId, error: String(error) });
  } finally {
    warming.delete(channelId);
  }
}

/** Close every warm open except the channels named; a closed channel warms again on the next ask. */
export async function closeWarmedChannels(keep: Iterable<string> = []): Promise<void> {
  const kept = new Set(keep);
  for (const channelId of warming) if (!kept.has(channelId)) discardOnArrival.add(channelId);
  for (const [channelId, liveStreamId] of [...warmedStreams]) {
    if (kept.has(channelId)) continue;

    warmedStreams.delete(channelId);
    warmedAt.delete(channelId);
    await closeLiveStream(liveStreamId);
  }
}

/** One page of channels in the server's channel order; the whole list when no page is asked for. */
export async function fetchChannels(page: { startIndex?: number; limit?: number } = {}): Promise<{ items: JellyfinItem[]; total?: number }> {
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
 * Open a channel's live stream and describe it as a playable item: the raw tuner bytes,
 * every stream the server probed, and the ids the reports and the close need.
 */
export async function openChannel(channelId: string, item?: JellyfinVideoItem): Promise<JellyfinVideoItem> {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) };
  const body = {
    UserId: config.userId,
    DeviceProfile: liveDeviceProfile(),
    EnableDirectPlay: true,
    EnableDirectStream: true,
    EnableTranscoding: true,
    AutoOpenLiveStream: true,
    MaxStreamingBitrate: LIVE_BITRATE_CAP,
  };
  // The open probes the origin on the server (measured 11.8s cold), longer than a normal call.
  setPlaybackStage("opening");
  const [itemResponse, infoResponse] = await Promise.all([
    item ? null : fetchWithTimeout(`${config.server}/Items/${channelId}?userId=${config.userId}&EnableUserData=true`, { headers }, API_TIMEOUTS.NORMAL),
    fetchWithTimeout(`${config.server}/Items/${channelId}/PlaybackInfo?UserId=${config.userId}`, { method: "POST", headers, body: JSON.stringify(body) }, API_TIMEOUTS.EXTENDED),
  ]);
  if (itemResponse && !itemResponse.ok) throwRequestError(itemResponse, `Failed to fetch channel: ${itemResponse.status}`);
  if (!infoResponse.ok) throwRequestError(infoResponse, `Failed to open channel: ${infoResponse.status}`);
  const channel: JellyfinVideoItem = item ?? (await itemResponse!.json());
  const info = await infoResponse.json();
  const source: JellyfinMediaSource | undefined = info.MediaSources?.[0];
  const raw = !!source?.Path && source.SupportsDirectPlay === true;
  const manifest = !!source && !raw && isManifestSource(source);
  // The server's transcode URL already carries the session, the live stream and the token.
  const liveTranscodeUrl = source?.SupportsTranscoding && source.TranscodingUrl ? `${config.server}${source.TranscodingUrl}` : undefined;
  const engineInput = !!source?.Path && (raw || manifest);
  if (!source || (!engineInput && !liveTranscodeUrl)) {
    throw new Error(`The server did not open ${channel.Name}${info.ErrorCode ? ` (${info.ErrorCode})` : ""}`);
  }
  let liveStreamUrl: string | undefined;
  try {
    liveStreamUrl = !engineInput ? undefined : manifest ? await originVariantUrl(source.Path!, source.RequiredHttpHeaders) : liveStreamUrlFor(config.server, config.apiKey, source.Path!);
  } catch (error) {
    // The server holds the tuner for an open nobody will play.
    void closeLiveStream(source.LiveStreamId);
    throw error;
  }
  warmedAt.set(channelId, Date.now());
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
  };
}

/** Release the tuner; the server holds it for every open that never closes. */
export async function closeLiveStream(liveStreamId: string | null | undefined): Promise<void> {
  if (!liveStreamId) return;
  try {
    const config = await getConfig();
    if (!config.server || !config.apiKey) return;
    const response = await fetchWithTimeout(
      `${config.server}/LiveStreams/Close?liveStreamId=${encodeURIComponent(liveStreamId)}`,
      { method: "POST", headers: { Authorization: getAuthHeader(config.deviceId, config.apiKey) } },
      API_TIMEOUTS.SHORT,
    );
    if (!response.ok) logger.warn("Live stream close refused", { service: "LiveTv", status: response.status, liveStreamId });
  } catch (error) {
    logger.warn("Live stream close failed", error, { service: "LiveTv", liveStreamId });
  }
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

/** Every program overlapping the window, by start time; no images, no user data. */
export async function fetchGuidePrograms({ channelIds, startMs, endMs }: GuideWindow): Promise<JellyfinProgram[]> {
  const config = await getConfig();
  const body = {
    UserId: config.userId,
    ChannelIds: channelIds.length > 0 ? channelIds : undefined,
    MinEndDate: new Date(startMs).toISOString(),
    MaxStartDate: new Date(endMs).toISOString(),
    SortBy: ["StartDate"],
    EnableImages: false,
    EnableUserData: false,
    EnableTotalRecordCount: false,
    Fields: ["ChannelInfo"],
  };
  const response = await liveTvRequest("/LiveTv/Programs", { method: "POST", body: JSON.stringify(body) }, API_TIMEOUTS.EXTENDED);
  const json = await response.json();
  return (json.Items ?? []) as JellyfinProgram[];
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
export async function fetchTimerDefaults(programId: string): Promise<JellyfinSeriesTimer> {
  const response = await liveTvRequest(`/LiveTv/Timers/Defaults?programId=${encodeURIComponent(programId)}`);
  return (await response.json()) as JellyfinSeriesTimer;
}

export async function createTimer(defaults: JellyfinSeriesTimer): Promise<void> {
  await liveTvRequest("/LiveTv/Timers", { method: "POST", body: JSON.stringify(defaults) });
}

export async function createSeriesTimer(defaults: JellyfinSeriesTimer): Promise<void> {
  await liveTvRequest("/LiveTv/SeriesTimers", { method: "POST", body: JSON.stringify(defaults) });
}

export async function cancelTimer(timerId: string): Promise<void> {
  await liveTvRequest(`/LiveTv/Timers/${encodeURIComponent(timerId)}`, { method: "DELETE" });
}

export async function cancelSeriesTimer(seriesTimerId: string): Promise<void> {
  await liveTvRequest(`/LiveTv/SeriesTimers/${encodeURIComponent(seriesTimerId)}`, { method: "DELETE" });
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
