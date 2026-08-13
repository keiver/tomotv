import {
  canRemuxLocally,
  imagesAt,
  isLocalRemuxAvailable,
  localRemuxToken,
  resolveSubtitlePick,
  startLocalRemux,
  stopLocalRemux,
  subtitleRenditions,
  videoCodecTag,
  type ImageSubtitleEvent,
} from "../localRemux";
import type { JellyfinMediaStream, JellyfinVideoItem } from "@/types/jellyfin";

const mockStartRemux = jest.fn();
const mockStopRemux = jest.fn();
const mockIsAV1Supported = jest.fn();
/** Native event name -> handler, captured from the NativeEventEmitter mock. */
const mockListeners = new Map<string, (payload: unknown) => void>();

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  NativeModules: {
    LocalRemuxer: {
      startRemux: (...args: unknown[]) => mockStartRemux(...args),
      stopRemux: (...args: unknown[]) => mockStopRemux(...args),
      isAV1HardwareDecodeSupported: () => mockIsAV1Supported(),
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
jest.mock("@/services/playbackProbe", () => ({ probeEmit: (...args: unknown[]) => mockProbeEmit(...args) }));

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
    await expect(canRemuxLocally(item())).resolves.toBe(true);
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
      await expect(canRemuxLocally(exotic)).resolves.toBe(true);
    },
  );

  it("rejects transcodable codecs above the pixel gate (4K VP9)", async () => {
    const fourK = item({
      streams: [
        { Type: "Video", Codec: "vp9", Index: 0, Width: 3840, Height: 2160, BitDepth: 8 },
        { Type: "Audio", Codec: "opus", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(fourK)).resolves.toBe(false);
  });

  it("rejects 10-bit transcodable sources, since the encoder is 8-bit only", async () => {
    const tenBit = item({
      streams: [
        { Type: "Video", Codec: "vp9", Index: 0, Width: 1920, Height: 804, BitDepth: 10 },
        { Type: "Audio", Codec: "opus", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(tenBit)).resolves.toBe(false);
  });

  it("rejects interlaced transcodable sources, which need the server's deinterlacer", async () => {
    const interlaced = item({
      streams: [
        { Type: "Video", Codec: "mpeg2video", Index: 0, Width: 720, Height: 576, IsInterlaced: true },
        { Type: "Audio", Codec: "mp2", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(interlaced)).resolves.toBe(false);
  });

  it("rejects transcodable codecs with unknown dimensions, since the pixel gate cannot run", async () => {
    const sizeless = item({
      streams: [
        { Type: "Video", Codec: "vp9", Index: 0 },
        { Type: "Audio", Codec: "opus", Index: 1 },
      ],
    });
    await expect(canRemuxLocally(sizeless)).resolves.toBe(false);
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
    await expect(canRemuxLocally(undecodable)).resolves.toBe(false);
  });

  // Audio with no decoder in the linked FFmpeg build cannot be carried at all.
  it.each(["ralf", "qdm2", "sipr", "atrac3"])("rejects %s audio, which has no decoder", async (audioCodec) => {
    const uncarriableAudio = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: audioCodec, Index: 1 },
      ],
    });
    await expect(canRemuxLocally(uncarriableAudio)).resolves.toBe(false);
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

  it("rejects multi-audio when any track has no decoder", async () => {
    const multi = item({
      streams: [
        { Type: "Video", Codec: "h264", Index: 0 },
        { Type: "Audio", Codec: "aac", Index: 1 },
        { Type: "Audio", Codec: "qdm2", Index: 2 },
      ],
    });
    await expect(canRemuxLocally(multi)).resolves.toBe(false);
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

  it("gates AV1 on hardware decode support", async () => {
    const av1 = item({
      streams: [
        { Type: "Video", Codec: "av1", Index: 0 },
        { Type: "Audio", Codec: "aac", Index: 1 },
      ],
    });

    mockIsAV1Supported.mockResolvedValue(true);
    await expect(canRemuxLocally(av1)).resolves.toBe(true);
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

  // Both kinds become renditions. A text track resolves to Jellyfin's WebVTT;
  // an image track carries no URL at all, because Jellyfin has no WebVTT to give
  // for a bitmap — the engine decodes it out of the source file and the app
  // draws it. `isImage` is what tells the engine which is which.
  it("forwards text subtitles with a Jellyfin URL and image ones without", async () => {
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
    expect(subtitles[0]).toMatchObject({ index: 2, language: "eng", name: "English", isImage: false });
    expect(subtitles[0].vttUrl).not.toBe("");
    expect(subtitles[1]).toMatchObject({ index: 3, language: "spa", isImage: true, vttUrl: "" });
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

    const plan = {
      token: "abc",
      video: { streamIndex: 0, action: "copy", source: { codec: "h264", width: 1920, height: 1080 } },
      audio: [{ streamIndex: 1, rendition: "primary", action: "copy", source: { codec: "eac3", channels: 6, layout: "5.1(side)", profile: "Dolby Digital Plus + Dolby Atmos" } }],
    };
    handler!(plan);

    // The token is a per-session UUID and is deliberately left out, so the
    // recorded plan stays stable enough to pin as a baseline.
    expect(mockProbeEmit).toHaveBeenCalledWith("enginePlan", { video: plan.video, audio: plan.audio });
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
    const streams = [{ Type: "Video", Codec: "h264", Index: 0 }, { Type: "Audio", Codec: "aac", Index: 1 }, ...untaggedPgs(4, 2)];
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
    expect(videoCodecTag({ Codec: "hevc", Profile: "Main", Level: 120, Type: "Video" } as JellyfinMediaStream, true)).toBe("");
  });

  it("says nothing without a level, since half a tag is not a tag", () => {
    expect(videoCodecTag({ Codec: "h264", Profile: "High", Type: "Video" } as JellyfinMediaStream, true)).toBe("");
    expect(videoCodecTag({ Codec: "h264", Profile: "High", Level: -99, Type: "Video" } as JellyfinMediaStream, true)).toBe("");
    expect(videoCodecTag(undefined, true)).toBe("");
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

  // Quotes never survive into the playlist (Remuxer strips them before writing
  // NAME), so the label is matched as the manifest carries it, not as Jellyfin
  // titled it.
  it("matches the name the manifest carries, not the label with its quotes", () => {
    const group = reported(2).map((track) => ({ ...track, title: track.title.replace(/"/g, "") }));
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
