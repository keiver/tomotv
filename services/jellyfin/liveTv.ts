/**
 * Live TV through the on-device engine. The server opens the tuner stream and hands its raw
 * bytes over (SupportsDirectPlay); it never transcodes a channel for this client.
 */
import { JellyfinItem, JellyfinMediaSource, JellyfinVideoItem } from "@/types/jellyfin";
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

export async function fetchChannels(): Promise<{ items: JellyfinItem[]; total?: number }> {
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) throw new Error("Jellyfin server not configured.");
  const query = new URLSearchParams({
    userId: config.userId,
    addCurrentProgram: "true",
    enableUserData: "true",
    enableImages: "true",
    fields: "ChannelInfo,PrimaryImageAspectRatio",
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
  if (!source?.Path || !source.SupportsDirectPlay) {
    throw new Error(`The server did not open ${channel.Name} for direct play${info.ErrorCode ? ` (${info.ErrorCode})` : ""}`);
  }
  const liveStreamUrl = liveStreamUrlFor(config.server, config.apiKey, source.Path);
  logger.info("Live channel opened", {
    service: "LiveTv",
    channel: channel.Name,
    container: source.Container,
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
