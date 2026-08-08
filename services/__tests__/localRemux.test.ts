import { canRemuxLocally, isLocalRemuxAvailable, startLocalRemux } from "../localRemux";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const mockStartRemux = jest.fn();
const mockIsAV1Supported = jest.fn();

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  NativeModules: {
    LocalRemuxer: {
      startRemux: (...args: unknown[]) => mockStartRemux(...args),
      stopRemux: jest.fn(),
      isAV1HardwareDecodeSupported: () => mockIsAV1Supported(),
    },
  },
}));

jest.mock("@/services/jellyfinApi", () => ({
  getVideoStreamUrl: (id: string) => `http://server:8096/Videos/${id}/stream?Static=true&ApiKey=k`,
  getSubtitleUrl: (id: string, index: number) => `http://server:8096/Videos/${id}/Subtitles/${index}/Stream.vtt`,
  isImageBasedSubtitleCodec: (codec?: string) => ["pgssub", "dvdsub"].includes(codec ?? ""),
  JELLYFIN_TIME: { TICKS_PER_SECOND: 10000000 },
}));

const HOUR_IN_TICKS = 36000000000;

/** Item shaped like Jellyfin's PlaybackInfo response, with just the fields the engine reads. */
function item(overrides: Partial<JellyfinVideoItem> & { streams?: any[] } = {}): JellyfinVideoItem {
  const { streams, ...rest } = overrides;
  return {
    Id: "item1",
    Name: "Test",
    RunTimeTicks: HOUR_IN_TICKS,
    MediaSources: [{ Id: "item1", Container: "mkv" }],
    MediaStreams: streams ?? [
      { Type: "Video", Codec: "h264", Index: 0 },
      { Type: "Audio", Codec: "aac", Index: 1 },
    ],
    ...rest,
  } as JellyfinVideoItem;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsAV1Supported.mockResolvedValue(false);
  mockStartRemux.mockResolvedValue("http://127.0.0.1:5000/token/master.m3u8");
});

describe("isLocalRemuxAvailable", () => {
  it("is available when the native module is present on iOS", () => {
    expect(isLocalRemuxAvailable()).toBe(true);
  });
});

describe("canRemuxLocally", () => {
  it("accepts H.264 in MKV with a single audio track", async () => {
    await expect(canRemuxLocally(item(), false)).resolves.toBe(true);
  });

  it("accepts HEVC", async () => {
    const hevc = item({
      streams: [
        { Type: "Video", Codec: "hevc", Index: 0 },
        { Type: "Audio", Codec: "aac", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(hevc, false)).resolves.toBe(true);
  });

  // Codecs AVPlayer cannot decode are transcoded to H.264 on device, gated by
  // resolution (measured Apple TV headroom), bit depth (h264_videotoolbox is
  // 8-bit only, no swscale linked) and interlacing (no deinterlacer linked).
  it.each(["vp8", "vp9", "vp7", "mpeg1video", "mpeg2video", "mpeg4", "wmv3", "vc1", "h263", "flv1", "rv40", "vp6f", "svq3"])(
    "accepts %s at 1080p-class resolution for on-device transcode",
    async (videoCodec) => {
      const exotic = item({
        streams: [
          { Type: "Video", Codec: videoCodec, Index: 0, Width: 1920, Height: 1080, BitDepth: 8 },
          { Type: "Audio", Codec: "aac", Index: 1 },
        ],
      });
      await expect(canRemuxLocally(exotic, false)).resolves.toBe(true);
    },
  );

  it("rejects transcodable codecs above the pixel gate (4K VP9)", async () => {
    const fourK = item({
      streams: [
        { Type: "Video", Codec: "vp9", Index: 0, Width: 3840, Height: 2160, BitDepth: 8 },
        { Type: "Audio", Codec: "opus", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(fourK, false)).resolves.toBe(false);
  });

  it("rejects 10-bit transcodable sources, since the encoder is 8-bit only", async () => {
    const tenBit = item({
      streams: [
        { Type: "Video", Codec: "vp9", Index: 0, Width: 1920, Height: 804, BitDepth: 10 },
        { Type: "Audio", Codec: "opus", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(tenBit, false)).resolves.toBe(false);
  });

  it("rejects interlaced transcodable sources, which need the server's deinterlacer", async () => {
    const interlaced = item({
      streams: [
        { Type: "Video", Codec: "mpeg2video", Index: 0, Width: 720, Height: 576, IsInterlaced: true },
        { Type: "Audio", Codec: "mp2", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(interlaced, false)).resolves.toBe(false);
  });

  it("rejects transcodable codecs with unknown dimensions, since the pixel gate cannot run", async () => {
    const sizeless = item({
      streams: [
        { Type: "Video", Codec: "vp9", Index: 0 },
        { Type: "Audio", Codec: "opus", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(sizeless, false)).resolves.toBe(false);
  });

  // theora was never built; msmpeg4v3 (DivX 3) is in the archive as a wmv1/2
  // dependency but is NOT registered, so avcodec_find_decoder returns NULL —
  // registry truth (av_codec_iterate), not symbol presence, decides this list.
  it.each(["theora", "msmpeg4v3", "div3"])("rejects codecs with no registered decoder (%s)", async (videoCodec) => {
    const undecodable = item({
      streams: [
        { Type: "Video", Codec: videoCodec, Index: 0, Width: 854, Height: 480 },
        { Type: "Audio", Codec: "mp3", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(undecodable, false)).resolves.toBe(false);
  });

  // Audio with no decoder in the linked FFmpeg build cannot be carried at all.
  it.each(["ralf", "qdm2", "sipr", "atrac3"])("rejects %s audio, which has no decoder", async (audioCodec) => {
    const uncarriableAudio = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: audioCodec, Index: 1 },
      ],
    });
    await expect(canRemuxLocally(uncarriableAudio, false)).resolves.toBe(false);
  });

  // aac/alac/mp3 are copied verbatim; the rest are decoded and re-encoded to
  // AAC on device, which is what makes AC3/DTS/TrueHD files playable locally.
  // mp2/wma/cook ride along with MPEG-2, WMV and RealMedia video.
  it.each(["aac", "alac", "mp3", "ac3", "eac3", "dts", "truehd", "opus", "vorbis", "flac", "mp2", "wmav2", "wmapro", "cook", "amrnb"])("accepts %s audio", async (audioCodec) => {
    const carriableAudio = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: audioCodec, Index: 1 },
      ],
    });
    await expect(canRemuxLocally(carriableAudio, false)).resolves.toBe(true);
  });

  // Each extra track becomes its own HLS audio rendition, so multi-track files
  // switch audio locally and still cost the server nothing.
  it("accepts multi-audio files", async () => {
    const multi = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: "aac", Index: 1 },
        { Type: "Audio", Codec: "ac3", Index: 2 },
      ],
    });
    await expect(canRemuxLocally(multi, false)).resolves.toBe(true);
  });

  it("rejects multi-audio when any track has no decoder", async () => {
    const multi = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: "aac", Index: 1 },
        { Type: "Audio", Codec: "qdm2", Index: 2 },
      ],
    });
    await expect(canRemuxLocally(multi, false)).resolves.toBe(false);
  });

  it("rejects files needing burned-in subtitles", async () => {
    await expect(canRemuxLocally(item(), true)).resolves.toBe(false);
  });

  it("rejects items with no usable runtime, since the playlist needs a duration", async () => {
    await expect(canRemuxLocally(item({ RunTimeTicks: 0 }), false)).resolves.toBe(false);
  });

  it("gates AV1 on hardware decode support", async () => {
    const av1 = item({
      streams: [
        { Type: "Video", Codec: "av1", Index: 0 },
        { Type: "Audio", Codec: "aac", Index: 1 },
      ],
    });

    mockIsAV1Supported.mockResolvedValue(true);
    await expect(canRemuxLocally(av1, false)).resolves.toBe(true);
  });
});

describe("startLocalRemux", () => {
  it("passes the static stream URL, audio index and duration to the native module", async () => {
    const url = await startLocalRemux(item());

    expect(url).toBe("http://127.0.0.1:5000/token/master.m3u8");
    expect(mockStartRemux).toHaveBeenCalledWith(
      expect.objectContaining({
        inputUrl: "http://server:8096/Videos/item1/stream?Static=true&ApiKey=k",
        audioTracks: [expect.objectContaining({ index: 1 })],
        durationSeconds: 3600,
      }),
    );
  });

  it("puts the default audio track first, since that one is muxed with the video", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Audio", Codec: "aac", Index: 1, Language: "eng", DisplayTitle: "Commentary" },
          { Type: "Audio", Codec: "ac3", Index: 2, Language: "spa", DisplayTitle: "Spanish", IsDefault: true },
        ],
      }),
    );

    const { audioTracks } = mockStartRemux.mock.calls[0][0];
    expect(audioTracks.map((t: { index: number }) => t.index)).toEqual([2, 1]);
    expect(audioTracks[0]).toMatchObject({ language: "spa", name: "Spanish", isDefault: true });
  });

  it("forwards text subtitles as renditions and drops image-based ones", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Audio", Codec: "aac", Index: 1 },
          { Type: "Subtitle", Codec: "subrip", Index: 2, Language: "eng", DisplayTitle: "English" },
          { Type: "Subtitle", Codec: "pgssub", Index: 3, Language: "spa" },
        ],
      }),
    );

    const { subtitles } = mockStartRemux.mock.calls[0][0];
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0]).toMatchObject({ index: 2, language: "eng", name: "English" });
  });

  it("carries IsForced through so the rendition can be marked FORCED=YES", async () => {
    // Forced tracks used to burn into the picture. As renditions they only
    // present themselves if the flag reaches the master playlist.
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Audio", Codec: "aac", Index: 1 },
          { Type: "Subtitle", Codec: "subrip", Index: 2, Language: "eng", IsForced: true },
          { Type: "Subtitle", Codec: "subrip", Index: 3, Language: "eng", IsDefault: true },
        ],
      }),
    );

    const { subtitles } = mockStartRemux.mock.calls[0][0];
    expect(subtitles).toEqual([expect.objectContaining({ index: 2, isForced: true, isDefault: false }), expect.objectContaining({ index: 3, isForced: false, isDefault: true })]);
  });
});
