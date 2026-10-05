/**
 * A converted download's rung and the item facts stored for it. The stored item is what every
 * playback gate reads once the file is held, so it has to describe the MP4 that landed and not
 * the source the server started from.
 */

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { needsTranscoding } from "@/services/jellyfin/media";
import { getTextSubtitleStreams } from "@/services/jellyfin/subtitles";
import { CONVERT_AUDIO_BITRATE, conversionAudioIndex, convertedItem, downloadRungs, estimatedConvertedBytes } from "@/services/downloads/convert";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const RUNG = { label: "1080p", bitrate: 8000000, width: 1920, height: 1080 };

const SOURCE = {
  Id: "a",
  Name: "Dweebs",
  Type: "Movie",
  Container: "webm",
  RunTimeTicks: 600 * 10_000_000,
  MediaSources: [{ Id: "src", Container: "webm", Size: 147627996, Bitrate: 19700000 }],
  MediaStreams: [
    { Index: 0, Type: "Video", Codec: "vp9", Width: 7680, Height: 4320, BitDepth: 10, VideoRange: "HDR", VideoRangeType: "HDR10", Profile: "Profile 0", Level: 62, RealFrameRate: 24 },
    { Index: 1, Type: "Audio", Codec: "opus", Channels: 6, ChannelLayout: "5.1", SampleRate: 48000, Language: "eng" },
    { Index: 2, Type: "Audio", Codec: "flac", Channels: 2, Language: "spa", IsDefault: true },
    { Index: 3, Type: "Subtitle", Codec: "subrip", Language: "eng" },
    { Index: 4, Type: "Subtitle", Codec: "PGSSUB", Language: "eng" },
    { Index: 5, Type: "Subtitle", Codec: "webvtt", Language: "spa", IsExternal: true },
  ],
} as unknown as JellyfinVideoItem;

/** A source at the given height and video bitrate. */
const videoAt = (height: number, bitrate?: number): JellyfinVideoItem =>
  ({
    Id: "v",
    MediaSources: [{ Id: "s" }],
    MediaStreams: [{ Index: 0, Type: "Video", Codec: "h264", Width: Math.round((height * 16) / 9), Height: height, BitRate: bitrate }],
  }) as unknown as JellyfinVideoItem;

describe("downloadRungs", () => {
  it("offers every rung under an 8K source, largest first", () => {
    expect(downloadRungs(SOURCE).map((rung) => rung.label)).toEqual(["1080p", "720p", "480p"]);
  });

  // Jellyfin stream-copies video whose bitrate already sits under the request, so a rung at or
  // above the source's video bitrate would land the same picture and is not a smaller file.
  it("offers only rungs under the source's own video bitrate", () => {
    expect(downloadRungs(videoAt(1080, 6_000_000)).map((rung) => rung.label)).toEqual(["720p", "480p"]);
    expect(downloadRungs(videoAt(1080, 25_000_000)).map((rung) => rung.label)).toEqual(["1080p", "720p", "480p"]);
    expect(downloadRungs(videoAt(720, 1_000_000))).toEqual([]);
  });

  // A scope film cropped to 1920x1040 is 1080p: the rung is judged by the box, either side.
  it("offers 1080p for a letterboxed 1920x1040 film", () => {
    const letterboxed = { ...videoAt(1040, 5_251_115), MediaStreams: [{ Index: 0, Type: "Video", Codec: "hevc", Width: 1920, Height: 1040, BitRate: 25_000_000 }] } as unknown as JellyfinVideoItem;
    expect(downloadRungs(letterboxed).map((rung) => rung.label)).toEqual(["1080p", "720p", "480p"]);
  });

  it("offers nothing to shrink an audio track or an unknown-height video", () => {
    expect(downloadRungs({ Id: "a", MediaStreams: [{ Index: 0, Type: "Audio", Codec: "flac" }] } as unknown as JellyfinVideoItem)).toEqual([]);
    expect(downloadRungs(videoAt(0))).toEqual([]);
  });

  it("always offers the lowest rung when the original cannot be kept", () => {
    expect(downloadRungs(videoAt(720, 1_000_000), false).map((rung) => rung.label)).toEqual(["720p", "480p"]);
    expect(downloadRungs(videoAt(360), false).map((rung) => rung.label)).toEqual(["480p"]);
  });
});

describe("convertedItem", () => {
  const converted = convertedItem(SOURCE, RUNG);
  const video = converted.MediaStreams?.find((stream) => stream.Type === "Video");
  const audio = converted.MediaStreams?.filter((stream) => stream.Type === "Audio") ?? [];

  it("describes an H.264 stream fitted into the rung, with no invented profile or HDR", () => {
    expect(video).toMatchObject({ Index: 0, Codec: "h264", Width: 1920, Height: 1080, BitDepth: 8, VideoRange: "SDR", VideoRangeType: "SDR", RealFrameRate: 24 });
    expect(video?.Profile).toBeUndefined();
    expect(video?.Level).toBeUndefined();
  });

  it("keeps the aspect of a source that is not 16:9, and never scales up", () => {
    const tall = convertedItem({ ...SOURCE, MediaStreams: [{ Index: 0, Type: "Video", Codec: "theora", Width: 2560, Height: 1920 }] } as never, RUNG);
    expect(tall.MediaStreams?.[0]).toMatchObject({ Width: 1440, Height: 1080 });
    const small = convertedItem({ ...SOURCE, MediaStreams: [{ Index: 0, Type: "Video", Codec: "theora", Width: 640, Height: 480 }] } as never, RUNG);
    expect(small.MediaStreams?.[0]).toMatchObject({ Width: 640, Height: 480 });
  });

  it("carries the default audio track alone, as AAC at its channel count capped at two", () => {
    expect(conversionAudioIndex(SOURCE)).toBe(2);
    expect(audio).toHaveLength(1);
    expect(audio[0]).toMatchObject({ Index: 2, Codec: "aac", Channels: 2, ChannelLayout: "stereo", Language: "spa", IsDefault: true, BitRate: CONVERT_AUDIO_BITRATE });
    const mono = convertedItem({ ...SOURCE, MediaStreams: [{ Index: 1, Type: "Audio", Codec: "aac", Channels: 1 }] } as never, RUNG);
    expect(mono.MediaStreams?.[0]).toMatchObject({ Channels: 1, ChannelLayout: "mono" });
  });

  it("keeps text subtitle streams by source index for the sidecars and drops image ones", () => {
    expect(getTextSubtitleStreams(converted).map((stream) => stream.Index)).toEqual([3, 5]);
    expect(converted.MediaStreams?.some((stream) => stream.Codec === "PGSSUB")).toBe(false);
  });

  it("is an mp4 of unknown size, which direct play opens as it stands", () => {
    expect(converted.Container).toBe("mp4");
    expect(converted.MediaSources?.[0]).toMatchObject({ Id: "src", Container: "mp4", Bitrate: RUNG.bitrate + CONVERT_AUDIO_BITRATE });
    expect(converted.MediaSources?.[0]?.Size).toBeUndefined();
    expect(needsTranscoding(converted)).toBe(false);
  });

  it("leaves the source untouched", () => {
    expect(SOURCE.MediaStreams?.[0]?.Codec).toBe("vp9");
    expect(SOURCE.MediaSources?.[0]?.Container).toBe("webm");
  });
});

describe("estimatedConvertedBytes", () => {
  it("is the rung's bits over the runtime", () => {
    expect(estimatedConvertedBytes(SOURCE, RUNG)).toBe(((8000000 + CONVERT_AUDIO_BITRATE) * 600) / 8);
  });

  it("admits an unknown runtime as zero", () => {
    expect(estimatedConvertedBytes({ ...SOURCE, RunTimeTicks: 0 } as never, RUNG)).toBe(0);
  });
});
