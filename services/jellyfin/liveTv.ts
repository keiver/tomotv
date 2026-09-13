/**
 * Live TV through the on-device engine. The server opens the tuner stream: raw TS is read through
 * its own endpoint, an HLS manifest straight from the origin. It never transcodes a channel.
 */
import { JellyfinItem, JellyfinMediaSource, JellyfinProgram, JellyfinSeriesTimer, JellyfinTimer, JellyfinVideoItem } from "@/types/jellyfin";
import { engineCodecAllowlists } from "@/services/localRemux";
import { logger } from "@/utils/logger";
import { API_TIMEOUTS } from "./constants";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, getConfig, throwRequestError } from "./session";

const LIVE_BITRATE_CAP = 200_000_000;

/** Every codec the engine copies or decodes, declared as direct play on MPEG-TS. */
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
    TranscodingProfiles: [],
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

/** The server never marks a manifest direct play; its Path is the origin URL, untouched. */
function isManifestSource(source: JellyfinMediaSource): boolean {
  if (!source.Path || !/^https?$/i.test(source.Protocol ?? "")) return false;
  return source.Container === "hls" || /\.m3u8?(?:$|\?)/i.test(source.Path);
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
    EnableTranscoding: false,
    AutoOpenLiveStream: true,
    MaxStreamingBitrate: LIVE_BITRATE_CAP,
  };
  const [itemResponse, infoResponse] = await Promise.all([
    item ? null : fetchWithTimeout(`${config.server}/Items/${channelId}?userId=${config.userId}&EnableUserData=true`, { headers }, API_TIMEOUTS.NORMAL),
    fetchWithTimeout(`${config.server}/Items/${channelId}/PlaybackInfo?UserId=${config.userId}`, { method: "POST", headers, body: JSON.stringify(body) }, API_TIMEOUTS.NORMAL),
  ]);
  if (itemResponse && !itemResponse.ok) throwRequestError(itemResponse, `Failed to fetch channel: ${itemResponse.status}`);
  if (!infoResponse.ok) throwRequestError(infoResponse, `Failed to open channel: ${infoResponse.status}`);
  const channel: JellyfinVideoItem = item ?? (await itemResponse!.json());
  const info = await infoResponse.json();
  const source: JellyfinMediaSource | undefined = info.MediaSources?.[0];
  const raw = !!source?.Path && source.SupportsDirectPlay === true;
  const manifest = !!source && !raw && isManifestSource(source);
  if (!source?.Path || (!raw && !manifest)) {
    throw new Error(`The server did not open ${channel.Name} for direct play${info.ErrorCode ? ` (${info.ErrorCode})` : ""}`);
  }
  const liveStreamUrl = manifest ? source.Path : liveStreamUrlFor(config.server, config.apiKey, source.Path);
  logger.info("Live channel opened", {
    service: "LiveTv",
    channel: channel.Name,
    container: source.Container,
    origin: manifest ? "manifest" : "server",
    liveStreamId: source.LiveStreamId,
    streams: (source.MediaStreams ?? []).map((stream) => `${stream.Type}:${stream.Codec}`).join(","),
  });
  return {
    ...channel,
    MediaSources: info.MediaSources,
    MediaStreams: source.MediaStreams ?? [],
    PlaySessionId: info.PlaySessionId,
    LiveStreamId: source.LiveStreamId ?? undefined,
    liveStreamUrl,
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
