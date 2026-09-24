/**
 * The order getAudioTracks hands the native side, which orderAudioTracks then mirrors into the
 * position → stream mapping. A mismatch between the two maps the next switch to the wrong stream.
 */
import { getAudioTracks } from "@/services/multiAudioLoader";
import { orderAudioTracks } from "../videoPlayback/audioTracks";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const item = (streams: JellyfinVideoItem["MediaStreams"]): JellyfinVideoItem => ({ Id: "item", Name: "Item", MediaStreams: streams }) as JellyfinVideoItem;

const audio = (index: number, language: string, isDefault = false) =>
  ({ Index: index, Type: "Audio", Language: language, Codec: "aac", Channels: 2, DisplayTitle: `${language.toUpperCase()} (AAC Stereo)`, IsDefault: isDefault }) as NonNullable<
    JellyfinVideoItem["MediaStreams"]
  >[number];

describe("audio track ordering", () => {
  it("sorts on Jellyfin's IsDefault flag, not on the stream index", () => {
    // Stream 1 is UND and flagged default; stream 8 is English and is not.
    const tracks = getAudioTracks(item([audio(1, "und", true), audio(8, "eng")]));

    expect(tracks.map((t) => t.Index)).toEqual([1, 8]);
    expect(orderAudioTracks(tracks, null)).toEqual([1, 8]);
  });

  it("puts the track an engine rebuild must keep at position 0", () => {
    const tracks = getAudioTracks(item([audio(1, "und", true), audio(8, "eng")]));

    expect(orderAudioTracks(tracks, 8)).toEqual([8, 1]);
  });

  it("maps a single track", () => {
    expect(orderAudioTracks(getAudioTracks(item([audio(1, "eng", true)])), null)).toEqual([1]);
  });

  it("maps nothing for a silent item", () => {
    expect(orderAudioTracks(getAudioTracks(item([])), null)).toEqual([]);
  });
});
