/**
 * Mounts useVideoPlayback for real and drives it through the wiring the extracted-function
 * suites cannot reach: lane selection against live refs, the CREATING_STREAM effect that
 * builds each lane's URL, and session teardown on unmount.
 *
 * Rendered with react-test-renderer through a null-rendering harness that exposes the hook's
 * return value via a ref (the project's hook-testing pattern).
 */
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useVideoPlayback, type VideoPlaybackConfig, type VideoPlaybackResult } from "@/hooks/useVideoPlayback";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { fetchVideoDetails, getTranscodingStreamUrl, getVideoStreamUrl, needsTranscoding } from "@/services/jellyfinApi";
import { canRemuxLocally, startFrameProvider, startLocalRemux, stopFrameProvider, stopLocalRemux, stopPlaylistShim } from "@/services/localRemux";
import { Platform } from "react-native";
import { rememberedBitrate } from "@/services/jellyfin/bitrateTest";

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/services/audioPlayerManager", () => ({ audioPlayerManager: { stop: jest.fn(() => Promise.resolve()) } }));
jest.mock("@/hooks/usePlaybackReporter", () => ({
  usePlaybackReporter: () => ({ markStarted: jest.fn(), markEnded: jest.fn(), reportPauseChange: jest.fn(), resetSession: jest.fn() }),
}));

jest.mock("@/services/jellyfinApi", () => ({
  JELLYFIN_TIME: { TICKS_PER_SECOND: 10_000_000 },
  fetchVideoDetails: jest.fn(),
  needsTranscoding: jest.fn(() => false),
  isAudioOnly: jest.fn(() => false),
  audioNeedsRewrap: jest.fn(() => false),
  getTextSubtitleStreams: jest.fn(() => []),
  getBurnInSubtitleStream: jest.fn(() => null),
  isImageBasedSubtitleCodec: jest.fn(() => false),
  getVideoStreamUrl: jest.fn(() => "https://server/Videos/id/stream.mkv"),
  getTranscodingStreamUrl: jest.fn(() => Promise.resolve("https://server/Videos/id/master.m3u8")),
  isDemoMode: jest.fn(() => false),
  connectToDemoServer: jest.fn(),
  refreshConfig: jest.fn(() => Promise.resolve()),
  getConfig: jest.fn(() => Promise.resolve({ apiKey: "key", serverUrl: "https://server", userId: "user" })),
  generatePlaySessionId: jest.fn(() => "session-1"),
}));

jest.mock("@/services/localRemux", () => ({
  canRemuxLocally: jest.fn(() => Promise.resolve(false)),
  deficitExceedsCushion: jest.fn(() => false),
  localRemuxToken: jest.fn((url: string) => `token:${url}`),
  resolveSubtitlePick: jest.fn(() => null),
  sessionBaseUrl: jest.fn((url: string) => url.slice(0, url.lastIndexOf("/") + 1)),
  slipstreamEligible: jest.fn(() => false),
  slipstreamTierBandwidth: jest.fn(() => null),
  startFrameProvider: jest.fn(() => Promise.resolve("http://127.0.0.1:9999/frame-1/")),
  startLocalRemux: jest.fn(() => Promise.resolve("http://127.0.0.1:9999/s/abc/master.m3u8")),
  startPlaylistShim: jest.fn(() => Promise.resolve(null)),
  stopFrameProvider: jest.fn(),
  stopLocalRemux: jest.fn(),
  stopPlaylistShim: jest.fn(),
  subtitleRenditions: jest.fn(() => []),
}));

jest.mock("@/services/multiAudioLoader", () => ({
  prepareMultiAudioPlayback: jest.fn(() => Promise.resolve("jellyfin-multi://session")),
  shouldUseMultiAudio: jest.fn(() => false),
  isMultiAudioAvailable: jest.fn(() => false),
  getAudioTracks: jest.fn(() => []),
}));

jest.mock("@/services/playbackProbe", () => ({ setPlaybackProbeEnabled: jest.fn(), probeEmit: jest.fn(), probeFirstPlaying: jest.fn(), probeProgress: jest.fn(), sourceSummary: jest.fn(() => ({})) }));

jest.mock("@/services/subtitlePreference", () => ({
  getSubtitlePreferenceSync: jest.fn(() => ({ kind: "system" })),
  nextPreference: jest.fn((p: unknown) => p),
  observedFromReport: jest.fn(() => null),
  saveSubtitlePreference: jest.fn(),
  selectedTextTrackFor: jest.fn(() => ({ type: "system" })),
}));

jest.mock("@/services/jellyfin/bitrateTest", () => ({ measureServerBitrate: jest.fn(() => Promise.resolve(null)), rememberedBitrate: jest.fn(() => Promise.resolve(null)) }));
jest.mock("@/services/jellyfin/session", () => ({ getQualitySettings: jest.fn(() => Promise.resolve({ mode: "auto", index: 5, label: "Original" })) }));

const mockDetails = fetchVideoDetails as jest.Mock;
const mockNeedsTranscoding = needsTranscoding as jest.Mock;
const mockCanRemux = canRemuxLocally as jest.Mock;
const mockStartLocalRemux = startLocalRemux as jest.Mock;
const mockStopLocalRemux = stopLocalRemux as jest.Mock;
const mockDirectUrl = getVideoStreamUrl as jest.Mock;
const mockTranscodeUrl = getTranscodingStreamUrl as jest.Mock;
const mockRememberedBitrate = rememberedBitrate as jest.Mock;

function videoItem(overrides: Partial<JellyfinVideoItem> = {}): JellyfinVideoItem {
  return {
    Id: "video-1",
    Name: "Test Video",
    Type: "Video",
    RunTimeTicks: 36_000_000_000,
    MediaSources: [{ Id: "source-1", Container: "mkv", Bitrate: 8_000_000 }],
    MediaStreams: [{ Type: "Video", Index: 0, Codec: "h264" }],
    ...overrides,
  } as JellyfinVideoItem;
}

type HookRef = { get: () => VideoPlaybackResult };

const Harness = forwardRef<HookRef, VideoPlaybackConfig>(function Harness(config, ref) {
  const result = useVideoPlayback(config);
  useImperativeHandle(ref, () => ({ get: () => result }), [result]);
  return null;
});

/** Mounts the hook and flushes the metadata fetch plus the stream-creation effect. */
async function mount(config: VideoPlaybackConfig) {
  const ref = React.createRef<HookRef>();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<Harness ref={ref} {...config} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { ref, renderer };
}

describe("useVideoPlayback (mounted)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDetails.mockResolvedValue(videoItem());
    mockNeedsTranscoding.mockReturnValue(false);
    mockCanRemux.mockResolvedValue(false);
    mockRememberedBitrate.mockResolvedValue(null);
    mockDirectUrl.mockReturnValue("https://server/Videos/id/stream.mkv");
    mockTranscodeUrl.mockResolvedValue("https://server/Videos/id/master.m3u8");
    mockStartLocalRemux.mockResolvedValue("http://127.0.0.1:9999/s/abc/master.m3u8");
  });

  describe("skip", () => {
    it("holds IDLE and fetches nothing", async () => {
      const { ref } = await mount({ videoId: "video-1", skip: true });

      expect(ref.current!.get().state).toEqual({ type: "IDLE" });
      expect(mockDetails).not.toHaveBeenCalled();
      expect(ref.current!.get().sourceUri).toBeNull();
    });
  });

  describe("lane selection", () => {
    it("direct-plays a supported file and never starts an engine session", async () => {
      const { ref } = await mount({ videoId: "video-1" });

      const result = ref.current!.get();
      expect(result.state).toEqual({ type: "INITIALIZING_PLAYER", mode: "direct", streamUrl: "https://server/Videos/id/stream.mkv" });
      expect(result.sourceUri).toBe("https://server/Videos/id/stream.mkv");
      expect(mockStartLocalRemux).not.toHaveBeenCalled();
      expect(mockTranscodeUrl).not.toHaveBeenCalled();
    });

    it("routes an unsupported file the engine can take to local remux", async () => {
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);

      const { ref } = await mount({ videoId: "video-1" });

      const result = ref.current!.get();
      expect(result.state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "localRemux" });
      expect(result.sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
      expect(mockTranscodeUrl).not.toHaveBeenCalled();
    });

    it("falls back to the server when the engine cannot take the file", async () => {
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(false);

      const { ref } = await mount({ videoId: "video-1" });

      const result = ref.current!.get();
      expect(result.state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "transcode" });
      expect(result.sourceUri).toBe("https://server/Videos/id/master.m3u8");
      expect(mockStartLocalRemux).not.toHaveBeenCalled();
    });

    it("falls back to the server when the engine session throws", async () => {
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      mockStartLocalRemux.mockRejectedValue(new Error("engine unavailable"));

      const { ref } = await mount({ videoId: "video-1" });

      // The URL is the server's, while state.mode still reads localRemux: the fallback
      // happens inside the effect, after CREATING_STREAM fixed the lane.
      const result = ref.current!.get();
      expect(result.sourceUri).toBe("https://server/Videos/id/master.m3u8");
      expect(result.state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "localRemux" });
    });

    it("routes a direct-playable file off direct play when the link measures under the source", async () => {
      mockRememberedBitrate.mockResolvedValue(4_000_000); // source is 8 Mbps
      mockCanRemux.mockResolvedValue(true);

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().state).toMatchObject({ mode: "localRemux" });
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
    });

    it("keeps direct play when the link carries the source", async () => {
      mockRememberedBitrate.mockResolvedValue(20_000_000);
      mockCanRemux.mockResolvedValue(true);

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().state).toMatchObject({ mode: "direct" });
      expect(mockStartLocalRemux).not.toHaveBeenCalled();
    });
  });

  describe("chapter frames", () => {
    const setTV = (value: boolean) => Object.defineProperty(Platform, "isTV", { configurable: true, value });
    beforeEach(() => setTV(true));
    afterEach(() => setTV(false));

    it("starts a frame provider over the original file on the direct lane and stops it on unmount", async () => {
      mockDetails.mockResolvedValue(videoItem({ Chapters: [{ StartPositionTicks: 0, Name: "One" }] }));
      const { ref, renderer } = await mount({ videoId: "video-1" });

      expect(startFrameProvider).toHaveBeenCalledWith("https://server/Videos/id/stream.mkv", "video-1");
      expect(ref.current!.get().chapterFrameBaseUrl).toBe("http://127.0.0.1:9999/frame-1/");

      await act(async () => {
        renderer.unmount();
      });

      expect(stopFrameProvider).toHaveBeenCalledWith("token:http://127.0.0.1:9999/frame-1/");
    });

    it("starts no provider for an item without chapters", async () => {
      const { ref } = await mount({ videoId: "video-1" });

      expect(startFrameProvider).not.toHaveBeenCalled();
      expect(ref.current!.get().chapterFrameBaseUrl).toBeNull();
    });

    it("uses the engine session's own directory on the remux lane", async () => {
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);

      const { ref } = await mount({ videoId: "video-1" });

      expect(startFrameProvider).not.toHaveBeenCalled();
      expect(ref.current!.get().chapterFrameBaseUrl).toBe("http://127.0.0.1:9999/s/abc/");
    });

    it("makes no frames off a TV", async () => {
      setTV(false);

      const { ref } = await mount({ videoId: "video-1" });

      expect(startFrameProvider).not.toHaveBeenCalled();
      expect(ref.current!.get().chapterFrameBaseUrl).toBeNull();
    });
  });

  describe("stale runs", () => {
    const setTV = (value: boolean) => Object.defineProperty(Platform, "isTV", { configurable: true, value });
    const flush = async () => {
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
    };
    afterEach(() => setTV(false));

    it("a run gone stale during its awaits never stops the provider the live run holds", async () => {
      setTV(true);
      let n = 0;
      (startFrameProvider as jest.Mock).mockImplementation(() => Promise.resolve(`http://127.0.0.1:9999/frame-${++n}/`));
      mockDetails.mockImplementation(async (id: string) => videoItem({ Id: id, Chapters: [{ StartPositionTicks: 0, Name: "One" }] }));
      mockNeedsTranscoding.mockImplementation((details: JellyfinVideoItem) => details.Id === "video-1");
      let resolveA: (url: string) => void = () => {};
      mockTranscodeUrl.mockImplementationOnce(() => new Promise<string>((resolve) => (resolveA = resolve)));

      const { ref, renderer } = await mount({ videoId: "video-1" });
      await act(flush);
      expect(startFrameProvider).not.toHaveBeenCalled();

      await act(async () => {
        renderer.update(<Harness ref={ref} videoId="video-2" />);
      });
      await act(flush);
      expect(startFrameProvider).toHaveBeenCalledTimes(1);
      expect(ref.current!.get().chapterFrameBaseUrl).toBe("http://127.0.0.1:9999/frame-1/");

      await act(async () => {
        resolveA("https://server/Videos/id/master.m3u8");
      });
      await act(flush);
      expect(startFrameProvider).toHaveBeenCalledTimes(1);
      expect(stopFrameProvider).not.toHaveBeenCalledWith("token:http://127.0.0.1:9999/frame-1/");
      expect(ref.current!.get().chapterFrameBaseUrl).toBe("http://127.0.0.1:9999/frame-1/");
      expect(ref.current!.get().sourceUri).toBe("https://server/Videos/id/stream.mkv");
    });

    it("an item change while the engine lane is starting starts nothing for the old item, and the stale session is stopped", async () => {
      mockDetails.mockImplementation(async (id: string) => videoItem({ Id: id }));
      mockNeedsTranscoding.mockImplementation((details: JellyfinVideoItem) => details.Id === "video-1");
      mockCanRemux.mockImplementation(async (details: JellyfinVideoItem) => details.Id === "video-1");
      let resolveA: (url: string) => void = () => {};
      mockStartLocalRemux.mockImplementationOnce(() => new Promise<string>((resolve) => (resolveA = resolve)));

      const { ref, renderer } = await mount({ videoId: "video-1" });
      await act(flush);
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);

      await act(async () => {
        renderer.update(<Harness ref={ref} videoId="video-2" />);
      });
      await act(flush);
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
      expect(ref.current!.get().sourceUri).toBe("https://server/Videos/id/stream.mkv");

      await act(async () => {
        resolveA("http://127.0.0.1:9999/s/stale/master.m3u8");
      });
      await act(flush);
      expect(mockStopLocalRemux).toHaveBeenCalledWith("token:http://127.0.0.1:9999/s/stale/master.m3u8");
      expect(ref.current!.get().sourceUri).toBe("https://server/Videos/id/stream.mkv");
    });
  });

  describe("session teardown", () => {
    it("stops the engine session this player started when it unmounts", async () => {
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);

      const { renderer } = await mount({ videoId: "video-1" });
      expect(mockStopLocalRemux).not.toHaveBeenCalled();

      await act(async () => {
        renderer.unmount();
      });

      expect(mockStopLocalRemux).toHaveBeenCalledWith("token:http://127.0.0.1:9999/s/abc/master.m3u8");
      expect(stopPlaylistShim).toHaveBeenCalled();
    });

    it("starts no session to stop on the direct lane", async () => {
      const { renderer } = await mount({ videoId: "video-1" });

      await act(async () => {
        renderer.unmount();
      });

      expect(mockStopLocalRemux).toHaveBeenCalledWith(null);
    });
  });

  describe("player callbacks", () => {
    it("reaches PLAYING through onLoad and onProgress", async () => {
      const { ref } = await mount({ videoId: "video-1" });

      await act(async () => {
        ref.current!.get().videoCallbacks.onLoad({ duration: 120, currentTime: 0, naturalSize: { width: 1920, height: 1080, orientation: "landscape" } } as never);
      });
      expect(ref.current!.get().state).toMatchObject({ type: "READY", mode: "direct" });

      // PLAYER_PLAYING rides the paused edge, so unpause before the tick.
      await act(async () => {
        ref.current!.get().play();
      });
      expect(ref.current!.get().paused).toBe(false);

      await act(async () => {
        ref.current!.get().videoCallbacks.onProgress({ currentTime: 3, playableDuration: 30, seekableDuration: 120 } as never);
        await new Promise((resolve) => setImmediate(resolve));
      });
      expect(ref.current!.get().state).toMatchObject({ type: "PLAYING", mode: "direct" });
      expect(ref.current!.get().currentTimeRef.current).toBe(3);
    });

    it("auto-plays once the player loads", async () => {
      jest.useFakeTimers();
      try {
        const { ref } = await mount({ videoId: "video-1" });

        await act(async () => {
          ref.current!.get().videoCallbacks.onLoad({ duration: 120, currentTime: 0, naturalSize: { width: 1920, height: 1080, orientation: "landscape" } } as never);
        });
        expect(ref.current!.get().paused).toBe(true);

        // Auto-play is a setTimeout then a setImmediate, so play() lands clear of onLoad.
        await act(async () => {
          jest.runAllTimers();
        });
        expect(ref.current!.get().paused).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it("marks a direct-play error retryable with transcode", async () => {
      const { ref } = await mount({ videoId: "video-1" });

      await act(async () => {
        ref.current!.get().videoCallbacks.onError({ error: { errorString: "boom", code: -11800 } } as never);
      });

      expect(ref.current!.get().state).toMatchObject({ type: "ERROR", canRetryWithTranscode: true });
    });
  });
});
