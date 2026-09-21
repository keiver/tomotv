import type { JellyfinMediaStream, JellyfinVideoItem } from "@/types/jellyfin";

export interface AudioCatalogueTrack {
  identity: string;
  mediaSourceId: string;
  index: number;
  name: string;
  stream: JellyfinMediaStream;
  source: SourcePosition | null;
}

export interface SourcePosition {
  ordinal: number;
  count: number;
  codec: string;
}

// The four names Jellyfin rewrites (ProbeResultNormalizer.NormalizeSubtitleCodec); every other Codec is ffprobe's own.
const FFMPEG_SUBTITLE_CODECS: Record<string, string> = { dvbsub: "dvb_subtitle", dvbtxt: "dvb_teletext", dvdsub: "dvd_subtitle", pgssub: "hdmv_pgs_subtitle" };

/**
 * Where an embedded stream sits in its container: the nth of its Type, of how many, and its FFmpeg codec name.
 * Jellyfin's Index is an identity, not a file position: 12.0 lists sidecars first and renumbers.
 */
export function sourcePosition(streams: JellyfinMediaStream[], stream: JellyfinMediaStream): SourcePosition | null {
  if (stream.IsExternal === true || !stream.Codec) return null;
  const embedded = streams.filter((candidate) => candidate.Type === stream.Type && candidate.IsExternal !== true).sort((left, right) => (left.Index ?? 0) - (right.Index ?? 0));
  const ordinal = embedded.indexOf(stream);
  if (ordinal < 0) return null;
  const codec = stream.Codec.toLowerCase();
  return { ordinal, count: embedded.length, codec: FFMPEG_SUBTITLE_CODECS[codec] ?? codec };
}

export function playbackMediaStreams(videoItem: JellyfinVideoItem): JellyfinMediaStream[] {
  return videoItem.MediaStreams?.length ? videoItem.MediaStreams : (videoItem.MediaSources?.[0]?.MediaStreams ?? []);
}

export function audioCatalogue(videoItem: JellyfinVideoItem, preferredStreamIndex?: number): AudioCatalogueTrack[] {
  const mediaSourceId = videoItem.MediaSources?.[0]?.Id || videoItem.Id;
  const mediaStreams = playbackMediaStreams(videoItem);
  const streams = mediaStreams.filter((stream) => stream.Type === "Audio");
  const identities = new Set<string>();
  const tracks = streams.map((stream) => {
    const index = stream.Index;
    if (index === undefined || !Number.isInteger(index) || index < 0 || index > 2_147_483_647) {
      throw new Error(`Audio track is missing a valid Jellyfin stream index for media source ${mediaSourceId}`);
    }
    const identity = `${mediaSourceId}:${index}`;
    if (identities.has(identity)) throw new Error(`Duplicate audio track identity ${identity}`);
    identities.add(identity);
    const name = (stream.DisplayTitle || stream.Language || `Audio ${index}`).replace(/["\r\n]/g, "").trim() || `Audio ${index}`;
    return { identity, mediaSourceId, index, name, stream, source: sourcePosition(mediaStreams, stream) };
  });
  const labelCounts = new Map<string, number>();
  for (const track of tracks) labelCounts.set(track.name, (labelCounts.get(track.name) ?? 0) + 1);
  const usedNames = new Set(tracks.filter((track) => labelCounts.get(track.name) === 1).map((track) => track.name));
  for (const track of tracks) {
    if (labelCounts.get(track.name) === 1) continue;
    let name = `${track.name} (${track.index})`;
    while (usedNames.has(name)) name += ` (${track.index})`;
    track.name = name;
    usedNames.add(name);
  }
  return tracks.sort(
    (left, right) => Number(right.index === preferredStreamIndex) - Number(left.index === preferredStreamIndex) || Number(right.stream.IsDefault === true) - Number(left.stream.IsDefault === true),
  );
}
