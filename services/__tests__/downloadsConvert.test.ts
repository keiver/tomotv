/**
 * A converted download's rung and the item facts stored for it. The stored item is what every
 * playback gate reads once the file is held, so it has to describe the MP4 that landed and not
 * the source the server started from.
 */

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/jellyfin/session", () => ({ getQualitySettings: jest.fn() }));

import { QUALITY_PRESETS } from "@/services/jellyfin/constants";
import { needsTranscoding } from "@/services/jellyfin/media";
import { getQualitySettings } from "@/services/jellyfin/session";
import { getTextSubtitleStreams } from "@/services/jellyfin/subtitles";
import { CONVERT_AUDIO_BITRATE, conversionAudioIndex, conversionRung, convertedItem, estimatedConvertedBytes } from "@/services/downloads/convert";
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

describe("conversionRung", () => {
  it("uses the pinned preset", async () => {
    (getQualitySettings as jest.Mock).mockResolvedValue({ ...QUALITY_PRESETS[2], index: 2, mode: "fixed" });
    expect(await conversionRung()).toEqual({ label: "720p", bitrate: 4000000, width: 1280, height: 720 });
  });

  it("lands Auto on 1080p, since a file has no link to adapt to", async () => {
    (getQualitySettings as jest.Mock).mockResolvedValue({ ...QUALITY_PRESETS[5], index: 5, mode: "auto" });
    expect(await conversionRung()).toEqual(RUNG);
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
