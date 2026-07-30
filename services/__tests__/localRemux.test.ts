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
  getVideoStreamUrl: (id: string) => `http://server:8096/Videos/${id}/stream?Static=true&api_key=k`,
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

  it("rejects codecs AVPlayer cannot decode", async () => {
    const vp9 = item({
      streams: [
        { Type: "Video", Codec: "vp9", Index: 0 },
        { Type: "Audio", Codec: "opus", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(vp9, false)).resolves.toBe(false);
  });

  // The audio stream is copied verbatim, so an undecodable track would play as
  // silence; these files belong on the server path that downmixes them.
  // dts/truehd/opus/vorbis: AVPlayer can't decode them. ac3/eac3: the mp4
  // muxer can't write their dac3/dec3 box without first seeing a packet.
  it.each(["dts", "truehd", "opus", "vorbis", "ac3", "eac3"])("rejects %s audio even when the video would remux", async (audioCodec) => {
    const uncarriableAudio = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: audioCodec, Index: 1 },
      ],
    });
    await expect(canRemuxLocally(uncarriableAudio, false)).resolves.toBe(false);
  });

  it.each(["aac", "alac", "mp3"])("accepts %s audio", async (audioCodec) => {
    const decodableAudio = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: audioCodec, Index: 1 },
      ],
    });
    await expect(canRemuxLocally(decodableAudio, false)).resolves.toBe(true);
  });

  it("rejects multi-audio files so seamless switching keeps the server path", async () => {
    const multi = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: "aac", Index: 1 },
        { Type: "Audio", Codec: "aac", Index: 2 },
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
        inputUrl: "http://server:8096/Videos/item1/stream?Static=true&api_key=k",
        audioStreamIndex: 1,
        durationSeconds: 3600,
      }),
    );
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
});
