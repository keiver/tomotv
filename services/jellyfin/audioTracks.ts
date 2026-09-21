import type { JellyfinMediaStream, JellyfinVideoItem } from "@/types/jellyfin";

export interface AudioCatalogueTrack {
  identity: string;
  mediaSourceId: string;
  index: number;
  name: string;
  stream: JellyfinMediaStream;
}

export function playbackMediaStreams(videoItem: JellyfinVideoItem): JellyfinMediaStream[] {
  return videoItem.MediaStreams?.length ? videoItem.MediaStreams : (videoItem.MediaSources?.[0]?.MediaStreams ?? []);
}

export function audioCatalogue(videoItem: JellyfinVideoItem, preferredStreamIndex?: number): AudioCatalogueTrack[] {
  const mediaSourceId = videoItem.MediaSources?.[0]?.Id || videoItem.Id;
  const streams = playbackMediaStreams(videoItem).filter((stream) => stream.Type === "Audio");
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
    return { identity, mediaSourceId, index, name, stream };
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
