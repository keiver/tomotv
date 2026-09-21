import {
  belowRealtime,
  readBound,
  canRemuxLocally,
  dolbyVisionSupplementalCodecs,
  engineInputMissing,
  engineProgress,
  engineStarving,
  imagesAt,
  isLocalRemuxAvailable,
  localRemuxToken,
  offeredTierRungs,
  offeredTierBandwidths,
  predictPlaybackLane,
  resolveSubtitlePick,
  slipstreamTierBandwidth,
  slipstreamInputBandwidth,
  sourceBandwidthForItem,
  startLocalRemux,
  stopLocalRemux,
  subscribeEngineFailure,
  subscribeEngineLink,
  subscribeEngineTier,
  subtitleRenditions,
  videoCodecTag,
  type ImageSubtitleEvent,
  type ThroughputSample,
} from "../localRemux";
import type { VideoDecodeSupport } from "@/constants/codecs";
import type { JellyfinMediaStream, JellyfinVideoItem } from "@/types/jellyfin";
import { getAudioTracks } from "../multiAudioLoader";
import { getCachedConfig } from "@/services/jellyfin/session";

const mockStartRemux = jest.fn();
const mockStopRemux = jest.fn();
const mockEngineProgress = jest.fn();
/** DeviceDecode.summary() as an Apple TV 4K answers it: HEVC to Main 10, no AV1 silicon. */
const mockDecodeSupport = jest.fn();
/** Native event name -> handler, captured from the NativeEventEmitter mock. */
const mockListeners = new Map<string, (payload: unknown) => void>();
/** The events the mocked binary declares; a shorter list is an older build. */
const mockNativeEvents: string[] = ["onEnginePlan", "onEngineThroughput", "onEngineTier", "onEngineFailed", "onEngineLink"];

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  NativeModules: {
    LocalRemuxer: {
      startRemux: (...args: unknown[]) => mockStartRemux(...args),
      stopRemux: (...args: unknown[]) => mockStopRemux(...args),
      engineProgress: (...args: unknown[]) => mockEngineProgress(...args),
      videoDecodeSupport: () => mockDecodeSupport(),
      // What the running binary declares it can emit, as constantsToExport reports it. A getter
      // because the factory runs before the list is initialised.
      get events() {
        return mockNativeEvents;
      },
    },
  },
  NativeEventEmitter: class {
    addListener(name: string, handler: (payload: unknown) => void) {
      mockListeners.set(name, handler);
      return { remove: jest.fn() };
    }
  },
}));

const mockProbeEmit = jest.fn();
jest.mock("@/services/playbackProbe", () => ({ probeEmit: (...args: unknown[]) => mockProbeEmit(...args), noteDeviceDecode: jest.fn() }));

// The real streamUrls builders run in this suite; they only need a config.
jest.mock("@/services/jellyfin/session", () => ({
  getCachedConfig: jest.fn(() => ({ server: "http://server:8096", apiKey: "k", userId: "u" })),
  generatePlaySessionId: () => "test-session",
}));

// Nothing remembered: the lane predictor's verdict lookup answers null here.
jest.mock("@/services/engineVerdicts", () => ({ rememberedVerdict: async () => null }));

// Measured-slow link: the tier is declared only when measured < source.
jest.mock("@/services/jellyfin/bitrateTest", () => ({
  rememberedBitrate: async () => 3_000_000,
  measureServerBitrate: async () => 3_000_000,
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
  (getCachedConfig as jest.Mock).mockReturnValue({ server: "http://server:8096", apiKey: "k", userId: "u" });
  mockDecodeSupport.mockResolvedValue({ hevc: true, hevcMain10: true, av1: false, h264MaxHeight: null, hevcMaxHeight: null });
  mockStartRemux.mockResolvedValue("http://127.0.0.1:5000/token/master.m3u8");
});

describe("isLocalRemuxAvailable", () => {
  it("is available when the native module is present on iOS", () => {
    expect(isLocalRemuxAvailable()).toBe(true);
  });
});

describe("engine link ownership", () => {
  it("replays a report emitted before native startup resolves only to that session", async () => {
    const token = "early-link-session";
    const report = { token, bps: 1_500_000, copyListed: false };
    mockStartRemux.mockImplementationOnce(async () => {
      mockListeners.get("onEngineLink")!(report);
      return `http://127.0.0.1:5000/${token}/master.m3u8`;
    });
    await startLocalRemux(item());
    const listener = jest.fn();
    const other = jest.fn();
    const stop = subscribeEngineLink(token, listener);
    const stopOther = subscribeEngineLink("another-session", other);
    expect(listener).toHaveBeenCalledWith(report);
    expect(other).not.toHaveBeenCalled();
    stop();
    stopOther();
    await stopLocalRemux(token);
  });

  it("discards cached and late reports when their session stops", async () => {
    const token = "stopped-link-session";
    const listener = jest.fn();
    const stop = subscribeEngineLink(token, listener);
    mockListeners.get("onEngineLink")!({ token, bps: 2_000_000 });
    await stopLocalRemux(token);
    listener.mockClear();
    mockListeners.get("onEngineLink")!({ token, bps: 30_000_000 });
    const stopAgain = subscribeEngineLink(token, listener);
    expect(listener).not.toHaveBeenCalled();
    stop();
    stopAgain();
  });
});

describe("engineProgress", () => {
  it("preserves native supplier recovery state", async () => {
    const progress = { alive: true, bytesRead: 2048, readSeconds: 1, elapsedSeconds: 3, sourceState: "retry-wait", recovering: true, hasPlayableSupplier: true, sourceRetryAfterSeconds: 2 };
    mockEngineProgress.mockResolvedValueOnce(progress);
    await expect(engineProgress("active-token")).resolves.toEqual(progress);
    expect(mockEngineProgress).toHaveBeenCalledWith("active-token");
  });

  it("does not invent supplier state for a binary that does not report it", async () => {
    const progress = { alive: true, bytesRead: 2048, readSeconds: 1, elapsedSeconds: 3 };
    mockEngineProgress.mockResolvedValueOnce(progress);
    await expect(engineProgress("older-token")).resolves.toEqual(progress);
  });
});

describe("sourceBandwidthForItem", () => {
  it("prefers the declared whole-source rate over file size and individual streams", () => {
    const source = item({
      RunTimeTicks: 100_000_000,
      MediaSources: [{ Id: "item1", Bitrate: 9_000_000, Size: 10_000_000 }],
      streams: [
        { Type: "Video", Codec: "h264", Index: 0, BitRate: 5_000_000 },
        { Type: "Audio", Codec: "aac", Index: 1, BitRate: 192_000 },
      ],
    });
    expect(sourceBandwidthForItem(source)).toBe(9_000_000);
  });

  it("uses file size and duration when the source bitrate is absent", () => {
    expect(sourceBandwidthForItem(item({ RunTimeTicks: 100_000_000, MediaSources: [{ Id: "item1", Size: 10_000_000 }] }))).toBe(8_000_000);
  });

  it("counts every multiplexed audio track, not only the selected or largest track", () => {
    const source = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0, BitRate: 5_000_000 },
        { Type: "Audio", Codec: "aac", Index: 1, BitRate: 192_000, IsDefault: true },
        { Type: "Audio", Codec: "ac3", Index: 2, BitRate: 640_000 },
        { Type: "Audio", Codec: "dts", Index: 3, BitRate: 768_000 },
        { Type: "Audio", Codec: "aac", Index: 4, BitRate: 192_000, IsExternal: true },
      ],
    });
    expect(sourceBandwidthForItem(source)).toBe(6_600_000);
  });

  it("preserves unknown rather than counting audio alone as a video source", () => {
    const source = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: "aac", Index: 1, BitRate: 192_000 },
      ],
    });
    expect(sourceBandwidthForItem(source)).toBe(0);
  });

  it("does not treat incomplete stream bitrates as a complete source total", () => {
    const source = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0, BitRate: 5_000_000 },
        { Type: "Audio", Codec: "aac", Index: 1 },
      ],
    });
    expect(sourceBandwidthForItem(source)).toBe(0);
    expect(slipstreamInputBandwidth(source)).toBe(5_256_000);
  });

  it("shares native's source-or-variant input budget with the cap caller", async () => {
    const source = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0, BitRate: 5_000_000 },
        { Type: "Audio", Codec: "aac", Index: 1 },
      ],
    });
    await startLocalRemux(source);
    const config = mockStartRemux.mock.calls[0][0];
    expect(slipstreamInputBandwidth(source)).toBe(config.sourceBandwidth > 0 ? config.sourceBandwidth : config.bandwidth);
  });
});

describe("canRemuxLocally", () => {
  it("accepts H.264 in MKV with a single audio track", async () => {
    await expect(canRemuxLocally(item())).resolves.toBe(true);
  });

  it("declines an item without a runtime unless it is a live stream", async () => {
    mockProbeEmit.mockClear();
    await expect(canRemuxLocally(item({ RunTimeTicks: undefined }))).resolves.toBe(false);
    expect(mockProbeEmit).toHaveBeenCalledWith("decline", expect.objectContaining({ reason: "no runtime in metadata" }));
    const live = item({
      RunTimeTicks: undefined,
      MediaSources: [{ Id: "c1", Container: "ts", IsInfiniteStream: true, LiveStreamId: "ls-1" }],
      streams: [
        { Type: "Video", Codec: "mpeg2video", Index: 0, Width: 1920, Height: 1080, BitDepth: 8 },
        { Type: "Audio", Codec: "mp2", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(live)).resolves.toBe(true);
  });

  it("accepts HEVC", async () => {
    const hevc = item({
      streams: [
        { Type: "Video", Codec: "hevc", Index: 0 },
        { Type: "Audio", Codec: "aac", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(hevc)).resolves.toBe(true);
  });

  // Codecs AVPlayer cannot decode are transcoded to H.264 on device. Resolution
  // is the only gate; bit depth and interlacing are handled, not refused.
  it.each(["vp8", "vp9", "vp7", "mpeg1video", "mpeg2video", "mpeg4", "wmv3", "vc1", "h263", "flv1", "rv40", "vp6f", "svq3"])(
    "accepts %s at 1080p-class resolution for on-device transcode",
    async (videoCodec) => {
      const exotic = item({
        streams: [
          { Type: "Video", Codec: videoCodec, Index: 0, Width: 1920, Height: 1080, BitDepth: 8 },
          { Type: "Audio", Codec: "aac", Index: 1 },
        ],
      });
      await expect(canRemuxLocally(exotic)).resolves.toBe(true);
    },
  );

  // No size gate: whether a device keeps up is measured by the session itself
  // (Remuxer.reportThroughput) and remembered per item (engineVerdicts.ts).
  it("accepts 4K VP9 for on-device transcode", async () => {
    const fourK = item({
      streams: [
        { Type: "Video", Codec: "vp9", Index: 0, Width: 3840, Height: 2160, BitDepth: 8 },
        { Type: "Audio", Codec: "opus", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(fourK)).resolves.toBe(true);
  });

  it("accepts 8K VP9: the encoder refusing to open is the session's own start-time fallback", async () => {
    const eightK = item({
      streams: [
        { Type: "Video", Codec: "vp9", Index: 0, Width: 7680, Height: 4320, BitDepth: 8 },
        { Type: "Audio", Codec: "opus", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(eightK)).resolves.toBe(true);
  });

  // T44 and T45 guard the server-HLS subtitle-sync invariant (X-TIMESTAMP-MAP
  // against segment PTS). Both reach the server through a video codec outside
  // TRANSCODABLE_VIDEO_CODECS (ASUS V1), the one decline that is independent of
  // size and hardware; if the allowlist ever grows it, these go red instead of
  // the guard going quiet. See test/playback/manifest.json T44/T45.
  it("declines T44 for its ASV1 video codec, which is what keeps the subtitle-sync fixture on the server lane it tests", async () => {
    mockProbeEmit.mockClear();
    const t44 = item({
      streams: [
        { Type: "Video", Codec: "asv1", Index: 0, Width: 2560, Height: 1440, BitDepth: 8 },
        { Type: "Audio", Codec: "aac", Index: 1 },
        { Type: "Subtitle", Codec: "subrip", Index: 2 },
      ],
    });
    await expect(canRemuxLocally(t44)).resolves.toBe(false);
    expect(mockProbeEmit).toHaveBeenCalledWith("decline", expect.objectContaining({ reason: "video codec unsupported", codec: "asv1" }));
  });

  it("declines T45 for its ASV1 video codec, the same fixture rule on real content", async () => {
    const t45 = item({
      streams: [
        { Type: "Video", Codec: "asv1", Index: 0, Width: 2560, Height: 1920, BitDepth: 8 },
        { Type: "Audio", Codec: "eac3", Index: 1 },
        { Type: "Subtitle", Codec: "subrip", Index: 2 },
      ],
    });
    await expect(canRemuxLocally(t45)).resolves.toBe(false);
  });

  it("accepts 10-bit transcodable sources, which the engine encodes as HEVC Main 10", async () => {
    const tenBit = item({
      streams: [
        { Type: "Video", Codec: "vp9", Index: 0, Width: 1920, Height: 804, BitDepth: 10 },
        { Type: "Audio", Codec: "opus", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(tenBit)).resolves.toBe(true);
  });

  it("accepts interlaced transcodable sources, which the engine deinterlaces itself", async () => {
    const interlaced = item({
      streams: [
        { Type: "Video", Codec: "mpeg2video", Index: 0, Width: 720, Height: 576, IsInterlaced: true },
        { Type: "Audio", Codec: "mp2", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(interlaced)).resolves.toBe(true);
  });

  it("accepts transcodable codecs with unknown dimensions: nothing reads the size", async () => {
    const sizeless = item({
      streams: [
        { Type: "Video", Codec: "vp9", Index: 0 },
        { Type: "Audio", Codec: "opus", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(sizeless)).resolves.toBe(true);
  });

  // Enabled by our own FFmpeg build (scripts/ffmpeg/build.sh).
  it.each(["theora", "msmpeg4v3", "dvvideo", "cinepak", "vvc"])("carries %s, decoded on device", async (videoCodec) => {
    const decodable = item({
      streams: [
        { Type: "Video", Codec: videoCodec, Index: 0, Width: 854, Height: 480 },
        { Type: "Audio", Codec: "mp3", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(decodable)).resolves.toBe(true);
  });

  // avs2 needs libdavs2, which this build does not link. "avs3" must not
  // prefix-match it.
  it.each(["avs2", "binkvideo2", "notacodec"])("rejects %s, which has no registered decoder", async (videoCodec) => {
    const undecodable = item({
      streams: [
        { Type: "Video", Codec: videoCodec, Index: 0, Width: 854, Height: 480 },
        { Type: "Audio", Codec: "mp3", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(undecodable)).resolves.toBe(false);
  });

  it.each(["ralf", "qdm2", "sipr", "atrac3", "atrac3p", "wavpack", "musepack7", "mp4als"])("carries %s audio", async (audioCodec) => {
    const carriable = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: audioCodec, Index: 1 },
      ],
    });
    await expect(canRemuxLocally(carriable)).resolves.toBe(true);
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
    await expect(canRemuxLocally(carriableAudio)).resolves.toBe(true);
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
    await expect(canRemuxLocally(multi)).resolves.toBe(true);
  });

  it("accepts mixed local and server-backed audio without dropping tracks", async () => {
    const multi = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: "aac", Index: 1 },
        { Type: "Audio", Codec: "acelp.kelvin", Index: 2 },
      ],
    });
    await expect(canRemuxLocally(multi)).resolves.toBe(true);
  });

  it("allows server-backed audio when no audio track has a local decoder", async () => {
    const undecodable = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: "acelp.kelvin", Index: 1 },
        { Type: "Audio", Codec: "somethingelse", Index: 2 },
      ],
    });
    await expect(canRemuxLocally(undecodable)).resolves.toBe(true);
  });

  it("declines invalid audio identities rather than inventing stream zero", async () => {
    await expect(
      canRemuxLocally(
        item({
          streams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Audio", Codec: "aac" },
          ],
        }),
      ),
    ).resolves.toBe(false);
    expect(mockProbeEmit).toHaveBeenCalledWith("decline", expect.objectContaining({ reason: "invalid audio catalogue" }));
  });

  it("carries a file with no audio at all, which was never a reason to decline", async () => {
    const silent = item({ streams: [{ Type: "Video", Codec: "vc1", Index: 0, Width: 1920, Height: 1080 }] });
    await expect(canRemuxLocally(silent)).resolves.toBe(true);
  });

  // Audio-only items used to be declined for having no video stream, which sent
  // every music file AVPlayer cannot open to the server to be re-encoded.
  it("carries an audio-only item, which runs a video-less session", async () => {
    const music = item({ streams: [{ Type: "Audio", Codec: "vorbis", Index: 0 }] });
    await expect(canRemuxLocally(music)).resolves.toBe(true);
  });

  it("declines an audio-only item whose codec has no decoder", async () => {
    const music = item({ streams: [{ Type: "Audio", Codec: "somethingelse", Index: 0 }] });
    await expect(canRemuxLocally(music)).resolves.toBe(false);
  });

  // This used to decline, and declining is what handed every Blu-ray remux to
  // the server to be re-encoded end to end — video and lossless audio included
  // — purely because its subtitles are pictures. The engine decodes them now.
  it("accepts files whose subtitles are image-based", async () => {
    const pgs = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: "truehd", Index: 1 },
        { Type: "Subtitle", Codec: "pgssub", Index: 2 },
      ],
    });
    await expect(canRemuxLocally(pgs)).resolves.toBe(true);
  });

  it("rejects items with no usable runtime, since the playlist needs a duration", async () => {
    await expect(canRemuxLocally(item({ RunTimeTicks: 0 }))).resolves.toBe(false);
  });

  const av1Item = (width = 1920, height = 1080) =>
    item({
      streams: [
        { Type: "Video", Codec: "av1", Index: 0, Width: width, Height: height },
        { Type: "Audio", Codec: "aac", Index: 1 },
      ],
    });

  /**
   * videoDecodeSupport() caches for the life of the process, which is right in the
   * app (a device's decode silicon does not change) and means these cases need a
   * fresh module each. Without this the first test to run pins the answer for
   * all of them.
   */
  function withAV1Hardware(supported: boolean): typeof canRemuxLocally {
    jest.resetModules();
    mockDecodeSupport.mockResolvedValue({ hevc: true, hevcMain10: true, av1: supported, h264MaxHeight: null, hevcMaxHeight: null });
    // require, not import(): this suite runs on CommonJS and a dynamic import
    // needs --experimental-vm-modules.
    return (require("../localRemux") as typeof import("../localRemux")).canRemuxLocally;
  }

  it("copies AV1 where the device decodes it in hardware", async () => {
    const canRemux = withAV1Hardware(true);
    await expect(canRemux(av1Item())).resolves.toBe(true);
  });

  it("transcodes AV1 on device when the hardware cannot decode it", async () => {
    const canRemux = withAV1Hardware(false);
    await expect(canRemux(av1Item(1280, 720))).resolves.toBe(true);
  });

  // The software path has no size gate: the session measures whether this
  // device keeps up, and the player answers before AVPlayer is bound.
  it("transcodes 4K AV1 on device without hardware decode", async () => {
    const canRemux = withAV1Hardware(false);
    await expect(canRemux(av1Item(3840, 2160))).resolves.toBe(true);
  });

  it("copies 4K AV1 rather than gating it when hardware decode exists", async () => {
    // The gate bounds the software path only; a copy costs no decode at all.
    const canRemux = withAV1Hardware(true);
    await expect(canRemux(av1Item(3840, 2160))).resolves.toBe(true);
  });
});

describe("startLocalRemux source positions (issue 84)", () => {
  // Jellyfin 12 lists the sidecar first and renumbers; before 12 it came last. The file is the same.
  const embedded = (first: number) => [
    { Type: "Video", Codec: "h264", Index: first },
    { Type: "Audio", Codec: "ac3", Index: first + 1, Language: "rus", IsDefault: true },
    { Type: "Audio", Codec: "dts", Index: first + 2, Language: "dan" },
    { Type: "Subtitle", Codec: "subrip", Index: first + 3, Language: "rus" },
    { Type: "Subtitle", Codec: "subrip", Index: first + 4, Language: "eng" },
  ];
  const sidecar = (index: number) => ({ Type: "Subtitle", Codec: "subrip", Index: index, Language: "dan", IsExternal: true });

  it.each([
    ["Jellyfin 12, sidecar first", [sidecar(0), ...embedded(1)], 1],
    ["before 12, sidecar last", [...embedded(0), sidecar(5)], 0],
  ])("%s: every embedded track names its place in the file", async (_shape, streams, first) => {
    await startLocalRemux(item({ streams }));
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.audioTracks.map((track: any) => [track.index, track.source])).toEqual([
      [first + 1, { ordinal: 0, count: 2, codec: "ac3" }],
      [first + 2, { ordinal: 1, count: 2, codec: "dts" }],
    ]);
    const bySource = config.subtitles.filter((sub: any) => sub.isEngineText).map((sub: any) => [sub.index, sub.source]);
    expect(bySource).toEqual([
      [first + 3, { ordinal: 0, count: 2, codec: "subrip" }],
      [first + 4, { ordinal: 1, count: 2, codec: "subrip" }],
    ]);
    expect(config.subtitles.find((sub: any) => sub.isExternal).source).toBeUndefined();
  });

  it("names a bitmap track by FFmpeg's codec, not Jellyfin's rewrite of it", async () => {
    const streams = [sidecar(0), { Type: "Video", Codec: "h264", Index: 1 }, { Type: "Audio", Codec: "aac", Index: 2 }, { Type: "Subtitle", Codec: "PGSSUB", Index: 3 }];
    await startLocalRemux(item({ streams }));
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.subtitles.find((sub: any) => sub.index === 3).source).toEqual({ ordinal: 0, count: 1, codec: "hdmv_pgs_subtitle" });
  });

  it("hands a sidecar audio file to the server, it is not in the container", async () => {
    const streams = [
      { Type: "Video", Codec: "h264", Index: 0 },
      { Type: "Audio", Codec: "aac", Index: 1 },
      { Type: "Audio", Codec: "aac", Index: 2, IsExternal: true },
    ];
    await startLocalRemux(item({ streams }));
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.audioTracks.map((track: any) => [track.index, track.usesServerAudio, track.source])).toEqual([
      [1, false, { ordinal: 0, count: 1, codec: "aac" }],
      [2, true, undefined],
    ]);
  });
});

describe("startLocalRemux", () => {
  it("opens the explicit server-video fallback without widening ordinary local codec admission", async () => {
    const source = item({
      streams: [
        { Type: "Video", Codec: "asv1", Index: 0, BitRate: 10_000 },
        { Type: "Audio", Codec: "aac", Index: 1, BitRate: 32_000 },
        { Type: "Subtitle", Codec: "subrip", Index: 2 },
      ],
    });
    await expect(canRemuxLocally(source)).resolves.toBe(false);
    expect(offeredTierBandwidths(source)).toEqual([]);
    await startLocalRemux(source, undefined, 45, { serverVideoOnly: true });
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.serverVideoOnly).toBe(true);
    expect(config.startOffsetSeconds).toBe(45);
    expect(config.tiers).toHaveLength(7);
    expect(config.tiers.map((tier: { bandwidth: number }) => tier.bandwidth)).toEqual(offeredTierBandwidths(source, undefined, { serverVideoOnly: true }));
    expect(config.audioTracks[0]).toMatchObject({ index: 1, usesServerAudio: true, codecs: "mp4a.40.2", bandwidth: 120_000 });
    expect(config.audioTracks[0].serverAudioUrl).toContain("AudioStreamIndex=1");
    expect(config.subtitles[0].serverVttUrl).toContain("Subtitles/2/Stream.vtt");
    expect(config.primaryVideoCodecs).toBe("");
  });

  it("keeps every HDR-source audio track in the explicit server-video fallback", async () => {
    const source = item({
      streams: [
        { Type: "Video", Codec: "hevc", Index: 0, BitRate: 20_000_000, VideoRangeType: "HDR10", BitDepth: 10 },
        { Type: "Audio", Codec: "eac3", Index: 1, BitRate: 640_000, Language: "eng" },
        { Type: "Audio", Codec: "truehd", Index: 7, BitRate: 3_000_000, Language: "spa" },
      ],
    });
    await startLocalRemux(source, 7, undefined, { serverVideoOnly: true });
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.audioTracks.map((track: { index: number }) => track.index)).toEqual([7, 1]);
    expect(config.audioTracks.every((track: { usesServerAudio: boolean; codecs: string }) => track.usesServerAudio && track.codecs === "mp4a.40.2")).toBe(true);
    expect(config.tiers.every((tier: { codecs: string }) => tier.codecs.startsWith("avc1.") && tier.codecs.endsWith("mp4a.40.2"))).toBe(true);
    expect(config.serverVideoOnly).toBe(true);
  });

  it("does not invent audio on a video-only server fallback", async () => {
    const source = item({ streams: [{ Type: "Video", Codec: "asv1", Index: 0, BitRate: 100_000 }] });
    await startLocalRemux(source, undefined, undefined, { serverVideoOnly: true });
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.audioTracks).toEqual([]);
    expect(config.tiers[0]).toMatchObject({ bandwidth: 140_000, codecs: "avc1.64000C" });
    expect(config.tiers.map((tier: { bandwidth: number }) => tier.bandwidth)).toEqual(offeredTierBandwidths(source, undefined, { serverVideoOnly: true }));
  });

  it("starts the server fallback without an external bitmap it has no supplier for", async () => {
    const source = item({
      streams: [
        { Type: "Video", Codec: "asv1", Index: 0 },
        { Type: "Subtitle", Codec: "pgssub", Index: 2, IsExternal: true },
      ],
    });
    await startLocalRemux(source, undefined, undefined, { serverVideoOnly: true });
    expect(mockStartRemux.mock.calls[0][0].subtitles).toEqual([]);
  });

  it("rejects server-video-only mode for live channels", async () => {
    const source = item({ MediaSources: [{ Id: "live-source", IsInfiniteStream: true }] });
    await expect(startLocalRemux(source, undefined, undefined, { serverVideoOnly: true })).rejects.toThrow("requires network VOD video");
    expect(mockStartRemux).not.toHaveBeenCalled();
  });

  it("rejects server-video-only mode for audio-only items", async () => {
    const source = item({ streams: [{ Type: "Audio", Codec: "vorbis", Index: 0 }] });
    await expect(startLocalRemux(source, undefined, undefined, { serverVideoOnly: true })).rejects.toThrow("requires network VOD video");
    expect(mockStartRemux).not.toHaveBeenCalled();
  });

  it("separates input wire cost from video plus the largest selectable output audio track", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0, BitRate: 5_000_000 },
          { Type: "Audio", Codec: "aac", Index: 1, BitRate: 192_000 },
          { Type: "Audio", Codec: "ac3", Index: 2, BitRate: 640_000 },
        ],
      }),
    );
    expect(mockStartRemux.mock.calls[0][0]).toMatchObject({ primaryVideoBandwidth: 5_000_000, bandwidth: 5_640_000, sourceBandwidth: 5_832_000 });
  });

  it("recovers a missing video rate from the known source total without advertising only audio", async () => {
    await startLocalRemux(
      item({
        MediaSources: [{ Id: "item1", Bitrate: 6_000_000 }],
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Audio", Codec: "aac", Index: 1, BitRate: 192_000 },
          { Type: "Audio", Codec: "ac3", Index: 2, BitRate: 640_000 },
        ],
      }),
    );
    expect(mockStartRemux.mock.calls[0][0]).toMatchObject({ primaryVideoBandwidth: 5_168_000, bandwidth: 5_808_000, sourceBandwidth: 6_000_000 });
  });

  it("recovers a missing video rate from size and runtime when the source total is absent", async () => {
    await startLocalRemux(
      item({
        RunTimeTicks: 100_000_000,
        MediaSources: [{ Id: "item1", Size: 10_000_000 }],
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Audio", Codec: "aac", Index: 1, BitRate: 192_000 },
        ],
      }),
    );
    expect(mockStartRemux.mock.calls[0][0]).toMatchObject({ primaryVideoBandwidth: 7_808_000, bandwidth: 8_000_000, sourceBandwidth: 8_000_000 });
  });

  it("keeps video and variant rates unknown when only the audio rate is known", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Audio", Codec: "aac", Index: 1, BitRate: 192_000 },
        ],
      }),
    );
    const config = mockStartRemux.mock.calls[0][0];
    expect(config).toMatchObject({ primaryVideoBandwidth: 0, bandwidth: 0, sourceBandwidth: 0 });
    expect(config.tiers).toHaveLength(7);
  });

  it("carries unsupported audio through the server even when no video rung undercuts the original", async () => {
    const source = item({
      MediaSources: [{ Id: "selected-source", Container: "mkv" }],
      streams: [
        { Type: "Video", Codec: "h264", Index: 0, BitRate: 10_000 },
        { Type: "Audio", Codec: "aac", Index: 1, BitRate: 32_000, DisplayTitle: "English" },
        { Type: "Audio", Codec: "acelp.kelvin", Index: 7, DisplayTitle: "English", IsDefault: true, Channels: 1 },
      ],
    });
    await startLocalRemux(source);
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.tiers).toEqual([]);
    expect(config.audioTracks).toHaveLength(2);
    expect(config.audioTracks[0]).toMatchObject({
      index: 7,
      identity: "selected-source:7",
      usesServerAudio: true,
      codecs: "mp4a.40.2",
      bandwidth: 120_000,
      serverAudioChannels: 1,
    });
    const serverUrl = new URL(config.audioTracks[0].serverAudioUrl);
    expect(serverUrl.pathname).toBe("/Videos/item1/main.m3u8");
    expect(serverUrl.searchParams.get("MediaSourceId")).toBe("selected-source");
    expect(serverUrl.searchParams.get("AudioStreamIndex")).toBe("7");
    expect(config.audioTracks[1]).toMatchObject({ index: 1, identity: "selected-source:1", usesServerAudio: false, codecs: "mp4a.40.2", bandwidth: 32_000 });
    expect(config.audioTracks[1].serverAudioUrl).toBeUndefined();
    expect(config.audioTracks.map((track: { index: number }) => track.index)).toEqual(getAudioTracks(source).map((track) => track.Index));
    expect(config.audioTracks.map((track: { name: string }) => track.name)).toEqual(getAudioTracks(source).map((track) => track.DisplayTitle));
  });

  it("declares the HEVC Main original beside its 144p fallback rungs", async () => {
    await startLocalRemux(
      item({
        MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: 426_777 }],
        streams: [
          { Type: "Video", Codec: "hevc", Profile: "Main", Level: 93, BitDepth: 8, Index: 0, BitRate: 393_055, Width: 1280, Height: 720, VideoRangeType: "SDR" },
          { Type: "Audio", Codec: "aac", Profile: "HE-AAC", Index: 1, BitRate: 32_001, Channels: 2 },
        ],
      }),
      undefined,
      461,
    );
    const config = mockStartRemux.mock.calls[0][0];
    expect(config).toMatchObject({
      primaryVideoCodecs: "hvc1.1.4.L93.B0",
      codecs: "hvc1.1.4.L93.B0,mp4a.40.5",
      primaryVideoBandwidth: 393_055,
      bandwidth: 425_056,
      width: 1280,
      height: 720,
      startOffsetSeconds: 461,
    });
    expect(config.tiers).toHaveLength(2);
    expect(config.tiers.map((tier: { height: number }) => tier.height)).toEqual([144, 144]);
  });

  it.each([
    { profile: "Main", level: 120, width: 1920, height: 1080, bitDepth: 8, videoRange: "SDR", bitrate: 12_000_000, codec: "hvc1.1.4.L120.B0" },
    { profile: "Main", level: 153, width: 3840, height: 2160, bitDepth: 8, videoRange: "SDR", bitrate: 35_000_000, codec: "hvc1.1.4.L153.B0" },
    { profile: "Main 10", level: 153, width: 3840, height: 2160, bitDepth: 10, videoRange: "HDR10", bitrate: 80_000_000, codec: "hvc1.2.4.L153.B0" },
  ])("preserves the $height-p $profile original at $bitrate bps", async ({ profile, level, width, height, bitDepth, videoRange, bitrate, codec }) => {
    await startLocalRemux(
      item({
        MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: bitrate + 192_000 }],
        streams: [
          { Type: "Video", Codec: "hevc", Profile: profile, Level: level, BitDepth: bitDepth, Index: 0, BitRate: bitrate, Width: width, Height: height, VideoRangeType: videoRange },
          { Type: "Audio", Codec: "aac", Profile: "LC", Index: 1, BitRate: 192_000, Channels: 2 },
        ],
      }),
    );
    const config = mockStartRemux.mock.calls[0][0];
    expect(config).toMatchObject({
      primaryVideoCodecs: codec,
      codecs: `${codec},mp4a.40.2`,
      primaryVideoBandwidth: bitrate,
      bandwidth: bitrate + 192_000,
      sourceBandwidth: bitrate + 192_000,
      width,
      height,
      videoRange: videoRange === "HDR10" ? "PQ" : "SDR",
    });
    expect(config.tiers.length).toBeGreaterThan(2);
  });

  it("declares every source-group audio codec and the largest selectable output bandwidth", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "hevc", Profile: "Main 10", Level: 120, BitDepth: 10, Index: 0, BitRate: 5_000_000, VideoRangeType: "HDR10" },
          { Type: "Audio", Codec: "eac3", Index: 4, BitRate: 640_000, IsDefault: true },
          { Type: "Audio", Codec: "dts", Index: 7, BitRate: 768_000, Channels: 6, SampleRate: 48_000, BitDepth: 24 },
          { Type: "Audio", Codec: "acelp.kelvin", Index: 9 },
        ],
      }),
    );
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.audioTracks.map((track: { codecs: string }) => track.codecs)).toEqual(["ec-3", "fLaC,mp4a.40.2", "mp4a.40.2"]);
    expect(config.audioTracks.map((track: { usesServerAudio: boolean }) => track.usesServerAudio)).toEqual([false, false, true]);
    expect(config.codecs).toBe(`${config.primaryVideoCodecs},ec-3,fLaC,mp4a.40.2`);
    expect(config.primaryVideoCodecs).toBe("hvc1.2.4.L120.B0");
    expect(config.primaryVideoBandwidth).toBe(5_000_000);
    expect(config.bandwidth).toBe(5_000_000 + 4_147_200);
  });

  it("uses the copied AAC profile rather than declaring every AAC track as LC", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Audio", Codec: "aac", Index: 3, Profile: "HE-AAC", BitRate: 64_000 },
        ],
      }),
    );
    expect(mockStartRemux.mock.calls[0][0].audioTracks[0]).toMatchObject({ codecs: "mp4a.40.5", bandwidth: 64_000, usesServerAudio: false });
  });

  it.each(["dts", "truehd", "flac"])("declares both possible native outputs for %s without disabling lossless encoding", async (codec) => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Audio", Codec: codec, Index: 3, Channels: 6 },
        ],
      }),
    );
    expect(mockStartRemux.mock.calls[0][0].audioTracks[0]).toMatchObject({ usesServerAudio: false, codecs: "fLaC,mp4a.40.2" });
  });

  it("budgets the native AAC fallback when a small lossless estimate would understate it", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Audio", Codec: "pcm_mulaw", Index: 3, Channels: 1, SampleRate: 8000, BitDepth: 8 },
        ],
      }),
    );
    expect(mockStartRemux.mock.calls[0][0].audioTracks[0]).toMatchObject({ usesServerAudio: false, codecs: "fLaC,mp4a.40.2", bandwidth: 192_000 });
  });

  it("rejects an unidentified track before passing a partial catalogue to native", async () => {
    await expect(
      startLocalRemux(
        item({
          streams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Audio", Codec: "aac" },
          ],
        }),
      ),
    ).rejects.toThrow("valid Jellyfin stream index");
    expect(mockStartRemux).not.toHaveBeenCalled();
  });

  it("provides an external bitmap supplier independently of ladder eligibility", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0, BitRate: 10_000 },
          { Type: "Audio", Codec: "aac", Index: 1, BitRate: 32_000 },
          { Type: "Subtitle", Codec: "pgssub", Index: 8, IsExternal: true, DeliveryUrl: "/Videos/item1/item1/Subtitles/8/Stream.pgssub" },
        ],
      }),
    );
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.tiers).toEqual([]);
    expect(config.subtitles[0]).toMatchObject({ isExternal: true, isImage: true, isEngineText: false });
    const subtitleUrl = new URL(config.subtitles[0].serverSupUrl);
    expect(subtitleUrl.pathname).toBe("/Videos/item1/item1/Subtitles/8/Stream.pgssub");
    expect(subtitleUrl.searchParams.get("ApiKey")).toBe("k");
  });

  it("does not send the Jellyfin key to an external bitmap host", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Subtitle", Codec: "pgssub", Index: 8, IsExternal: true, DeliveryUrl: "https://subtitles.example/track.sup" },
        ],
      }),
    );
    expect(mockStartRemux.mock.calls[0][0].subtitles[0].serverSupUrl).toBe("https://subtitles.example/track.sup");
  });

  it("plays without an external bitmap that has no supplier", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Subtitle", Codec: "pgssub", Index: 8, IsExternal: true },
        ],
      }),
    );
    expect(mockStartRemux.mock.calls[0][0].subtitles).toEqual([]);
  });

  it.each([undefined, -1, 1.5, NaN, 2_147_483_648])("plays without a subtitle whose index is %s", async (index) => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Subtitle", Codec: "subrip", Index: index },
        ],
      }),
    );
    expect(mockStartRemux.mock.calls[0][0].subtitles).toEqual([]);
  });

  it("keeps the first of two subtitles sharing an index, so no route is ambiguous", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Subtitle", Codec: "subrip", Index: 2 },
          { Type: "Subtitle", Codec: "pgssub", Index: 2 },
        ],
      }),
    );
    const subtitles = mockStartRemux.mock.calls[0][0].subtitles;
    expect(subtitles.map((sub: { index: number; isImage: boolean }) => [sub.index, sub.isImage])).toEqual([[2, false]]);
  });

  it("publishes the other subtitles when an external text track has no supplier", async () => {
    (getCachedConfig as jest.Mock).mockReturnValue({ server: "http://server:8096", apiKey: "", userId: "u" });
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Subtitle", Codec: "subrip", Index: 2 },
          { Type: "Subtitle", Codec: "subrip", Index: 3, IsExternal: true },
        ],
      }),
    );
    expect(mockStartRemux.mock.calls[0][0].subtitles.map((sub: { index: number }) => sub.index)).toEqual([2]);
  });

  it("accepts the full nonnegative Int32 subtitle index boundary", () => {
    const subtitles = subtitleRenditions(
      item({
        streams: [
          { Type: "Subtitle", Codec: "subrip", Index: 0 },
          { Type: "Subtitle", Codec: "subrip", Index: 2_147_483_647 },
        ],
      }),
    );
    expect(subtitles.map((subtitle) => subtitle.index)).toEqual([0, 2_147_483_647]);
  });

  it("reads the selected source's stream metadata when the top-level catalogue is empty", async () => {
    await startLocalRemux(
      item({
        MediaStreams: [],
        MediaSources: [
          {
            Id: "alternate",
            MediaStreams: [
              { Type: "Video", Codec: "h264", Index: 0, BitRate: 1_000_000 },
              { Type: "Audio", Codec: "aac", Index: 5, BitRate: 96_000 },
            ],
          },
        ],
      }),
    );
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.audioTracks[0]).toMatchObject({ index: 5, identity: "alternate:5" });
    expect(config.primaryVideoBandwidth).toBe(1_000_000);
    expect(config.tiers.length).toBeGreaterThan(0);
  });

  it("passes the static stream URL, audio index and duration to the native module", async () => {
    const url = await startLocalRemux(item());

    expect(url).toBe("http://127.0.0.1:5000/token/master.m3u8");
    expect(mockStartRemux).toHaveBeenCalledWith(
      expect.objectContaining({
        inputUrl: "http://server:8096/Videos/item1/stream?Static=true&MediaSourceId=item1&ApiKey=k",
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

  it("puts a user-selected track first, outranking the default (audio switch restart)", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Audio", Codec: "aac", Index: 1, Language: "und", IsDefault: true },
          { Type: "Audio", Codec: "aac", Index: 8, Language: "eng", DisplayTitle: "Commentary" },
        ],
      }),
      8,
    );

    const { audioTracks } = mockStartRemux.mock.calls[0][0];
    expect(audioTracks.map((t: { index: number }) => t.index)).toEqual([8, 1]);
  });

  it("keeps default-first order when the preferred index matches no audio stream", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Audio", Codec: "aac", Index: 1, Language: "und" },
          { Type: "Audio", Codec: "aac", Index: 8, Language: "eng", IsDefault: true },
        ],
      }),
      // Stale ref values are player-side indices (0/1); a non-matching one must be a no-op.
      0,
    );

    const { audioTracks } = mockStartRemux.mock.calls[0][0];
    expect(audioTracks.map((t: { index: number }) => t.index)).toEqual([8, 1]);
  });

  // Neither kind asks the server for anything: the engine decodes the text
  // track and turns the image one into bitmaps the app draws.
  it("forwards embedded subtitles for the engine to decode, with no server URL", async () => {
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
    expect(subtitles).toHaveLength(2);
    expect(subtitles[0]).toMatchObject({ index: 2, language: "eng", name: "English", isImage: false, isEngineText: true, vttUrl: "" });
    expect(subtitles[1]).toMatchObject({ index: 3, language: "spa", isImage: true, isEngineText: false, vttUrl: "" });
  });

  // A sidecar is not in the container, so the rendition keeps Jellyfin's URL.
  // It costs no extraction: the server converts a file it already holds.
  it("leaves a sidecar subtitle on the server URL", async () => {
    await startLocalRemux(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Audio", Codec: "aac", Index: 1 },
          { Type: "Subtitle", Codec: "subrip", Index: 2, Language: "eng", IsExternal: true },
        ],
      }),
    );

    const { subtitles } = mockStartRemux.mock.calls[0][0];
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0].isEngineText).toBe(false);
    expect(subtitles[0].vttUrl).not.toBe("");
  });

  it("carries IsForced through so the rendition can be marked AUTOSELECT=YES", async () => {
    // Forced tracks used to burn into the picture. As renditions they only
    // present themselves without being asked for if the flag reaches the
    // master playlist. It drives AUTOSELECT, never FORCED: a FORCED=YES
    // rendition is withheld from AVKit's picker and then not applied either,
    // which cost T05 its only subtitle track (see Remuxer.masterPlaylist).
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

  // The engine's plan is the only account of its decisions that reaches a
  // physical Apple TV, and the regression driver asserts against the probe
  // copy. Both depend on the listener being attached before startRemux is
  // called, since the pipeline thread can report before the promise resolves.
  it("subscribes to the engine plan before starting, and records what arrives", async () => {
    await startLocalRemux(item());

    const handler = mockListeners.get("onEnginePlan");
    expect(handler).toBeDefined();

    // "token" is the path segment of the master URL the mocked startRemux
    // resolves, so this plan belongs to the session this test started.
    const plan = {
      token: "token",
      video: { streamIndex: 0, action: "copy", source: { codec: "h264", width: 1920, height: 1080 } },
      audio: [{ streamIndex: 1, rendition: "primary", action: "copy", source: { codec: "eac3", channels: 6, layout: "5.1(side)", profile: "Dolby Digital Plus + Dolby Atmos" } }],
    };
    handler!(plan);

    // The token is a per-session UUID and is deliberately left out, so the
    // recorded plan stays stable enough to pin as a baseline.
    expect(mockProbeEmit).toHaveBeenCalledWith("enginePlan", { video: plan.video, audio: plan.audio });
  });

  it("records the engine's tier verdict for this session only", async () => {
    await startLocalRemux(item());
    const handler = mockListeners.get("onEngineTier");
    expect(handler).toBeDefined();

    // The engine, not the app, decides whether the tier was really offered: a report from a
    // superseded session would tell the viewer's log a story about the wrong playback.
    handler!({ token: "some-earlier-session", state: "dropped", reason: "HTTP 500" });
    expect(mockProbeEmit).not.toHaveBeenCalledWith("tier", expect.anything());

    handler!({ token: "token", state: "declined", reason: "opening segment 0 HTTP 500" });
    expect(mockProbeEmit).toHaveBeenCalledWith("tier", { state: "declined", reason: "opening segment 0 HTTP 500" });
    handler!({ token: "token", state: "listed" });
    expect(mockProbeEmit).toHaveBeenCalledWith("tier", { state: "listed" });
    handler!({ token: "token", state: "dropped", reason: "audio HTTP 500, after 2 failures" });
    expect(mockProbeEmit).toHaveBeenCalledWith("tier", { state: "dropped", reason: "audio HTTP 500, after 2 failures" });
  });

  it("is listening for the tier verdict before the session is started", async () => {
    await startLocalRemux(item());
    // The master is served the moment AVPlayer opens the URL this resolved, so the listener
    // cannot be attached afterwards.
    expect(mockListeners.get("onEngineTier")).toBeDefined();
  });

  it("routes the tier verdict to the session that owns the token, until unsubscribed", async () => {
    await startLocalRemux(item());
    const onTier = jest.fn();
    const off = subscribeEngineTier("token", onTier);
    const handler = mockListeners.get("onEngineTier");
    expect(handler).toBeDefined();

    handler!({ token: "some-earlier-session", state: "listed" });
    expect(onTier).not.toHaveBeenCalled();
    handler!({ token: "token", state: "listed" });
    expect(onTier).toHaveBeenCalledWith({ token: "token", state: "listed" });
    handler!({ token: "token", state: "dropped", reason: "audio HTTP 500" });
    expect(onTier).toHaveBeenCalledWith({ token: "token", state: "dropped", reason: "audio HTTP 500" });

    off();
    handler!({ token: "token", state: "declined" });
    expect(onTier).toHaveBeenCalledTimes(2);
  });

  it("does not subscribe on a build that predates the event, and still plays", async () => {
    // Metro serves this JS to whatever binary is installed. Subscribing to an event the running
    // build does not declare is a hard error in RCTEventEmitter and takes the player with it.
    jest.resetModules();
    mockListeners.clear();
    mockNativeEvents.splice(mockNativeEvents.indexOf("onEngineTier"), 1);
    try {
      const remux = require("../localRemux") as typeof import("../localRemux");
      await expect(remux.startLocalRemux(item())).resolves.toContain("master.m3u8");
      expect(mockListeners.has("onEngineTier")).toBe(false);
    } finally {
      mockNativeEvents.push("onEngineTier");
    }
  });

  it("routes the engine's failure to the session that owns the token, until unsubscribed", () => {
    const onFailure = jest.fn();
    const off = subscribeEngineFailure("token", onFailure);
    const handler = mockListeners.get("onEngineFailed");
    expect(handler).toBeDefined();

    handler!({ token: "some-earlier-session", message: "open_input: Server returned 404 Not Found" });
    expect(onFailure).not.toHaveBeenCalled();
    handler!({ token: "token", message: "open_input: Server returned 404 Not Found" });
    expect(onFailure).toHaveBeenCalledWith({ token: "token", message: "open_input: Server returned 404 Not Found" });

    off();
    handler!({ token: "token", message: "read_frame: Input/output error" });
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("subscribes to nothing on a build that predates the failure event", () => {
    jest.resetModules();
    // The handlers the suite's own module instance registered come back after, since the
    // fresh instance here attaches only what this call asks for.
    const registered = new Map(mockListeners);
    mockListeners.clear();
    mockNativeEvents.splice(mockNativeEvents.indexOf("onEngineFailed"), 1);
    try {
      const remux = require("../localRemux") as typeof import("../localRemux");
      const off = remux.subscribeEngineFailure("token", jest.fn());
      expect(mockListeners.has("onEngineFailed")).toBe(false);
      off();
    } finally {
      mockNativeEvents.push("onEngineFailed");
      mockListeners.clear();
      registered.forEach((handler, name) => mockListeners.set(name, handler));
    }
  });

  it("reads FFmpeg's 404 wording as a missing input and nothing else", () => {
    expect(engineInputMissing("open_input: Server returned 404 Not Found")).toBe(true);
    expect(engineInputMissing("open_input: Input/output error")).toBe(false);
    expect(engineInputMissing("open_input: Server returned 5XX Server Error reply")).toBe(false);
    expect(engineInputMissing("read_frame: Immediate exit requested")).toBe(false);
  });

  it("ignores a replayed plan from a previous session", async () => {
    // The native side replays its cached plan to a fresh listener, so the
    // first event after a JS reload can be the PREVIOUS session's plan. Seen
    // on device: T88's h264/eac3 plan logged against T92. Attribution is by
    // token, never by arrival order.
    await startLocalRemux(item());

    const handler = mockListeners.get("onEnginePlan");
    const stale = {
      token: "some-earlier-session",
      video: { streamIndex: 0, action: "copy", source: { codec: "h264", width: 1920, height: 1080 } },
      audio: [],
    };
    handler!(stale);

    expect(mockProbeEmit).not.toHaveBeenCalledWith("enginePlan", expect.objectContaining({ video: stale.video }));
  });
});

/**
 * Subtitle stream shapes as the Jellyfin instance the regression suite runs
 * against actually returns them (`/Items?Fields=MediaStreams`). Not invented:
 * Jellyfin OMITS `Language` and `Title` entirely when a track carries neither,
 * and hands every such track the same `DisplayTitle`, which is the whole reason
 * a label cannot be an identity.
 */
const REAL = {
  /** T85, a Blu-ray extract: 13 PGS tracks, no language and no title on any of them. */
  t85Subtitles: Array.from({ length: 13 }, (_, n) => ({
    Type: "Subtitle",
    Codec: "pgssub",
    Index: 6 + n,
    DisplayTitle: n === 0 ? "Undefined - Default - PGSSUB" : "Undefined - PGSSUB",
    IsDefault: n === 0,
    IsForced: false,
  })),
  /** T06, whose single PGS track does carry a name. */
  t06Subtitle: {
    Type: "Subtitle",
    Codec: "pgssub",
    Index: 2,
    Title: "Forced English Subtitles",
    DisplayTitle: "Forced English Subtitles - Default - PGSSUB",
    Language: "eng",
    IsDefault: true,
    IsForced: true,
  },
  /** T07, ten text tracks with ten distinct languages. */
  t07Subtitles: ["deu", "eng", "spa", "fra", "ita", "nld", "pol", "por", "rus", "vie"].map((language, n) => ({
    Type: "Subtitle",
    Codec: "subrip",
    Index: 2 + n,
    DisplayTitle: `${language.toUpperCase()} - SUBRIP`,
    Language: language,
    IsDefault: n === 0,
    IsForced: false,
  })),
};

describe("subtitleRenditions", () => {
  function untaggedPgs(count: number, firstIndex = 6) {
    return REAL.t85Subtitles.slice(0, count).map((stream, n) => ({ ...stream, Index: firstIndex + n }));
  }

  // The bug this whole path was rewritten for. The app used to key the pick on
  // the advertised label and build a Map from it; Jellyfin gives every untagged
  // PGS track the identical DisplayTitle, and a Map from duplicate keys keeps
  // only the last value, so all 13 of T85's tracks resolved to stream 18 and
  // picking any of them drew the last one's bitmaps.
  it("resolves every ordinal of a 13-track disc to its own stream index", () => {
    const renditions = subtitleRenditions(item({ streams: [{ Type: "Video", Codec: "h264", Index: 0 }, ...untaggedPgs(13)] }));

    expect(renditions).toHaveLength(13);
    expect(renditions.map((rendition) => rendition.index)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    renditions.forEach((rendition, ordinal) => expect(rendition.index).toBe(6 + ordinal));
  });

  // Labels carry no identity, but react-native-video reports selection by
  // comparing display names, so duplicates make the pick unreadable.
  it("gives a disc's untagged tracks distinct labels, by position rather than 'Undefined'", () => {
    const names = subtitleRenditions(item({ streams: [{ Type: "Video", Codec: "h264", Index: 0 }, ...untaggedPgs(13)] })).map((rendition) => rendition.name);

    expect(new Set(names).size).toBe(13);
    expect(names[0]).toBe("Track 1");
    expect(names[12]).toBe("Track 13");
    expect(names.some((name) => name.toLowerCase().includes("undefined"))).toBe(false);
  });

  it("disambiguates tracks that genuinely share a language, which real discs ship", () => {
    const names = subtitleRenditions(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Subtitle", Codec: "pgssub", Index: 1, Language: "eng", DisplayTitle: "English" },
          { Type: "Subtitle", Codec: "pgssub", Index: 2, Language: "eng", DisplayTitle: "English" },
        ],
      }),
    ).map((rendition) => rendition.name);

    expect(names).toEqual(["English (1)", "English (2)"]);
  });

  it("publishes sanitized subtitle names with apostrophes and spaces for control characters", () => {
    const renditions = subtitleRenditions(item({ streams: [{ Type: "Subtitle", Codec: "pgssub", Index: 4, Language: "eng", DisplayTitle: '"English"\r\nCC\tEdition\u0000Cut\u0085Alt\u200BFinal' }] }));
    expect(renditions[0].name).toBe("'English' CC Edition Cut Alt Final");
    const selected = resolveSubtitlePick(renditions, [
      { index: 0, title: "'English' CC Edition Cut Alt Final", selected: true },
      { index: 1, title: "", selected: false },
    ]);
    expect(selected.imageStreamIndex).toBe(4);
  });

  it("disambiguates names that collide only after playlist sanitation", () => {
    const renditions = subtitleRenditions(
      item({
        streams: [
          { Type: "Subtitle", Codec: "pgssub", Index: 4, Language: "eng", DisplayTitle: '"English"\nCC' },
          { Type: "Subtitle", Codec: "pgssub", Index: 8, Language: "eng", DisplayTitle: "'English' CC" },
        ],
      }),
    );
    expect(renditions.map((rendition) => rendition.name)).toEqual(["'English' CC (1)", "'English' CC (2)"]);
    const selected = resolveSubtitlePick(renditions, [
      { index: 0, title: "'English' CC (1)", selected: false },
      { index: 1, title: "'English' CC (2)", selected: true },
      { index: 2, title: "", selected: false },
    ]);
    expect(selected.imageStreamIndex).toBe(8);
  });

  it("keeps positional suffixes while removing collisions with an existing suffixed title", () => {
    const renditions = subtitleRenditions(
      item({
        streams: [
          { Type: "Subtitle", Codec: "pgssub", Index: 2, Language: "eng", DisplayTitle: "English" },
          { Type: "Subtitle", Codec: "pgssub", Index: 4, Language: "eng", DisplayTitle: "English" },
          { Type: "Subtitle", Codec: "pgssub", Index: 7, Language: "eng", DisplayTitle: "English (1)" },
          { Type: "Subtitle", Codec: "pgssub", Index: 9, Language: "eng", DisplayTitle: "English (1) (7)" },
        ],
      }),
    );
    expect(renditions.map((rendition) => rendition.name)).toEqual(["English (1)", "English (2)", "English (1) (7)", "English (1) (7) (9)"]);
    const selected = resolveSubtitlePick(renditions, [
      ...renditions.map((rendition, position) => ({ index: position, title: rendition.name, selected: position === 3 })),
      { index: 4, title: "", selected: false },
    ]);
    expect(selected.imageStreamIndex).toBe(9);
  });

  it("keeps a track's own name when the source gives it one", () => {
    const renditions = subtitleRenditions(item({ streams: [{ Type: "Video", Codec: "h264", Index: 0 }, REAL.t06Subtitle, { Type: "Subtitle", Codec: "pgssub", Index: 3 }] }));

    expect(renditions.map((rendition) => rendition.name)).toEqual(["Forced English Subtitles - Default - PGSSUB", "Track 2"]);
    expect(renditions[0]).toMatchObject({ index: 2, isForced: true, isDefault: true, isImage: true });
  });

  // The other real shape: every track already distinguishable by language, so
  // the labels must be left exactly as they are.
  it("leaves a file whose tracks all have distinct languages alone", () => {
    const renditions = subtitleRenditions(item({ streams: [{ Type: "Video", Codec: "h264", Index: 0 }, ...REAL.t07Subtitles] }));

    expect(renditions).toHaveLength(10);
    expect(renditions.map((rendition) => rendition.name)).toEqual(REAL.t07Subtitles.map((stream) => stream.DisplayTitle));
    expect(renditions.map((rendition) => rendition.index)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(renditions.every((rendition) => !rendition.isImage)).toBe(true);
  });

  // RFC 8216 forbids two DEFAULT=YES members in one group, and AVFoundation
  // answers a malformed group by refusing the whole master playlist, so this
  // costs the file rather than its subtitles. MKV rips really do flag several.
  it("keeps only the first default when the source flags several", () => {
    const renditions = subtitleRenditions(
      item({
        streams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Subtitle", Codec: "pgssub", Index: 1, Language: "eng", IsDefault: true },
          { Type: "Subtitle", Codec: "pgssub", Index: 2, Language: "spa", IsDefault: true },
          { Type: "Subtitle", Codec: "pgssub", Index: 3, Language: "fra", IsDefault: true },
        ],
      }),
    );

    expect(renditions.filter((rendition) => rendition.isDefault)).toHaveLength(1);
    expect(renditions[0].isDefault).toBe(true);
  });

  // The engine indexes its decoders, its sub<N>.m3u8 and its pgs<N>.json on the
  // source stream index, and the app converts an ordinal to it through this same
  // list. If the two ever built the list differently the mapping would be silently
  // wrong, which is why there is one function rather than two expressions.
  it("hands the engine exactly the list the app resolves ordinals against", async () => {
    const streams = [{ Type: "Video", Codec: "h264", Index: 0, BitRate: 100_000 }, { Type: "Audio", Codec: "aac", Index: 1, BitRate: 96_000 }, ...untaggedPgs(4, 2)];
    await startLocalRemux(item({ streams }));

    expect(mockStartRemux.mock.calls[0][0].subtitles).toEqual(subtitleRenditions(item({ streams })));
  });
});

describe("videoCodecTag", () => {
  /**
   * Every combination is a string Jellyfin itself puts in its master playlist
   * for the same file, read off the server and diffed against ours. Jellyfin
   * stream-copies these, so both describe one bitstream and the comparison is
   * real rather than two guesses agreeing.
   */
  it.each([
    ["h264", "High", 31, "avc1.64001F"],
    ["h264", "High", 41, "avc1.640029"],
    ["h264", "Main", 30, "avc1.4D401E"],
    ["h264", "Main", 31, "avc1.4D401F"],
    ["h264", "Main", 51, "avc1.4D4033"],
    ["hevc", "Main", 93, "hvc1.1.4.L93.B0"],
    ["hevc", "Main", 120, "hvc1.1.4.L120.B0"],
    ["hevc", "Main 10", 120, "hvc1.2.4.L120.B0"],
  ])("matches Jellyfin for %s %s level %s", (Codec, Profile, Level, expected) => {
    expect(videoCodecTag({ Codec, Profile, Level, Type: "Video" } as JellyfinMediaStream, true)).toBe(expected);
  });

  // VideoTranscoder pins no profile or level, so its output is unknowable when
  // the playlist is written. A CODECS string AVPlayer disagrees with is a hard
  // rejection of the variant, which is worse than omitting the attribute.
  it("says nothing when the engine will re-encode the video", () => {
    expect(videoCodecTag({ Codec: "h264", Profile: "High", Level: 41, Type: "Video" } as JellyfinMediaStream, false)).toBe("");
  });

  it("says nothing for a profile no fixture can prove", () => {
    expect(videoCodecTag({ Codec: "vc1", Profile: "Advanced", Level: 3, Type: "Video" } as JellyfinMediaStream, true)).toBe("");
    expect(videoCodecTag({ Codec: "h264", Profile: "Baseline", Level: 31, Type: "Video" } as JellyfinMediaStream, true)).toBe("");
    expect(videoCodecTag({ Codec: "hevc", Profile: "Rext", Level: 120, Type: "Video" } as JellyfinMediaStream, true)).toBe("");
  });

  it("says nothing without a level, since half a tag is not a tag", () => {
    expect(videoCodecTag({ Codec: "h264", Profile: "High", Type: "Video" } as JellyfinMediaStream, true)).toBe("");
    expect(videoCodecTag({ Codec: "h264", Profile: "High", Level: -99, Type: "Video" } as JellyfinMediaStream, true)).toBe("");
    expect(videoCodecTag(undefined, true)).toBe("");
  });

  // av01.P.LLT.DD per the AV1-ISOBMFF codecs parameter string. The stream shape
  // is the T92 fixture's, read off the live server: Level IS seq_level_idx
  // (5 = 3.1 for its 1280x720), tier is Main by spec for levels <= 7.
  it("names copied AV1 from the stream's own fields", () => {
    expect(videoCodecTag({ Codec: "av1", Profile: "Main", Level: 5, BitDepth: 8, Type: "Video" } as JellyfinMediaStream, true)).toBe("av01.0.05M.08");
    expect(videoCodecTag({ Codec: "av1", Profile: "Main", Level: 13, BitDepth: 10, Type: "Video" } as JellyfinMediaStream, true)).toBe("av01.0.13M.10");
  });

  it("says nothing for AV1 the engine re-encodes, or with fields missing", () => {
    expect(videoCodecTag({ Codec: "av1", Profile: "Main", Level: 5, BitDepth: 8, Type: "Video" } as JellyfinMediaStream, false)).toBe("");
    expect(videoCodecTag({ Codec: "av1", Profile: "Main", Level: 5, Type: "Video" } as JellyfinMediaStream, true)).toBe("");
    expect(videoCodecTag({ Codec: "av1", Profile: "Professional", Level: 5, BitDepth: 12, Type: "Video" } as JellyfinMediaStream, true)).toBe("");
  });
});

describe("resolveSubtitlePick", () => {
  const renditions = subtitleRenditions(item({ streams: [{ Type: "Video", Codec: "h264", Index: 0 }, ...REAL.t85Subtitles] }));

  /** What react-native-video reports: one entry per option in the legible group. */
  function reported(selectedOrdinal: number | number[] | null, count = renditions.length) {
    const chosen = selectedOrdinal === null ? [] : Array.isArray(selectedOrdinal) ? selectedOrdinal : [selectedOrdinal];
    return Array.from({ length: count }, (_, index) => ({ index, title: renditions[index]?.name ?? `extra ${index}`, selected: chosen.includes(index) }));
  }

  it("resolves the picked ordinal to that track's source stream", () => {
    const pick = resolveSubtitlePick(renditions, reported(2));

    expect(pick.imageStreamIndex).toBe(8);
    expect(pick.ordinal).toBe(2);
    expect(pick.rendition?.name).toBe("Track 3");
    expect(pick.reason).toBeUndefined();
  });

  // T88 has no subtitle streams at all, yet the player reported one legible
  // option with an empty title: the phantom AVFoundation offers when a variant
  // does not declare CLOSED-CAPTIONS=NONE. Refusing is right, warning is not.
  it("stays quiet when the engine published nothing, whatever the player offers", () => {
    const pick = resolveSubtitlePick([], [{ index: 0, title: "", selected: true }]);

    expect(pick.imageStreamIndex).toBeNull();
    expect(pick.reason).toBeUndefined();
  });

  it("treats no selection as subtitles being off, not as a problem", () => {
    const pick = resolveSubtitlePick(renditions, reported(null));

    expect(pick.imageStreamIndex).toBeNull();
    expect(pick.reason).toBeUndefined();
  });

  // react-native-video marks selection by comparing display names, so two
  // renditions sharing one makes several report selected at once. Taking the
  // first would draw a track the viewer did not choose.
  it("refuses when more than one track reports selected", () => {
    const pick = resolveSubtitlePick(renditions, reported([2, 7]));

    expect(pick.imageStreamIndex).toBeNull();
    expect(pick.reason).toMatch(/2 tracks report selected/);
  });

  // iOS hands back a legible group carrying two options the engine never
  // published: no display name, languages the file does not have, every file,
  // never on tvOS. Counting the group refused the pick on the phone, so a PGS
  // track could be selected in AVKit's picker and draw nothing.
  it("resolves by name through options the engine never published", () => {
    const group = [...reported(2), { index: 13, title: "", selected: false }, { index: 14, title: "", selected: false }];
    const pick = resolveSubtitlePick(renditions, group);

    expect(pick.imageStreamIndex).toBe(8);
    expect(pick.rendition?.name).toBe("Track 3");
    expect(pick.reason).toBeUndefined();
  });

  // The other half of that group: picking one of the player's own options is a
  // choice, not a discrepancy. Nothing of ours is on screen, and nothing is said.
  it("draws nothing, quietly, when the selection is none of ours", () => {
    const group = [...reported(null), { index: 13, title: "", selected: true }, { index: 14, title: "", selected: false }];
    const pick = resolveSubtitlePick(renditions, group);

    expect(pick.imageStreamIndex).toBeNull();
    expect(pick.rendition).toBeNull();
    expect(pick.reason).toBeUndefined();
  });

  it("matches native apostrophe substitution without relying on ordinal fallback", () => {
    const group = [...reported(2).map((track) => ({ ...track, title: track.index === 2 ? `'${track.title}'` : track.title })), { index: 13, title: "", selected: false }];
    const pick = resolveSubtitlePick(
      renditions.map((rendition, index) => (index === 2 ? { ...rendition, name: `"${rendition.name}"` } : rendition)),
      group,
    );

    expect(pick.imageStreamIndex).toBe(8);
    expect(pick.ordinal).toBe(2);
  });

  it("refuses an ordinal past the end of the published list", () => {
    const pick = resolveSubtitlePick(renditions.slice(0, 2), [
      { index: 0, selected: false },
      { index: 5, selected: true },
    ]);

    expect(pick.imageStreamIndex).toBeNull();
    expect(pick.reason).toBeTruthy();
  });

  // A text track resolves normally; it simply has no bitmaps for us to draw,
  // because AVKit renders it itself.
  it("resolves a text track but reports no bitmaps to draw", () => {
    const textRenditions = subtitleRenditions(item({ streams: [{ Type: "Video", Codec: "h264", Index: 0 }, ...REAL.t07Subtitles] }));
    const pick = resolveSubtitlePick(
      textRenditions,
      Array.from({ length: 10 }, (_, index) => ({ index, selected: index === 3 })),
    );

    expect(pick.imageStreamIndex).toBeNull();
    expect(pick.rendition?.index).toBe(5);
    expect(pick.reason).toBeUndefined();
  });

  // iOS pads the legible group with unnamed options in languages the file does not
  // carry. Picking one resolves to nothing AND reports no reason, so a caller that
  // bails only on `reason` still sees a readable report: useVideoPlayback has to
  // check the rendition too, or it remembers a language nothing will ever match.
  it("resolves nothing, and says nothing, when the pick is one of the player's own options", () => {
    const group = [...reported(null), { index: renditions.length, title: "", selected: true }];
    const pick = resolveSubtitlePick(renditions, group);

    expect(pick.rendition).toBeNull();
    expect(pick.reason).toBeUndefined();
  });
});

describe("session ownership", () => {
  // Regression: the token lived in a module-level variable, so a second start
  // overwrote it and the FIRST player's teardown stopped the SECOND player's
  // session. On device that deleted the live session's segment directory: the
  // picture froze on the last decoded frame while buffered audio played on.
  it("stops the session the caller owns, not whichever started last", async () => {
    mockStopRemux.mockClear();

    mockStartRemux.mockResolvedValueOnce("http://127.0.0.1:9000/token-A/master.m3u8");
    const urlA = await startLocalRemux(item());
    const tokenA = localRemuxToken(urlA);

    // A second player starts while the first is still mounted.
    mockStartRemux.mockResolvedValueOnce("http://127.0.0.1:9000/token-B/master.m3u8");
    const urlB = await startLocalRemux(item());
    const tokenB = localRemuxToken(urlB);

    expect(tokenA).toBe("token-A");
    expect(tokenB).toBe("token-B");

    // The first player now unmounts and must tear down ITS session.
    await stopLocalRemux(tokenA);
    expect(mockStopRemux).toHaveBeenCalledTimes(1);
    expect(mockStopRemux).toHaveBeenCalledWith("token-A");
    expect(mockStopRemux).not.toHaveBeenCalledWith("token-B");
  });

  it("ignores a teardown with no token instead of guessing", async () => {
    mockStopRemux.mockClear();
    await stopLocalRemux(null);
    expect(mockStopRemux).not.toHaveBeenCalled();
  });
});

/**
 * Image subtitles are display-set based, not range based: each set supersedes
 * the previous one and a set with no images is an erase. These are T06's real
 * packet times, measured with ffprobe — 44854 bytes at 6.256s, a 30-byte erase
 * at 10.927s, and so on.
 *
 * Modelling them as {start, end} ranges was the original mistake. It forced the
 * end of a set to be back-filled from the NEXT one, so a set was unknowable
 * until its successor arrived, and a seek that interrupted that needed an
 * invented duration to close whatever was still open.
 */
describe("imagesAt", () => {
  const image = (file: string) => ({ x: 0, y: 800, width: 800, height: 100, file });
  const events: ImageSubtitleEvent[] = [
    { time: 6.256, images: [image("a.png")] },
    { time: 10.927, images: [] },
    { time: 11.178, images: [image("b.png")] },
    { time: 14.973, images: [] },
  ];

  it("shows nothing before the first display set", () => {
    expect(imagesAt(events, 0)).toEqual([]);
    expect(imagesAt(events, 6.255)).toEqual([]);
  });

  it("shows a set from its own timestamp onward", () => {
    expect(imagesAt(events, 6.256).map((i) => i.file)).toEqual(["a.png"]);
    expect(imagesAt(events, 9).map((i) => i.file)).toEqual(["a.png"]);
  });

  it("shows nothing once an erase set has passed", () => {
    expect(imagesAt(events, 10.927)).toEqual([]);
    expect(imagesAt(events, 11)).toEqual([]);
  });

  // The whole point of the model: re-enabling subtitles mid-playback paints
  // whatever should be on screen at that instant, with no dead time waiting for
  // the next set to arrive.
  it("resolves any position without needing end times", () => {
    expect(imagesAt(events, 12).map((i) => i.file)).toEqual(["b.png"]);
    expect(imagesAt(events, 20)).toEqual([]);
  });

  // PGS permits a content set to replace another with no erase between. The
  // range model mishandled this; last-set-wins gets it right for free.
  it("lets one content set replace another with no erase between", () => {
    const backToBack: ImageSubtitleEvent[] = [
      { time: 1, images: [image("first.png")] },
      { time: 2, images: [image("second.png")] },
    ];
    expect(imagesAt(backToBack, 1.5).map((i) => i.file)).toEqual(["first.png"]);
    expect(imagesAt(backToBack, 2.5).map((i) => i.file)).toEqual(["second.png"]);
  });

  it("handles an empty track", () => {
    expect(imagesAt([], 5)).toEqual([]);
  });
});

describe("startLocalRemux Slipstream tier config", () => {
  it.each([true, undefined])("keeps the ladder when SupportsTranscoding is %s", async (supportsTranscoding) => {
    const source = item({ MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: 20_000_000, SupportsTranscoding: supportsTranscoding }] });

    await startLocalRemux(source);

    expect(offeredTierRungs(source)).toHaveLength(7);
    expect(mockStartRemux.mock.calls[0][0].tiers).toHaveLength(7);
  });

  it.each([false, true])("does not offer forbidden rungs with serverVideoOnly=%s", (serverVideoOnly) => {
    const source = item({
      MediaSources: [
        { Id: "item1", Container: "mkv", Bitrate: 20_000_000, SupportsTranscoding: false },
        { Id: "other", SupportsTranscoding: true },
      ],
    });

    expect(offeredTierRungs(source, undefined, { serverVideoOnly })).toEqual([]);
    expect(offeredTierBandwidths(source, undefined, { serverVideoOnly })).toEqual([]);
    expect(slipstreamTierBandwidth(source, undefined, { serverVideoOnly })).toBeNull();
  });

  it("rejects a forbidden server-only gateway before native startup", async () => {
    const source = item({ MediaSources: [{ Id: "item1", SupportsTranscoding: false }] });

    await expect(startLocalRemux(source, undefined, undefined, { serverVideoOnly: true })).rejects.toThrow("Server video transcoding is not permitted");
    expect(mockStartRemux).not.toHaveBeenCalled();
  });

  it("keeps local playback and every track without ladder audio when video transcoding is forbidden", async () => {
    const source = item({
      MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: 20_000_000, SupportsTranscoding: false }],
      streams: [
        { Type: "Video", Codec: "hevc", Index: 0, BitRate: 20_000_000, VideoRangeType: "HDR10", BitDepth: 10 },
        { Type: "Audio", Codec: "ac3", Index: 1, Channels: 6, Language: "eng" },
        { Type: "Audio", Codec: "aac", Index: 7, Language: "spa" },
        { Type: "Subtitle", Codec: "subrip", Index: 2 },
        { Type: "Subtitle", Codec: "subrip", Index: 5, IsExternal: true },
      ],
    });

    expect(await canRemuxLocally(source)).toBe(true);
    await startLocalRemux(source, 7);

    const config = mockStartRemux.mock.calls[0][0];
    expect(config.serverVideoOnly).toBe(false);
    expect(config.tiers).toEqual([]);
    expect(config.videoRange).toBe("PQ");
    expect(config.audioTracks.map((track: { index: number }) => track.index)).toEqual([7, 1]);
    expect(config.audioTracks.every((track: { usesServerAudio: boolean; serverAudioUrl?: string }) => !track.usesServerAudio && !track.serverAudioUrl)).toBe(true);
    expect(config.subtitles).toHaveLength(2);
    expect(config.subtitles).toEqual(expect.arrayContaining([expect.objectContaining({ index: 2, isEngineText: true }), expect.objectContaining({ index: 5 })]));
  });

  it("every rung rides 96k stereo AAC, whatever the source codec or channel count", async () => {
    await startLocalRemux(
      item({
        MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: 20_000_000 }],
        streams: [
          { Type: "Video", Codec: "h264", Index: 0, VideoRangeType: "SDR", Width: 1280, Height: 720, BitRate: 20_000_000 },
          { Type: "Audio", Codec: "dts", Index: 1, Channels: 7, SampleRate: 48000, BitDepth: 24 },
        ],
      }),
    );

    const config = mockStartRemux.mock.calls[0][0];
    // A 20 Mbps source clears every rung's undercut; the ladder leads with the two 144p rungs.
    expect(config.tiers.map((t: { width: number }) => t.width)).toEqual([256, 256, 426, 640, 854, 1280, 1920]);
    expect(config.tiers.map((t: { bandwidth: number }) => t.bandwidth)[0]).toBe(140_000 + 96_000 + 24_000);
    const r480 = config.tiers.find((t: { width: number }) => t.width === 854);
    expect(r480.bandwidth).toBe(1_500_000 + 96_000 + 24_000);
    expect(r480.codecs).toBe("avc1.64001F,mp4a.40.2");
    // The video route: the audio one ignores AudioStreamIndex and returns the same stream for every track.
    expect(config.audioTracks[0].serverAudioUrl).toContain("/Videos/item1/main.m3u8");
    expect(config.audioTracks[0].serverAudioUrl).toContain("AudioStreamIndex=1");
    expect(config.audioTracks[0].serverAudioUrl).toContain("VideoBitrate=20000&AudioBitrate=96000&MaxWidth=64");
    // A seven-channel track arrives as stereo on a rung.
    expect(config.audioTracks[0].serverAudioChannels).toBe(2);
    expect(config.audioTracks[0].serverAudioUrl).toContain("AudioCodec=aac");
    expect(config.audioTracks[0].serverAudioUrl).toContain("AllowAudioStreamCopy=false");
    expect(config.audioTracks[0].serverAudioUrl).toContain("AudioBitrate=96000");
    expect(config.audioTracks[0].serverAudioUrl).toContain("TranscodingMaxAudioChannels=2");
  });

  it("names the server's raw stream for an embedded PGS or DVD track, and for nothing else", async () => {
    await startLocalRemux(
      item({
        MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: 20_000_000 }],
        streams: [
          { Type: "Video", Codec: "h264", Index: 0, VideoRangeType: "SDR", Width: 1280, Height: 720, BitRate: 20_000_000 },
          { Type: "Audio", Codec: "ac3", Index: 1, Channels: 6, BitRate: 640_000 },
          { Type: "Subtitle", Codec: "PGSSUB", Index: 2 },
          { Type: "Subtitle", Codec: "dvdsub", Index: 3 },
          { Type: "Subtitle", Codec: "dvbsub", Index: 4 },
          { Type: "Subtitle", Codec: "PGSSUB", Index: 5, IsExternal: true, DeliveryUrl: "https://subtitles.example/sidecar.sup" },
        ],
      }),
    );

    const config = mockStartRemux.mock.calls[0][0];
    const byIndex = new Map<number, { serverSupUrl?: string }>(config.subtitles.map((sub: { index: number }) => [sub.index, sub]));
    expect(byIndex.get(2)?.serverSupUrl).toContain("/Videos/item1/item1/Subtitles/2/Stream.pgssub");
    expect(byIndex.get(3)?.serverSupUrl).toContain("/Videos/item1/item1/Subtitles/3/Stream.mks");
    expect(byIndex.get(4)?.serverSupUrl).toBeUndefined();
    expect(byIndex.get(5)?.serverSupUrl).toBe("https://subtitles.example/sidecar.sup");
  });

  it("carries every audio track as its own AAC rendition, none dropped", async () => {
    await startLocalRemux(
      item({
        MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: 20_000_000 }],
        streams: [
          { Type: "Video", Codec: "h264", Index: 0, VideoRangeType: "SDR", Width: 1280, Height: 720, BitRate: 20_000_000 },
          { Type: "Audio", Codec: "dts", Index: 1, Channels: 7, SampleRate: 48000, BitDepth: 24 },
          { Type: "Audio", Codec: "eac3", Index: 2, Channels: 6, BitRate: 640_000 },
        ],
      }),
    );

    const config = mockStartRemux.mock.calls[0][0];
    expect(config.audioTracks).toHaveLength(2);
    for (const track of config.audioTracks) {
      expect(track.serverAudioUrl).toContain("AudioCodec=aac");
      expect(track.serverAudioUrl).toContain("AudioBitrate=96000");
      expect(track.serverAudioUrl).toContain("TranscodingMaxAudioChannels=2");
    }
  });

  it("makes the preferred track the DEFAULT=YES rendition, over source order", async () => {
    await startLocalRemux(
      item({
        MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: 20_000_000 }],
        streams: [
          { Type: "Video", Codec: "h264", Index: 0, VideoRangeType: "SDR", Width: 1280, Height: 720, BitRate: 20_000_000 },
          { Type: "Audio", Codec: "dts", Index: 1, Channels: 7, SampleRate: 48000, BitDepth: 24 },
          { Type: "Audio", Codec: "aac", Index: 2, BitRate: 256_000 },
        ],
      }),
      2,
    );

    const config = mockStartRemux.mock.calls[0][0];
    expect(config.audioTracks[0].index).toBe(2);
  });

  it("makes the default-flagged track the DEFAULT=YES rendition when nothing is preferred", async () => {
    await startLocalRemux(
      item({
        MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: 20_000_000 }],
        streams: [
          { Type: "Video", Codec: "h264", Index: 0, VideoRangeType: "SDR", Width: 1280, Height: 720, BitRate: 20_000_000 },
          { Type: "Audio", Codec: "dts", Index: 1, Channels: 7, SampleRate: 48000, BitDepth: 24 },
          { Type: "Audio", Codec: "aac", Index: 2, BitRate: 256_000, IsDefault: true },
        ],
      }),
    );

    const config = mockStartRemux.mock.calls[0][0];
    expect(config.audioTracks[0].index).toBe(2);
  });

  it("offers only the rungs that undercut the primary (a taller rung is dropped)", async () => {
    // Video 3 Mbps + AC3 640k → primary 3.64M, *0.85 = 3.094M. Rungs carry AAC 96k, so 144p
    // (336k), 240p (496k), 360p (896k), 480p (1.596M) undercut; 720p (4.096M) and 1080p do not.
    await startLocalRemux(
      item({
        MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: 3_640_000 }],
        streams: [
          { Type: "Video", Codec: "h264", Index: 0, VideoRangeType: "SDR", Width: 1280, Height: 720, BitRate: 3_000_000 },
          { Type: "Audio", Codec: "ac3", Index: 1, Channels: 6, BitRate: 640_000 },
        ],
      }),
    );
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.tiers.map((t: { width: number }) => t.width)).toEqual([256, 256, 426, 640, 854]);
  });

  it("keeps real HDR on the original while offering the SDR server ladder", async () => {
    await startLocalRemux(
      item({
        MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: 20_000_000 }],
        streams: [
          { Type: "Video", Codec: "hevc", Index: 0, VideoRangeType: "HDR10", Width: 3840, Height: 2160, BitRate: 20_000_000 },
          { Type: "Audio", Codec: "eac3", Index: 1, Channels: 6, BitRate: 640_000 },
        ],
      }),
    );

    const config = mockStartRemux.mock.calls[0][0];
    expect(config.tiers).toHaveLength(7);
    expect(config.tiers.every((tier: { codecs: string }) => tier.codecs.startsWith("avc1."))).toBe(true);
    expect(config.videoRange).toBe("PQ");
    expect(config.primaryVideoCodecs).toMatch(/^hvc1\./);
    expect(config.primaryVideoBandwidth).toBe(20_000_000);
    expect(config.audioTracks[0].serverAudioUrl).toContain("AudioStreamIndex=1");
  });
});

describe("slipstreamTierBandwidth", () => {
  const tierItem = (streams: unknown[]) =>
    item({
      MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: 20_000_000 }],
      streams: [{ Type: "Video", Codec: "h264", Index: 0, VideoRangeType: "SDR", Width: 1280, Height: 720, BitRate: 20_000_000 }, ...streams],
    });

  // The cap is the TOP offered rung (1080p, 6 Mbps) plus the AAC audio-lo group, so AVPlayer's ABR
  // may use every server rung but not the 20 Mbps primary.
  it("caps at the top rung plus the audio group it rides", () => {
    const withTwoTracks = tierItem([
      { Type: "Audio", Codec: "dts", Index: 1, Channels: 7, SampleRate: 48000, BitDepth: 24 },
      { Type: "Audio", Codec: "aac", Index: 2, BitRate: 256_000 },
    ]);
    // The cap is the same whichever track leads: every rung rides audio-lo.
    expect(slipstreamTierBandwidth(withTwoTracks, 2)).toBe(6_000_000 + 96_000 + 24_000);
    expect(slipstreamTierBandwidth(withTwoTracks)).toBe(6_000_000 + 96_000 + 24_000);
  });

  it("offers the ladder with a server-backed track first in the complete catalogue", () => {
    const uncarriableFirst = tierItem([
      { Type: "Audio", Codec: "dsd_lsbf", Index: 1, Channels: 2, SampleRate: 44100, BitDepth: 24 },
      { Type: "Audio", Codec: "ac3", Index: 2, BitRate: 640_000 },
    ]);
    expect(slipstreamTierBandwidth(uncarriableFirst)).toBe(6_000_000 + 96_000 + 24_000);
  });
});

describe("dolbyVisionSupplementalCodecs", () => {
  const dv = (over: Record<string, unknown> = {}) =>
    ({
      Type: "Video",
      Codec: "hevc",
      Index: 0,
      DvProfile: 8,
      DvLevel: 6,
      DvBlSignalCompatibilityId: 1,
      RpuPresentFlag: 1,
      ElPresentFlag: 0,
      BlPresentFlag: 1,
      ...over,
    }) as JellyfinMediaStream;

  it("advertises profile 8.1 as PQ-compatible Dolby Vision", () => {
    expect(dolbyVisionSupplementalCodecs(dv(), true)).toBe("dvh1.08.06/db1p");
  });

  it("advertises profile 8.4 as HLG-compatible Dolby Vision", () => {
    expect(dolbyVisionSupplementalCodecs(dv({ DvBlSignalCompatibilityId: 4 }), true)).toBe("dvh1.08.06/db4h");
  });

  it("zero-pads the level and falls back to 06 when Jellyfin reports none", () => {
    expect(dolbyVisionSupplementalCodecs(dv({ DvLevel: 9 }), true)).toBe("dvh1.08.09/db1p");
    expect(dolbyVisionSupplementalCodecs(dv({ DvLevel: 13 }), true)).toBe("dvh1.08.13/db1p");
    expect(dolbyVisionSupplementalCodecs(dv({ DvLevel: 0 }), true)).toBe("dvh1.08.06/db1p");
  });

  // A re-encode drops the RPU, so the attribute would outlive the metadata.
  it("says nothing when the engine re-encodes the video", () => {
    expect(dolbyVisionSupplementalCodecs(dv(), false)).toBe("");
  });

  // Profile 5 is IPT-PQ-C2 with no HDR10 base, so nothing can be claimed for it.
  it("says nothing for profiles that are not backward compatible", () => {
    expect(dolbyVisionSupplementalCodecs(dv({ DvProfile: 5 }), true)).toBe("");
    expect(dolbyVisionSupplementalCodecs(dv({ ElPresentFlag: 1 }), true)).toBe("");
  });

  // DolbyVisionConverter rewrites the RPUs during the copy, so what arrives is 8.1.
  // A real disc rip carries compatibility id 6, which the conversion replaces with 1.
  it("advertises a converted profile 7 as 8.1, whatever the source compatibility id", () => {
    expect(dolbyVisionSupplementalCodecs(dv({ DvProfile: 7, ElPresentFlag: 1 }), true)).toBe("dvh1.08.06/db1p");
    expect(dolbyVisionSupplementalCodecs(dv({ DvProfile: 7, ElPresentFlag: 1, DvBlSignalCompatibilityId: 6, DvLevel: 9 }), true)).toBe("dvh1.08.09/db1p");
  });

  // The conversion needs an RPU to rewrite, and a re-encode would drop it anyway.
  it("says nothing for a profile 7 with no RPU or through the transcoder", () => {
    expect(dolbyVisionSupplementalCodecs(dv({ DvProfile: 7, RpuPresentFlag: 0 }), true)).toBe("");
    expect(dolbyVisionSupplementalCodecs(dv({ DvProfile: 7, ElPresentFlag: 1 }), false)).toBe("");
  });

  it("says nothing without an RPU or with an unknown compatibility id", () => {
    expect(dolbyVisionSupplementalCodecs(dv({ RpuPresentFlag: 0 }), true)).toBe("");
    expect(dolbyVisionSupplementalCodecs(dv({ DvBlSignalCompatibilityId: 0 }), true)).toBe("");
    expect(dolbyVisionSupplementalCodecs(dv({ DvBlSignalCompatibilityId: 2 }), true)).toBe("");
  });

  it("says nothing for an ordinary HDR10 or SDR stream", () => {
    expect(dolbyVisionSupplementalCodecs({ Type: "Video", Codec: "hevc", Index: 0 } as JellyfinMediaStream, true)).toBe("");
    expect(dolbyVisionSupplementalCodecs(undefined, true)).toBe("");
  });
});

/**
 * T97 on the device: a Dolby Vision profile 8.1 source with no audio track at all. What the
 * engine is handed here is what lands in the master playlist AVFoundation reads.
 */
describe("startLocalRemux for a video-only Dolby Vision source", () => {
  const dolbyVisionOnly = () =>
    item({
      streams: [
        {
          Type: "Video",
          Codec: "hevc",
          Index: 0,
          Width: 256,
          Height: 144,
          BitDepth: 10,
          Level: 30,
          Profile: "Main 10",
          VideoRangeType: "DOVIWithHDR10",
          DvProfile: 8,
          DvLevel: 1,
          DvBlSignalCompatibilityId: 1,
          RpuPresentFlag: 1,
          ElPresentFlag: 0,
          BlPresentFlag: 1,
        },
      ],
    });

  it("advertises Dolby Vision alongside an untouched CODECS", async () => {
    await startLocalRemux(dolbyVisionOnly());
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.supplementalCodecs).toBe("dvh1.08.01/db1p");
    expect(config.videoRange).toBe("PQ");
  });

  // A variant that names a codec the stream does not contain is a claim AVFoundation
  // validates against the media, and the file carries no audio whatsoever.
  it("does not name an audio codec when the source has no audio", async () => {
    await startLocalRemux(dolbyVisionOnly());
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.codecs).not.toContain("fLaC");
  });
});

describe("device decode support: a box with no HEVC decoder", () => {
  /** A fresh module per answer, since videoDecodeSupport() caches for the process. */
  function withDevice(support: VideoDecodeSupport): typeof import("../localRemux") {
    jest.resetModules();
    mockDecodeSupport.mockResolvedValue(support);
    return require("../localRemux") as typeof import("../localRemux");
  }
  const hevc10 = (extra: Record<string, unknown> = {}) =>
    item({
      streams: [
        { Type: "Video", Codec: "hevc", Index: 0, Width: 1920, Height: 1038, BitDepth: 10, Level: 120, Profile: "Main 10", ...extra },
        { Type: "Audio", Codec: "aac", Index: 1 },
      ],
    });

  it("still takes the file, re-encoding on device instead of copying", async () => {
    const remux = withDevice({ hevc: false, hevcMain10: false, av1: false, h264MaxHeight: null, hevcMaxHeight: null });
    await expect(remux.canRemuxLocally(hevc10())).resolves.toBe(true);
    await expect(remux.predictPlaybackLane(hevc10())).resolves.toMatchObject({ lane: "deviceTranscode" });
  });

  it("copies 8-bit HEVC where only Main 10 is missing", async () => {
    const remux = withDevice({ hevc: true, hevcMain10: false, av1: false, h264MaxHeight: null, hevcMaxHeight: null });
    const eightBit = item({
      streams: [
        { Type: "Video", Codec: "hevc", Index: 0, BitDepth: 8 },
        { Type: "Audio", Codec: "aac", Index: 1 },
      ],
    });
    await expect(remux.predictPlaybackLane(eightBit)).resolves.toMatchObject({ lane: "copy" });
    await expect(remux.predictPlaybackLane(hevc10())).resolves.toMatchObject({ lane: "deviceTranscode" });
  });

  // The encoder emits 8-bit H.264 there, so the variant must not claim hvc1 or PQ.
  it("declares an SDR variant with no HEVC tag for an HDR source it must flatten", async () => {
    const remux = withDevice({ hevc: false, hevcMain10: false, av1: false, h264MaxHeight: null, hevcMaxHeight: null });
    await remux.startLocalRemux(hevc10({ VideoRangeType: "HDR10" }));
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.videoRange).toBe("SDR");
    expect(config.codecs).not.toContain("hvc1");
    expect(config.supplementalCodecs).toBe("");
  });

  it("keeps the HDR declaration where the device decodes Main 10", async () => {
    const remux = withDevice({ hevc: true, hevcMain10: true, av1: false, h264MaxHeight: null, hevcMaxHeight: null });
    await remux.startLocalRemux(hevc10({ VideoRangeType: "HDR10" }));
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.videoRange).toBe("PQ");
    expect(config.codecs).toContain("hvc1.2.4.L120.B0");
  });
});

describe("engine throughput: the session's own clock", () => {
  const sample = (over: Partial<ThroughputSample>): ThroughputSample => ({
    token: "t",
    generation: 0,
    segment: 1,
    produceSeconds: 3,
    segmentSeconds: 6,
    cushion: 4,
    throttled: false,
    thermal: "nominal",
    ...over,
  });

  it("belowRealtime: a segment that took longer to make than it plays", () => {
    expect(belowRealtime({ produceSeconds: 7, segmentSeconds: 6 })).toBe(true);
    expect(belowRealtime({ produceSeconds: 6, segmentSeconds: 6 })).toBe(false);
    expect(belowRealtime({ segmentSeconds: 6 })).toBe(false); // untimed: a generation's first
  });

  it("readBound: the segment's wall time went to waiting on the input", () => {
    expect(readBound({ produceSeconds: 12, readSeconds: 10 })).toBe(true);
    expect(readBound({ produceSeconds: 12, readSeconds: 7.2 })).toBe(true);
    expect(readBound({ produceSeconds: 12, readSeconds: 5 })).toBe(false);
    expect(readBound({ produceSeconds: 12 })).toBe(false); // an engine build without the measurement
    expect(readBound({ readSeconds: 10 })).toBe(false); // untimed: a generation's first
  });

  it("engineStarving: two slow unthrottled segments with nothing ahead of the player", () => {
    expect(engineStarving([sample({ segment: 1, produceSeconds: 8, cushion: 2 }), sample({ segment: 2, produceSeconds: 9, cushion: 1 })])).toBe(true);
    expect(engineStarving([sample({ segment: 1, produceSeconds: 8, cushion: 1 }), sample({ segment: 2, produceSeconds: 9, cushion: 0 })])).toBe(true);
  });

  it("engineStarving: not on one slow segment, a full cushion, or a throttled producer", () => {
    expect(engineStarving([sample({ produceSeconds: 9, cushion: 0 })])).toBe(false);
    expect(engineStarving([sample({ segment: 1, produceSeconds: 8, cushion: 5 }), sample({ segment: 2, produceSeconds: 9, cushion: 5 })])).toBe(false);
    // The producer slept on its read-ahead cap: that segment's time is the cap, not the decode.
    expect(engineStarving([sample({ segment: 1, produceSeconds: 8, throttled: true, cushion: 1 }), sample({ segment: 2, produceSeconds: 9, cushion: 1 })])).toBe(false);
    expect(engineStarving([])).toBe(false);
  });

  it("engineStarving: a seek restart starts the count over", () => {
    expect(engineStarving([sample({ generation: 0, segment: 4, produceSeconds: 8, cushion: 1 }), sample({ generation: 1, segment: 9, produceSeconds: 9, cushion: 1 })])).toBe(false);
    expect(
      engineStarving([
        sample({ generation: 0, segment: 4, produceSeconds: 8, cushion: 1 }),
        sample({ generation: 1, segment: 9, segmentSeconds: 6, produceSeconds: undefined, cushion: 1 }),
        sample({ generation: 1, segment: 10, produceSeconds: 9, cushion: 1 }),
        sample({ generation: 1, segment: 11, produceSeconds: 9, cushion: 0 }),
      ]),
    ).toBe(true);
  });
});

/**
 * The item page's engine line is built from `smallFeedFirst` alone, so each half of the rule
 * it states gets a case. The remembered link in this suite is 3 Mb/s.
 */
describe("predictPlaybackLane: the smaller server feed", () => {
  // The item page says "starts on a smaller server feed" from this flag alone, so each half of
  // the rule it states gets a case. The remembered link in this suite is 3 Mb/s.
  const withBitrates = (sourceBps: number, videoBps: number, extra: Record<string, unknown> = {}) =>
    item({
      MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: sourceBps }],
      streams: [
        { Type: "Video", Codec: "h264", Index: 0, BitRate: videoBps, VideoRangeType: "SDR", ...extra },
        { Type: "Audio", Codec: "aac", Index: 1, BitRate: 192_000, Channels: 2, SampleRate: 48_000 },
      ],
    } as never);

  it("opens on the smaller server feed when the link sits below the file and the tier undercuts it", async () => {
    await expect(predictPlaybackLane(withBitrates(8_000_000, 7_000_000))).resolves.toEqual({ lane: "copy", smallFeedFirst: true });
  });

  it("keeps the whole file when the link carries it", async () => {
    await expect(predictPlaybackLane(withBitrates(2_000_000, 1_800_000))).resolves.toEqual({ lane: "copy", smallFeedFirst: false });
  });

  it("uses the multiplexed stream sum when the top-level source bitrate is absent", async () => {
    await expect(predictPlaybackLane(withBitrates(0, 7_000_000))).resolves.toEqual({ lane: "copy", smallFeedFirst: true });
  });

  it("does not infer a source rate from audio alone when video bitrate is unknown", async () => {
    await expect(predictPlaybackLane(withBitrates(0, 0))).resolves.toEqual({ lane: "copy", smallFeedFirst: false });
  });

  it("offers a smaller feed for an HDR file on a thin link", async () => {
    await expect(predictPlaybackLane(withBitrates(8_000_000, 7_000_000, { VideoRangeType: "HDR10" }))).resolves.toMatchObject({ smallFeedFirst: true });
  });

  it("offers a smaller feed even for an audio-heavy file: the rungs carry cheap AAC, not the source audio", async () => {
    // Small video, DTS→FLAC audio (~4.84M): the primary is audio-dominated, but the rungs carry the
    // low AAC audio-lo group, so 240p + 96k undercuts and a smaller feed is offered.
    const audioHeavy = item({
      MediaSources: [{ Id: "item1", Container: "mkv", Bitrate: 5_740_000 }],
      streams: [
        { Type: "Video", Codec: "h264", Index: 0, BitRate: 900_000, VideoRangeType: "SDR" },
        { Type: "Audio", Codec: "dts", Index: 1, Channels: 7, SampleRate: 48000, BitDepth: 24 },
      ],
    } as never);
    await expect(predictPlaybackLane(audioHeavy)).resolves.toEqual({ lane: "copy", smallFeedFirst: true });
  });
});

describe("startLocalRemux on a live channel", () => {
  const live = () =>
    item({
      RunTimeTicks: undefined,
      // The mocked link (3 Mbps) sits below this source: a VOD session would declare a tier.
      MediaSources: [{ Id: "c1", Container: "ts", IsInfiniteStream: true, LiveStreamId: "ls-1", Bitrate: 20_000_000 }],
      LiveStreamId: "ls-1",
      liveStreamUrl: "http://server:8096/LiveTv/LiveStreamFiles/x/stream.ts?ApiKey=k",
      streams: [
        { Type: "Video", Codec: "mpeg2video", Index: 0, Width: 1920, Height: 1080, BitDepth: 8 },
        { Type: "Audio", Codec: "mp2", Index: 1 },
        { Type: "Subtitle", Codec: "dvbsub", Index: 2 },
      ],
    });

  it("hands the engine the opened stream in live mode: no runtime, no tier, image subtitles only, no offset", async () => {
    await startLocalRemux(live(), undefined, 120);
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.isLive).toBe(true);
    expect(config.liveSegmentSeconds).toBe(2);
    expect(config.inputUrl).toBe("http://server:8096/LiveTv/LiveStreamFiles/x/stream.ts?ApiKey=k");
    expect(config.durationSeconds).toBe(0);
    expect(config.startOffsetSeconds).toBe(0);
    // The DVB track rides as an image rendition the app draws; a text track would not (below).
    expect(config.subtitles.map((sub: { index: number; isImage: boolean }) => [sub.index, sub.isImage])).toEqual([[2, true]]);
    expect(config.tierPlaylistUrl).toBeUndefined();
    expect(config.tiers).toEqual([]);
    expect(config.httpHeaders).toBeUndefined();
    // Read through the server's open, not from an origin: nothing for the engine to check.
    expect(config.probeOrigin).toBeUndefined();
  });

  it("asks the engine to check an origin the channel is read from directly", async () => {
    const origin = { ...live(), MediaSources: [{ Id: "c1", IsInfiniteStream: true }], LiveStreamId: undefined, liveStreamUrl: "https://origin.example/live/high/index.m3u8" };
    await startLocalRemux(origin, undefined, 120);
    expect(mockStartRemux.mock.calls[0][0].probeOrigin).toBe(true);
  });

  it("carries no text subtitle on a live channel: the engine has no sliding WebVTT window for it", async () => {
    const channel = live();
    channel.MediaStreams = [...(channel.MediaStreams ?? []).filter((stream) => stream.Type !== "Subtitle"), { Type: "Subtitle", Codec: "subrip", Index: 2 } as never];
    await startLocalRemux(channel, undefined, 120);
    expect(mockStartRemux.mock.calls[0][0].subtitles).toEqual([]);
  });

  it("validates only the image subset that a live session publishes", async () => {
    const channel = live();
    channel.MediaStreams = [...(channel.MediaStreams ?? []), { Type: "Subtitle", Codec: "subrip", IsExternal: true }, { Type: "Subtitle", Codec: "subrip", Index: 2 }];
    await startLocalRemux(channel);
    expect(mockStartRemux.mock.calls[0][0].subtitles.map((subtitle: { index: number }) => subtitle.index)).toEqual([2]);
  });

  it("hands the engine the origin's required headers for a manifest channel", async () => {
    const manifest = { ...live(), liveStreamUrl: "https://origin.example/playlist.m3u8", liveHttpHeaders: { "User-Agent": "Mozilla/5.0" } };
    await startLocalRemux(manifest, undefined, 120);
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.inputUrl).toBe("https://origin.example/playlist.m3u8");
    expect(config.httpHeaders).toEqual({ "User-Agent": "Mozilla/5.0" });
  });

  it("reads a recording still being written from the static stream, in live mode", async () => {
    const recording = item({ RunTimeTicks: undefined, MediaSources: [{ Id: "r1", IsInfiniteStream: true }] });
    await startLocalRemux(recording);
    const config = mockStartRemux.mock.calls[0][0];
    expect(config.isLive).toBe(true);
    expect(config.inputUrl).toMatch(/\/Videos\/[^/]+\/stream/);
    expect(config.durationSeconds).toBe(0);
    expect(config.probeOrigin).toBeUndefined();
  });

  it("predicts the engine lane for a live channel with no verdict lookup", async () => {
    await expect(predictPlaybackLane(live())).resolves.toEqual({ lane: "deviceTranscode", smallFeedFirst: false });
  });
});
