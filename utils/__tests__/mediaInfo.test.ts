import { JellyfinMediaStream } from "@/types/jellyfin";
import { formatBitrate, formatFileSize, joinMeta, streamDetailLine } from "../mediaInfo";

describe("formatFileSize", () => {
  it("formats gigabytes with two decimals", () => {
    expect(formatFileSize(1847765580)).toBe("1.72 GB");
  });

  it("formats sub-GB sizes as whole megabytes", () => {
    expect(formatFileSize(830 * 1024 ** 2)).toBe("830 MB");
  });

  it("returns empty for absent or zero", () => {
    expect(formatFileSize(undefined)).toBe("");
    expect(formatFileSize(0)).toBe("");
  });
});

describe("formatBitrate", () => {
  it("formats Mbps with one decimal", () => {
    expect(formatBitrate(1632744)).toBe("1.6 Mbps");
  });

  it("formats sub-Mbps as whole kbps", () => {
    expect(formatBitrate(627980)).toBe("628 kbps");
  });

  it("returns empty for absent", () => {
    expect(formatBitrate(undefined)).toBe("");
  });
});

describe("joinMeta", () => {
  it("drops falsy parts and joins with the dot separator", () => {
    expect(joinMeta(["1989", "", undefined, false, "PG-13"])).toBe("1989 · PG-13");
  });
});

describe("streamDetailLine", () => {
  it("builds the video line with HDR and bit depth, omitting SDR", () => {
    const hdr: JellyfinMediaStream = {
      Codec: "hevc",
      Type: "Video",
      Profile: "Main 10",
      Width: 3840,
      Height: 1600,
      RealFrameRate: 23.976025,
      VideoRangeType: "HDR10",
      BitDepth: 10,
    };
    expect(streamDetailLine(hdr)).toBe("HEVC · Main 10 · 3840×1600 · 23.976 fps · HDR10 · 10-bit");
    expect(streamDetailLine({ ...hdr, VideoRangeType: "SDR", BitDepth: 8 })).toBe("HEVC · Main 10 · 3840×1600 · 23.976 fps · 8-bit");
  });

  it("builds the audio line from layout, sample rate and language", () => {
    const flac: JellyfinMediaStream = {
      Codec: "flac",
      Type: "Audio",
      ChannelLayout: "5.1",
      SampleRate: 48000,
      BitDepth: 24,
      BitRate: 627980,
      Language: "eng",
    };
    expect(streamDetailLine(flac)).toBe("FLAC · 5.1 · 48 kHz · 24-bit · 628 kbps · eng");
  });

  it("falls back to a channel count when the layout is absent", () => {
    expect(streamDetailLine({ Codec: "aac", Type: "Audio", Channels: 2 })).toBe("AAC · 2ch");
  });

  it("marks forced and external subtitle tracks", () => {
    expect(streamDetailLine({ Codec: "PGSSUB", Type: "Subtitle", Language: "eng", IsForced: true })).toBe("PGSSUB · eng · Forced");
    expect(streamDetailLine({ Codec: "subrip", Type: "Subtitle", IsExternal: true })).toBe("SUBRIP · External");
  });
});
