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
import { ENGINE_SEGMENT_DEADLINE_MS, VOD_OPEN_DEADLINE_MS } from "@/hooks/videoPlayback/constants";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import {
  closeLiveStream,
  fetchVideoDetails,
  getTranscodingStreamUrl,
  getVideoStreamUrl,
  isLiveSource,
  needsTranscoding,
  getTextSubtitleStreams,
  noteOpenFailed,
  openChannel,
  sourceIsHdr,
} from "@/services/jellyfinApi";
import {
  canRemuxLocally,
  isLocalRemuxAvailable,
  engineProgress,
  liveSubtitleRenditions,
  offeredTierBandwidths,
  resolveSubtitlePick,
  sessionSubtitleRenditions,
  startLocalRemux,
  startPlaylistShim,
  stopLocalRemux,
  stopPlaylistShim,
  slipstreamEligible,
  subscribeEngineLink,
} from "@/services/localRemux";
import { getQualitySettings } from "@/services/jellyfin/session";
import { Platform } from "react-native";
import { rememberedBitrate } from "@/services/jellyfin/bitrateTest";
import { probeEmit } from "@/services/playbackProbe";
import { recordTimeoutVerdict, recordVerdict, rememberedVerdict } from "@/services/engineVerdicts";
import { getAudioTracks, isMultiAudioAvailable, prepareMultiAudioPlayback, shouldUseMultiAudio } from "@/services/multiAudioLoader";
import { observedFromReport } from "@/services/subtitlePreference";

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
  sourceIsHdr: jest.fn(() => false),
  isDemoMode: jest.fn(() => false),
  connectToDemoServer: jest.fn(),
  refreshConfig: jest.fn(() => Promise.resolve()),
  getConfig: jest.fn(() => Promise.resolve({ apiKey: "key", serverUrl: "https://server", userId: "user" })),
  generatePlaySessionId: jest.fn(() => "session-1"),
  isLiveSource: jest.fn(() => false),
  closeLiveStream: jest.fn(() => Promise.resolve()),
  openChannel: jest.fn(),
  noteOpenFailed: jest.fn(),
}));

/** Whether the session opened with a server tier; a tier session survives a slow segment 0. */
let mockTierDeclared = false;

/** The engine's own failure report; null while the session lives. */
let mockFailure: () => { token: string; message: string } | null = () => null;
let mockProgress: () => { alive: boolean; bytesRead: number; readSeconds: number; elapsedSeconds: number; sourceState?: string; recovering?: boolean; hasPlayableSupplier?: boolean } | null = () =>
  null;
let throughputListener: ((sample: unknown) => void) | null = null;
/** The live session's subtitle playlist requests, as the engine reports them. */
let mockSubtitleRequest: ((request: { token: string; streamIndex: number; requestedAt: number }) => void) | null = null;

/** Segment 0 as the engine would time it; a test overrides it to make the pre-flight fail, or
 *  returns null for a session that never produced one. */
let mockPreflight: () => Record<string, unknown> | null = () => ({
  token: "token:http://127.0.0.1:9999/s/abc/master.m3u8",
  generation: 0,
  segment: 0,
  produceSeconds: 1,
  segmentSeconds: 6,
  cushion: 0,
  throttled: false,
  thermal: "nominal",
});

const mockPlaysFromDisk = jest.fn((_itemId: string) => false);
jest.mock("@/services/downloads/localSource", () => ({
  playsFromDisk: (id: string) => mockPlaysFromDisk(id),
  playsRepackaged: jest.fn(() => false),
  heldImageSubtitleForOrdinal: jest.fn(() => null),
}));

jest.mock("@/services/localRemux", () => ({
  belowRealtime: jest.requireActual("@/services/localRemux").belowRealtime,
  engineStarving: jest.requireActual("@/services/localRemux").engineStarving,
  subscribeEngineThroughput: jest.fn((_token: string, listener: (sample: unknown) => void) => {
    throughputListener = listener;
    queueMicrotask(() => {
      const sample = mockPreflight();
      if (sample) listener(sample);
    });
    return jest.fn();
  }),
  offeredTierBandwidths: jest.fn(() => [496_000, 896_000]),
  subscribeEngineLink: jest.fn(() => jest.fn()),
  subscribeEngineStage: jest.fn(() => jest.fn()),
  subscribeEngineTier: jest.fn(() => jest.fn()),
  subscribeEngineFailure: jest.fn((_token: string, listener: (failure: unknown) => void) => {
    queueMicrotask(() => {
      const failure = mockFailure();
      if (failure) listener(failure);
    });
    return jest.fn();
  }),
  engineInputMissing: jest.requireActual("@/services/localRemux").engineInputMissing,
  engineProgress: jest.fn(() => Promise.resolve(mockProgress())),
  readBound: jest.requireActual("@/services/localRemux").readBound,
  READ_BOUND_SHARE: jest.requireActual("@/services/localRemux").READ_BOUND_SHARE,
  canRemuxLocally: jest.fn(() => Promise.resolve(false)),
  isLocalRemuxAvailable: jest.fn(() => false),
  liveSubtitleRenditions: jest.fn(() => Promise.resolve(null)),
  subscribeSubtitleRequests: jest.fn((_token: string, listener: (request: { token: string; streamIndex: number; requestedAt: number }) => void) => {
    mockSubtitleRequest = listener;
    return jest.fn();
  }),
  deficitExceedsCushion: jest.fn(() => false),
  localRemuxToken: jest.fn((url: string) => `token:${url}`),
  posterFrameWorkInFlight: jest.fn(() => false),
  resolveSubtitlePick: jest.fn(() => null),
  sessionBaseUrl: jest.fn((url: string) => url.slice(0, url.lastIndexOf("/") + 1)),
  slipstreamEligible: jest.fn(() => false),
  slipstreamInputBandwidth: jest.fn((details: JellyfinVideoItem) => details.MediaSources?.[0]?.Bitrate ?? 0),
  slipstreamTierBandwidth: jest.fn(() => null),
  startFrameProvider: jest.fn(() => Promise.resolve("http://127.0.0.1:9999/frame-1/")),
  startLocalRemux: jest.fn(() => Promise.resolve("http://127.0.0.1:9999/s/abc/master.m3u8")),
  startPlaylistShim: jest.fn(() => Promise.resolve(null)),
  tierDeclaredFor: jest.fn(() => mockTierDeclared),
  stopFrameProvider: jest.fn(),
  stopLocalRemux: jest.fn(),
  stopPlaylistShim: jest.fn(),
  subtitleRenditions: jest.fn(() => []),
  sessionSubtitleRenditions: jest.fn(() => []),
  videoDecodeSupport: jest.fn(() => Promise.resolve({ hevc: true, hevcMain10: true, av1: false, h264MaxHeight: null, hevcMaxHeight: null })),
}));

jest.mock("@/services/engineVerdicts", () => ({
  rememberedVerdict: jest.fn(() => Promise.resolve(null)),
  recordVerdict: jest.fn(() => Promise.resolve(true)),
  recordTimeoutVerdict: jest.fn(() => Promise.resolve(true)),
}));
jest.mock("@/services/downloads/manager", () => ({ downloadManager: { getState: () => ({ entries: [] }) } }));

const mockTakeHot = jest.fn((_id: string): unknown => null);
const mockRetain = jest.fn((_channel: unknown) => false);
jest.mock("@/services/liveRing", () => ({ takeRingSession: (id: string) => Promise.resolve(mockTakeHot(id)), retainLiveSession: (channel: unknown) => mockRetain(channel) }));

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
const mockProbeEmit = probeEmit as jest.Mock;
const mockRememberedVerdict = rememberedVerdict as jest.Mock;
const mockRecordVerdict = recordVerdict as jest.Mock;

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
    // The engine lane awaits its segment-0 sample after startLocalRemux, a few microtasks deep;
    // microtask hops rather than a timer, since some tests run under fake timers.
    for (let hop = 0; hop < 10; hop++) await Promise.resolve();
  });
  return { ref, renderer };
}

describe("useVideoPlayback (mounted)", () => {
  beforeEach(() => {
    mockTierDeclared = false;
    jest.clearAllMocks();
    mockDetails.mockResolvedValue(videoItem());
    mockNeedsTranscoding.mockReturnValue(false);
    mockCanRemux.mockResolvedValue(false);
    (isLocalRemuxAvailable as jest.Mock).mockReturnValue(false);
    mockRememberedBitrate.mockResolvedValue(null);
    mockDirectUrl.mockReturnValue("https://server/Videos/id/stream.mkv");
    mockTranscodeUrl.mockResolvedValue("https://server/Videos/id/master.m3u8");
    mockStartLocalRemux.mockResolvedValue("http://127.0.0.1:9999/s/abc/master.m3u8");
    mockRememberedVerdict.mockResolvedValue(null);
    mockPlaysFromDisk.mockReturnValue(false);
    (getTextSubtitleStreams as jest.Mock).mockReturnValue([]);
    (sourceIsHdr as jest.Mock).mockReturnValue(false);
    (getAudioTracks as jest.Mock).mockReturnValue([]);
    (sessionSubtitleRenditions as jest.Mock).mockReturnValue([]);
    (resolveSubtitlePick as jest.Mock).mockReturnValue({ imageStreamIndex: null, rendition: null, ordinal: null });
    (observedFromReport as jest.Mock).mockReturnValue(null);
    (isMultiAudioAvailable as jest.Mock).mockReturnValue(false);
    (shouldUseMultiAudio as jest.Mock).mockReturnValue(false);
    (prepareMultiAudioPlayback as jest.Mock).mockResolvedValue("jellyfin-multi://session");
    mockFailure = () => null;
    mockProgress = () => null;
    throughputListener = null;
    (subscribeEngineLink as jest.Mock).mockImplementation(() => jest.fn());
    (slipstreamEligible as jest.Mock).mockReturnValue(false);
    (getQualitySettings as jest.Mock).mockResolvedValue({ mode: "auto", index: 5, label: "Original" });
    (isLiveSource as jest.Mock).mockReturnValue(false);
    mockPreflight = () => ({
      token: "token:http://127.0.0.1:9999/s/abc/master.m3u8",
      generation: 0,
      segment: 0,
      produceSeconds: 1,
      segmentSeconds: 6,
      cushion: 0,
      throttled: false,
      thermal: "nominal",
    });
  });

  describe("skip", () => {
    it("holds IDLE and fetches nothing", async () => {
      const { ref } = await mount({ videoId: "video-1", skip: true });

      expect(ref.current!.get().state).toEqual({ type: "IDLE" });
      expect(mockDetails).not.toHaveBeenCalled();
      expect(ref.current!.get().sourceUri).toBeNull();
    });
  });

  describe("missing metadata", () => {
    it.each(["empty details", "HTTP 404"])("shows a terminal error for %s until the viewer retries", async (failure) => {
      jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
      let renderer: TestRenderer.ReactTestRenderer | undefined;
      try {
        if (failure === "empty details") mockDetails.mockResolvedValue(null);
        else mockDetails.mockRejectedValue(new Error("Failed to fetch video details: 404 Not Found"));

        const mounted = await mount({ videoId: "video-1" });
        const { ref } = mounted;
        renderer = mounted.renderer;
        const terminalError = { type: "ERROR", error: "Video not found on server", autoRetry: false, canRetryWithTranscode: false };
        expect(ref.current!.get().state).toEqual(terminalError);
        expect(ref.current!.get().showLoadingOverlay).toBe(false);

        await act(async () => jest.advanceTimersByTime(180_000));
        expect(mockDetails).toHaveBeenCalledTimes(1);
        expect(ref.current!.get().state).toEqual(terminalError);

        await act(async () => ref.current!.get().retry());
        expect(mockDetails).toHaveBeenCalledTimes(2);
        expect(ref.current!.get().state).toEqual(terminalError);
        expect(ref.current!.get().showLoadingOverlay).toBe(false);
        await act(async () => jest.advanceTimersByTime(180_000));
        expect(mockDetails).toHaveBeenCalledTimes(2);
        expect(mockStartLocalRemux).not.toHaveBeenCalled();
        expect(mockTranscodeUrl).not.toHaveBeenCalled();
      } finally {
        await act(async () => renderer?.unmount());
        jest.useRealTimers();
      }
    });
  });

  describe("lane selection", () => {
    it("keeps a forbidden-server source on the engine at startup and when production slows", async () => {
      mockDetails.mockResolvedValue(videoItem({ MediaSources: [{ Id: "source-1", Container: "mkv", Bitrate: 8_000_000, SupportsTranscoding: false }] }));
      mockCanRemux.mockResolvedValue(true);
      mockRememberedVerdict.mockResolvedValue({ app: "x", at: 1, reason: "below realtime at start", produceSeconds: 9, segmentSeconds: 6, thermal: "nominal" });
      const sample = { token: "token:http://127.0.0.1:9999/s/abc/master.m3u8", generation: 0, segment: 0, produceSeconds: 9, segmentSeconds: 6, cushion: 0, throttled: false, thermal: "nominal" };
      mockPreflight = () => sample;

      const { ref, renderer } = await mount({ videoId: "video-1" });
      expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "localRemux" });
      expect(mockProbeEmit).toHaveBeenCalledWith("preflight", expect.objectContaining({ keptForNoServer: true }));
      ref.current!.get().currentTimeRef.current = 42;
      await act(async () => {
        throughputListener!({ ...sample, segment: 1 });
        throughputListener!({ ...sample, segment: 2 });
      });

      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
      expect(mockStopLocalRemux).not.toHaveBeenCalled();
      expect(mockRememberedVerdict).not.toHaveBeenCalled();
      expect(mockRecordVerdict).not.toHaveBeenCalled();
      expect(mockTranscodeUrl).not.toHaveBeenCalled();
      expect(prepareMultiAudioPlayback).not.toHaveBeenCalled();
      expect(mockProbeEmit).not.toHaveBeenCalledWith("fallback", expect.anything());
      await act(async () => renderer.unmount());
    });

    it.each(["auto", "fixed"])("does not apply a %s ladder cap when video transcoding is forbidden", async (mode) => {
      mockDetails.mockResolvedValue(videoItem({ MediaSources: [{ Id: "source-1", Container: "mkv", Bitrate: 8_000_000, SupportsTranscoding: false }] }));
      mockCanRemux.mockResolvedValue(true);
      (slipstreamEligible as jest.Mock).mockReturnValue(true);
      (getQualitySettings as jest.Mock).mockResolvedValue({ mode, index: 1, bitrate: 896_000 });
      (subscribeEngineLink as jest.Mock).mockImplementation((token, listener) => {
        listener({ token, bps: 600_000, copyListed: true });
        return jest.fn();
      });

      const { ref, renderer } = await mount({ videoId: "video-1" });
      expect(ref.current!.get().maxBitRate).toBeNull();
      const listener = (subscribeEngineLink as jest.Mock).mock.calls.at(-1)![1];
      await act(async () => listener({ bps: 30_000_000, copyListed: true }));
      expect(ref.current!.get().maxBitRate).toBeNull();
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
      await act(async () => renderer.unmount());
    });

    it.each([false, true])("shows a terminal error when the engine cannot take the file and video transcoding is forbidden (engine available: %s)", async (engineAvailable) => {
      jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
      let renderer: TestRenderer.ReactTestRenderer | undefined;
      try {
        mockDetails.mockResolvedValue(videoItem({ MediaSources: [{ Id: "source-1", SupportsTranscoding: false }] }));
        mockNeedsTranscoding.mockReturnValue(true);
        (isLocalRemuxAvailable as jest.Mock).mockReturnValue(engineAvailable);
        (isMultiAudioAvailable as jest.Mock).mockReturnValue(true);
        (shouldUseMultiAudio as jest.Mock).mockReturnValue(true);

        const mounted = await mount({ videoId: "video-1" });
        const { ref } = mounted;
        renderer = mounted.renderer;
        const terminalError = { type: "ERROR", error: "Failed to create video stream. Please check your settings.", autoRetry: false, canRetryWithTranscode: false };
        expect(ref.current!.get().state).toEqual(terminalError);
        expect(ref.current!.get().showLoadingOverlay).toBe(false);

        await act(async () => jest.advanceTimersByTime(180_000));
        expect(mockDetails).toHaveBeenCalledTimes(1);
        expect(ref.current!.get().state).toEqual(terminalError);

        await act(async () => ref.current!.get().retry());
        expect(mockDetails).toHaveBeenCalledTimes(2);
        expect(ref.current!.get().state).toEqual(terminalError);
        expect(ref.current!.get().showLoadingOverlay).toBe(false);
        await act(async () => jest.advanceTimersByTime(180_000));
        expect(mockDetails).toHaveBeenCalledTimes(2);
        expect(mockStartLocalRemux).not.toHaveBeenCalled();
        expect(mockTranscodeUrl).not.toHaveBeenCalled();
        expect(prepareMultiAudioPlayback).not.toHaveBeenCalled();
      } finally {
        await act(async () => renderer?.unmount());
        jest.useRealTimers();
      }
    });

    it.each(["startup", "playback"])("retries the local engine after a %s failure when server video is forbidden", async (failureAt) => {
      jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
      let renderer: TestRenderer.ReactTestRenderer | undefined;
      try {
        mockDetails.mockResolvedValue(videoItem({ MediaSources: [{ Id: "source-1", Container: "mkv", Bitrate: 8_000_000, SupportsTranscoding: false }] }));
        mockCanRemux.mockResolvedValue(true);
        (isLocalRemuxAvailable as jest.Mock).mockReturnValue(true);
        if (failureAt === "startup") mockStartLocalRemux.mockRejectedValueOnce(new Error("engine failed"));

        const mounted = await mount({ videoId: "video-1" });
        const { ref } = mounted;
        renderer = mounted.renderer;
        if (failureAt === "playback") {
          ref.current!.get().currentTimeRef.current = 42;
          await act(async () => {
            ref.current!.get().videoCallbacks.onError({ error: { code: -12971, domain: "CoreMediaErrorDomain" } } as never);
          });
          await act(async () => jest.advanceTimersByTime(1));
        }
        expect(ref.current!.get().state).toMatchObject({ type: "ERROR", retryGateway: true });
        expect(ref.current!.get().sourceUri).toBeNull();
        expect(ref.current!.get().imageSubtitleSessionUrl).toBeNull();
        await act(async () => {
          jest.advanceTimersByTime(500);
          for (let hop = 0; hop < 30; hop++) await Promise.resolve();
        });

        expect(mockStartLocalRemux).toHaveBeenCalledTimes(2);
        expect(mockStartLocalRemux.mock.calls[1][3]).toBeUndefined();
        expect(mockStartLocalRemux.mock.calls[1][2]).toBe(failureAt === "playback" ? 42 : undefined);
        expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "localRemux" });
        expect(ref.current!.get().imageSubtitleSessionUrl).toBe(ref.current!.get().sourceUri);
        expect(mockTranscodeUrl).not.toHaveBeenCalled();
        expect(prepareMultiAudioPlayback).not.toHaveBeenCalled();
      } finally {
        await act(async () => renderer?.unmount());
        jest.useRealTimers();
      }
    });

    it("opens a direct-compatible network file through the gateway", async () => {
      mockCanRemux.mockResolvedValue(true);
      const { ref } = await mount({ videoId: "video-1" });

      const result = ref.current!.get();
      expect(result.state).toEqual({ type: "INITIALIZING_PLAYER", mode: "localRemux", streamUrl: "http://127.0.0.1:9999/s/abc/master.m3u8" });
      expect(result.sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
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

    it("hands a segment 0 that ran below realtime to the server before the player is bound", async () => {
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      mockPreflight = () => ({
        token: "token:http://127.0.0.1:9999/s/abc/master.m3u8",
        generation: 0,
        segment: 0,
        produceSeconds: 9,
        segmentSeconds: 6,
        cushion: 0,
        throttled: false,
        thermal: "nominal",
      });

      const { ref } = await mount({ videoId: "video-1" });

      const result = ref.current!.get();
      expect(result.state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "transcode" });
      expect(result.sourceUri).toBe("https://server/Videos/id/master.m3u8");
      expect(mockStopLocalRemux).toHaveBeenCalledWith("token:http://127.0.0.1:9999/s/abc/master.m3u8");
      expect(mockRecordVerdict).toHaveBeenCalledWith(expect.objectContaining({ Id: "video-1" }), expect.objectContaining({ produceSeconds: 9 }), "below realtime at start", { busy: false });
      expect(mockProbeEmit).toHaveBeenCalledWith("fallback", { from: "localRemux", to: "transcode", reason: "engine below realtime" });
      expect(mockProbeEmit).not.toHaveBeenCalledWith("error", expect.anything());
    });

    it("keeps a segment 0 that ran below realtime because its bytes arrived slowly, with no verdict", async () => {
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      mockPreflight = () => ({
        token: "token:http://127.0.0.1:9999/s/abc/master.m3u8",
        generation: 0,
        segment: 0,
        produceSeconds: 12,
        segmentSeconds: 11,
        readSeconds: 10,
        cushion: 0,
        throttled: false,
        thermal: "nominal",
      });

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");
      expect(mockRecordVerdict).not.toHaveBeenCalled();
      expect(mockProbeEmit).not.toHaveBeenCalledWith("fallback", expect.anything());
      expect(mockProbeEmit).toHaveBeenCalledWith("preflight", expect.objectContaining({ keptForLink: true, readSeconds: 10, remembered: false }));
    });

    describe("at the deadline with no segment", () => {
      const flush = async () => {
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
      };
      beforeEach(() => {
        mockNeedsTranscoding.mockReturnValue(true);
        mockCanRemux.mockResolvedValue(true);
        mockPreflight = () => null;
        jest.useFakeTimers();
      });
      afterEach(() => jest.useRealTimers());

      it("waits on a session still pulling its bytes at the link's pace, then keeps the segment it delivers", async () => {
        let bytes = 40_000_000;
        mockProgress = () => ({ alive: true, bytesRead: (bytes += 40_000_000), readSeconds: 19, elapsedSeconds: 20 });
        const { ref } = await mount({ videoId: "video-1" });

        await act(async () => {
          jest.advanceTimersByTime(20_000);
        });
        await act(flush);
        expect(mockProbeEmit).toHaveBeenCalledWith("preflight", expect.objectContaining({ extendedSeconds: 20 }));
        expect(recordTimeoutVerdict).not.toHaveBeenCalled();

        await act(async () => {
          throughputListener!({
            token: "token:http://127.0.0.1:9999/s/abc/master.m3u8",
            generation: 0,
            segment: 0,
            produceSeconds: 30,
            segmentSeconds: 11,
            readSeconds: 28,
            cushion: 0,
            throttled: false,
            thermal: "nominal",
          });
        });
        await act(flush);

        // No ladder declared for this session, so a link-bound segment 0 keeps the engine (the link
        // is slow, not the device) rather than blocklisting the file.
        expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");
        expect(mockProbeEmit).toHaveBeenCalledWith("preflight", expect.objectContaining({ keptForLink: true }));
        expect(mockRecordVerdict).not.toHaveBeenCalled();
      });

      it("hands over to the server when the session is not pulling", async () => {
        mockProgress = () => ({ alive: true, bytesRead: 1_000, readSeconds: 2, elapsedSeconds: 20 });
        const { ref } = await mount({ videoId: "video-1" });

        await act(async () => {
          jest.advanceTimersByTime(20_000);
        });
        await act(flush);

        expect(recordTimeoutVerdict).toHaveBeenCalledWith(expect.objectContaining({ Id: "video-1" }), 20, { busy: false });
        expect(mockProbeEmit).toHaveBeenCalledWith("fallback", { from: "localRemux", to: "transcode", reason: "engine produced no segment within 20s" });
        expect(ref.current!.get().sourceUri).toBe("https://server/Videos/id/master.m3u8");
      });

      it("records no verdict for a session that read nothing", async () => {
        mockProgress = () => ({ alive: true, bytesRead: 0, readSeconds: 0, elapsedSeconds: 20 });
        const { ref } = await mount({ videoId: "video-1" });

        await act(async () => {
          jest.advanceTimersByTime(20_000);
        });
        await act(flush);

        expect(recordTimeoutVerdict).not.toHaveBeenCalled();
        expect(mockProbeEmit).toHaveBeenCalledWith("fallback", { from: "localRemux", to: "transcode", reason: "engine produced no segment within 20s" });
        expect(ref.current!.get().sourceUri).toBe("https://server/Videos/id/master.m3u8");
      });
    });

    it("sends an HDR source's server stream through the shim, whatever the resume position", async () => {
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(false);
      (sourceIsHdr as jest.Mock).mockReturnValue(true);
      (startPlaylistShim as jest.Mock).mockResolvedValue("http://127.0.0.1:9999/shim-1/master.m3u8");

      const { ref } = await mount({ videoId: "video-1" });

      expect(startPlaylistShim).toHaveBeenCalledWith("https://server/Videos/id/master.m3u8", 0, { sdrInit: true });
      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/shim-1/master.m3u8");
    });

    it("ends as not found when the server answers the engine's read with a 404, without asking the server to convert", async () => {
      // Both lanes read the same path on the server, so the transcode would fail the same way,
      // and a session that read nothing measured nothing about the device.
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      (isLocalRemuxAvailable as jest.Mock).mockReturnValue(true);
      mockPreflight = () => null;
      mockFailure = () => ({ token: "token:http://127.0.0.1:9999/s/abc/master.m3u8", message: "open_input: Server returned 404 Not Found" });

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().state).toEqual({ type: "ERROR", error: "Video not found on server", canRetryWithTranscode: false });
      expect(mockTranscodeUrl).not.toHaveBeenCalled();
      expect(mockStopLocalRemux).toHaveBeenCalledWith("token:http://127.0.0.1:9999/s/abc/master.m3u8");
      expect(recordTimeoutVerdict).not.toHaveBeenCalled();
      expect(mockRecordVerdict).not.toHaveBeenCalled();
      expect(mockProbeEmit).toHaveBeenCalledWith("preflight", {
        produceSeconds: null,
        segmentSeconds: null,
        thermal: "unknown",
        remembered: false,
        failed: "open_input: Server returned 404 Not Found",
      });
      expect(mockProbeEmit).toHaveBeenCalledWith("error", { mode: "localRemux", message: "open_input: Server returned 404 Not Found", willRetry: false });
      expect(mockProbeEmit).not.toHaveBeenCalledWith("fallback", expect.anything());
    });

    it("falls back to the server at once on any other engine failure, with no verdict", async () => {
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      mockPreflight = () => null;
      mockFailure = () => ({ token: "token:http://127.0.0.1:9999/s/abc/master.m3u8", message: "open_input: Input/output error" });

      const { ref } = await mount({ videoId: "video-1" });

      const result = ref.current!.get();
      expect(result.state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "transcode" });
      expect(result.sourceUri).toBe("https://server/Videos/id/master.m3u8");
      expect(recordTimeoutVerdict).not.toHaveBeenCalled();
      expect(mockProbeEmit).toHaveBeenCalledWith("fallback", { from: "localRemux", to: "transcode", reason: "engine failed: open_input: Input/output error" });
      expect(mockProbeEmit).not.toHaveBeenCalledWith("error", expect.anything());
    });

    it("keeps a below-realtime session that carries a server tier, instead of spending the file on the server lane", async () => {
      // The slow link is why a tier was declared. AVPlayer opens on that rung while the source
      // pull catches up, so handing the file to the server here would defeat the tier and pin
      // the file to the server lane with a verdict.
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      mockTierDeclared = true;
      mockPreflight = () => ({
        token: "token:http://127.0.0.1:9999/s/abc/master.m3u8",
        generation: 0,
        segment: 0,
        produceSeconds: 16,
        segmentSeconds: 6,
        cushion: 0,
        throttled: false,
        thermal: "nominal",
      });

      const { ref } = await mount({ videoId: "video-1" });

      const result = ref.current!.get();
      expect(result.sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");
      expect(mockStopLocalRemux).not.toHaveBeenCalled();
      expect(mockRecordVerdict).not.toHaveBeenCalled();
      expect(mockProbeEmit).not.toHaveBeenCalledWith("fallback", expect.objectContaining({ reason: "engine below realtime" }));
      expect(mockProbeEmit).toHaveBeenCalledWith("preflight", expect.objectContaining({ keptForTier: true, remembered: false }));
    });

    it("sends a file the engine measured below realtime before straight to the server", async () => {
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      mockRememberedVerdict.mockResolvedValue({ app: "x", at: 1, reason: "below realtime at start", produceSeconds: 9, segmentSeconds: 6, thermal: "nominal" });

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "transcode" });
      expect(mockStartLocalRemux).not.toHaveBeenCalled();
      expect(mockProbeEmit).toHaveBeenCalledWith("decline", expect.objectContaining({ reason: "engine below realtime on an earlier play" }));
    });

    // Downloaded, already an MP4, so the repackager declined it and `repackaged` stayed false.
    // Its mov_text tracks used to push it off direct play, into the loopback engine, and from
    // there to a server that a download exists to do without.
    it("direct-plays a held file whose text subtitles are already inside it", async () => {
      mockPlaysFromDisk.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      (getTextSubtitleStreams as jest.Mock).mockReturnValue([
        { Type: "Subtitle", Index: 2, Codec: "mov_text", IsExternal: false },
        { Type: "Subtitle", Index: 3, Codec: "mov_text", IsExternal: false },
      ]);

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "direct" });
      expect(mockStartLocalRemux).not.toHaveBeenCalled();
      expect(mockTranscodeUrl).not.toHaveBeenCalled();
    });

    // A sidecar cannot be attached to a progressive file, so this one still wants the engine.
    it("still reaches the engine for a held file whose subtitles sit beside it", async () => {
      mockPlaysFromDisk.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      (getTextSubtitleStreams as jest.Mock).mockReturnValue([{ Type: "Subtitle", Index: 2, Codec: "subrip", IsExternal: true }]);

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "localRemux" });
      expect(mockTranscodeUrl).not.toHaveBeenCalled();
    });

    it("uses the subtitle-capable server fallback when the network gateway cannot open", async () => {
      mockCanRemux.mockResolvedValue(false);
      (getTextSubtitleStreams as jest.Mock).mockReturnValue([{ Type: "Subtitle", Index: 2, Codec: "subrip", IsExternal: true }]);

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "transcode" });
      expect(mockTranscodeUrl).toHaveBeenCalled();
    });

    // The engine session never opening is not a reason to ask a server for a file this device
    // already holds. Reached by the pre-flight throw too.
    it("replays a held file from its disk when the engine session throws", async () => {
      mockPlaysFromDisk.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      (getTextSubtitleStreams as jest.Mock).mockReturnValue([{ Type: "Subtitle", Index: 2, Codec: "subrip", IsExternal: true }]);
      mockStartLocalRemux.mockRejectedValue(new Error("engine produced no segment within 20s"));

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().sourceUri).toBe("https://server/Videos/id/stream.mkv");
      expect(mockTranscodeUrl).not.toHaveBeenCalled();
      expect(mockProbeEmit).toHaveBeenCalledWith("fallback", expect.objectContaining({ from: "localRemux", to: "direct" }));
    });

    it("reads no verdict for a file on disk: a download must not be sent to the server", async () => {
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      mockPlaysFromDisk.mockReturnValue(true);
      mockRememberedVerdict.mockResolvedValue({ app: "x", at: 1, reason: "below realtime at start", produceSeconds: 9, segmentSeconds: 6, thermal: "nominal", strikes: 2 });

      const { ref } = await mount({ videoId: "video-1" });

      expect(mockRememberedVerdict).not.toHaveBeenCalled();
      expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "localRemux" });
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
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

      const result = ref.current!.get();
      expect(result.sourceUri).toBe("https://server/Videos/id/master.m3u8");
      expect(result.state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "transcode" });
    });

    it("routes a direct-playable file off direct play when the link measures under the source", async () => {
      mockRememberedBitrate.mockResolvedValue(4_000_000); // source is 8 Mbps
      mockCanRemux.mockResolvedValue(true);

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().state).toMatchObject({ mode: "localRemux" });
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
    });

    it("keeps the gateway when the link carries the source", async () => {
      mockRememberedBitrate.mockResolvedValue(20_000_000);
      mockCanRemux.mockResolvedValue(true);

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().state).toMatchObject({ mode: "localRemux" });
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
    });
  });

  describe("live channels", () => {
    const SERVER_MASTER = "https://server/videos/ch/master.m3u8?PlaySessionId=ps-1&LiveStreamId=ls-1";
    function liveChannel(overrides: Partial<JellyfinVideoItem> = {}) {
      return videoItem({
        Id: "video-1",
        Type: "TvChannel",
        RunTimeTicks: undefined,
        MediaSources: [{ Id: "source-1", Container: "hls", IsInfiniteStream: true }],
        PlaySessionId: "ps-1",
        LiveStreamId: "ls-1",
        liveStreamUrl: "https://origin/live/high.m3u8",
        liveTranscodeUrl: SERVER_MASTER,
        ...overrides,
      });
    }
    /** A channel resolved from its origin: nothing opened on the server. */
    const originChannel = () => liveChannel({ LiveStreamId: undefined, liveTranscodeUrl: undefined });
    beforeEach(() => {
      (isLiveSource as jest.Mock).mockReturnValue(true);
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      mockDetails.mockResolvedValue(liveChannel());
      (openChannel as jest.Mock).mockReset().mockRejectedValue(new Error("The server did not open video-1"));
    });

    it("plays a channel read from its origin with no server open", async () => {
      mockDetails.mockResolvedValue(originChannel());
      const { ref } = await mount({ videoId: "video-1" });
      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");
      expect(openChannel).not.toHaveBeenCalled();
      expect(closeLiveStream).not.toHaveBeenCalled();
    });

    it("opens an origin channel on the server only when the engine cannot play it", async () => {
      mockDetails.mockResolvedValue(originChannel());
      (openChannel as jest.Mock).mockResolvedValue(liveChannel({ liveStreamUrl: undefined }));
      mockPreflight = () => null;
      mockFailure = () => ({ token: "token:http://127.0.0.1:9999/s/abc/master.m3u8", message: "open_input: Input/output error" });

      const { ref } = await mount({ videoId: "video-1" });

      expect(openChannel).toHaveBeenCalledTimes(1);
      expect(openChannel).toHaveBeenCalledWith("video-1", expect.objectContaining({ Id: "video-1" }), { serverOnly: true });
      expect(ref.current!.get().sourceUri).toBe(SERVER_MASTER);
      expect(closeLiveStream).not.toHaveBeenCalled();
    });

    it("moves an origin channel to the server after its second drop, opening it only then", async () => {
      mockDetails.mockResolvedValue(originChannel());
      (openChannel as jest.Mock).mockResolvedValue(liveChannel({ liveStreamUrl: undefined }));
      const { ref } = await mount({ videoId: "video-1" });
      const dropAndRetry = async () => {
        await act(async () => {
          ref.current!.get().videoCallbacks.onError({ error: { errorString: "dropped", code: -12885 } } as never);
          await new Promise((resolve) => setImmediate(resolve));
        });
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 600));
          for (let hop = 0; hop < 10; hop++) await Promise.resolve();
        });
      };

      await dropAndRetry();
      expect(openChannel).not.toHaveBeenCalled();
      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");

      await dropAndRetry();
      expect(openChannel).toHaveBeenCalledWith("video-1", expect.objectContaining({ Id: "video-1" }), { serverOnly: true });
      expect(ref.current!.get().sourceUri).toBe(SERVER_MASTER);
    });

    it("fails a warming ring session that already ended at once, instead of waiting out the pre-flight", async () => {
      // Ended before the pre-flight subscribed: no segment and no failure report will ever arrive.
      mockPreflight = () => null;
      mockProgress = () => ({ alive: false, bytesRead: 0, readSeconds: 0, elapsedSeconds: 1 });
      mockTakeHot.mockImplementationOnce(() => ({ channelId: "video-1", details: originChannel(), url: "http://127.0.0.1:9999/s/warm/master.m3u8", token: "token-warm", ready: false }));
      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().state).toMatchObject({ type: "ERROR", canRetryWithTranscode: false });
      expect(openChannel).toHaveBeenCalledWith("video-1", expect.objectContaining({ Id: "video-1" }), { serverOnly: true });
      expect(noteOpenFailed).toHaveBeenCalledWith("video-1");
    });

    it("fails a cold start whose session already ended the same way", async () => {
      mockPreflight = () => null;
      mockProgress = () => ({ alive: false, bytesRead: 0, readSeconds: 0, elapsedSeconds: 1 });
      mockDetails.mockResolvedValue(originChannel());
      const { ref } = await mount({ videoId: "video-1" });

      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
      expect(ref.current!.get().state).toMatchObject({ type: "ERROR", canRetryWithTranscode: false });
      expect(noteOpenFailed).toHaveBeenCalledWith("video-1");
    });

    it("binds a ready ring session without asking the engine whether it lives", async () => {
      mockTakeHot.mockImplementationOnce(() => ({ channelId: "video-1", details: originChannel(), url: "http://127.0.0.1:9999/s/hot/master.m3u8", token: "token-hot", ready: true }));
      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/hot/master.m3u8");
      expect(engineProgress).not.toHaveBeenCalled();
    });

    it("takes a ring session still cutting its first segments and times it, opening nothing again", async () => {
      const WARM = "http://127.0.0.1:9999/s/warm/master.m3u8";
      mockTakeHot.mockImplementationOnce(() => ({ channelId: "video-1", details: originChannel(), url: WARM, token: "token-warm", ready: false }));
      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().sourceUri).toBe(WARM);
      expect(mockDetails).not.toHaveBeenCalled();
      expect(mockStartLocalRemux).not.toHaveBeenCalled();
      expect(mockProbeEmit).not.toHaveBeenCalledWith("fallback", expect.anything());
    });

    it("draws the image track AVPlayer asks the engine for, and stops at a report that nothing is selected", async () => {
      const found = [{ index: 3, name: "eng", language: "eng", vttUrl: "", localVtt: "", isDefault: false, isForced: false, isImage: true, isEngineText: false }];
      (liveSubtitleRenditions as jest.Mock).mockResolvedValueOnce(found);
      (resolveSubtitlePick as jest.Mock).mockReturnValue({ imageStreamIndex: null, rendition: null, ordinal: null });
      mockDetails.mockResolvedValue(originChannel());
      const { ref } = await mount({ videoId: "video-1" });
      const request = (streamIndex: number, requestedAt: number) =>
        act(async () => {
          mockSubtitleRequest!({ token: "token:http://127.0.0.1:9999/s/abc/master.m3u8", streamIndex, requestedAt });
        });

      await request(3, Date.now() + 1);
      expect(ref.current!.get().activeImageSubtitleStream).toBe(3);
      // A stream the engine did not publish as an image track draws nothing.
      await request(7, Date.now() + 2);
      expect(ref.current!.get().activeImageSubtitleStream).toBe(3);

      await act(async () => {
        ref.current!.get().videoCallbacks.onTextTracks({ textTracks: [{ index: 0, title: "eng", language: "eng", type: "text/vtt", selected: false }] } as never);
      });
      expect(ref.current!.get().activeImageSubtitleStream).toBeNull();
      // A request that left before the deselect is the old selection's.
      await request(3, Date.now() - 1_000);
      expect(ref.current!.get().activeImageSubtitleStream).toBeNull();
      await request(3, Date.now() + 5);
      expect(ref.current!.get().activeImageSubtitleStream).toBe(3);
    });

    it("resolves subtitle picks against the tracks the engine found on the channel", async () => {
      const found = [{ index: 4, name: "deu", language: "deu", vttUrl: "", localVtt: "", isDefault: false, isForced: false, isImage: true, isEngineText: false }];
      (liveSubtitleRenditions as jest.Mock).mockResolvedValueOnce(found);
      (resolveSubtitlePick as jest.Mock).mockReturnValue({ imageStreamIndex: 4, rendition: found[0], ordinal: 0 });
      mockDetails.mockResolvedValue(originChannel());
      const { ref } = await mount({ videoId: "video-1" });

      await act(async () => {
        ref.current!.get().videoCallbacks.onTextTracks({ textTracks: [{ index: 0, title: "deu", language: "deu", type: "text/vtt", selected: true }] } as never);
      });
      expect(resolveSubtitlePick).toHaveBeenCalledWith(found, expect.anything());
    });

    it("plays through the engine when it opens, and never builds a server URL of its own", async () => {
      const { ref } = await mount({ videoId: "video-1" });
      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");
      expect(mockTranscodeUrl).not.toHaveBeenCalled();
      expect(closeLiveStream).not.toHaveBeenCalled();
    });

    it("binds a hot ring session with no open, no engine start and no pre-flight, and stops it on teardown", async () => {
      const HOT = "http://127.0.0.1:9999/s/hot/master.m3u8";
      mockTakeHot.mockImplementationOnce(() => ({ channelId: "video-1", details: liveChannel(), url: HOT, token: "token-hot", ready: true }));
      const { ref, renderer } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().sourceUri).toBe(HOT);
      expect(mockDetails).not.toHaveBeenCalled();
      expect(mockStartLocalRemux).not.toHaveBeenCalled();

      await act(async () => {
        renderer.unmount();
      });
      expect(mockStopLocalRemux).toHaveBeenCalledWith("token-hot");
      expect(closeLiveStream).toHaveBeenCalledWith("ls-1");
    });

    it("hands a channel that was playing to the ring on teardown instead of stopping it", async () => {
      mockRetain.mockImplementationOnce(() => true);
      const { ref, renderer } = await mount({ videoId: "video-1" });
      await act(async () => {
        ref.current!.get().videoCallbacks.onLoad({ duration: 0, currentTime: 0, naturalSize: { width: 1280, height: 720, orientation: "landscape" } } as never);
      });
      await act(async () => {
        ref.current!.get().play();
      });
      await act(async () => {
        ref.current!.get().videoCallbacks.onProgress({ currentTime: 1, playableDuration: 6, seekableDuration: 0 } as never);
        await new Promise((resolve) => setTimeout(resolve, 600));
      });

      await act(async () => {
        renderer.unmount();
      });
      expect(mockRetain).toHaveBeenCalledWith({
        channelId: "video-1",
        details: expect.objectContaining({ LiveStreamId: "ls-1" }),
        url: "http://127.0.0.1:9999/s/abc/master.m3u8",
        token: "token:http://127.0.0.1:9999/s/abc/master.m3u8",
      });
      expect(mockStopLocalRemux).not.toHaveBeenCalledWith("token:http://127.0.0.1:9999/s/abc/master.m3u8");
      expect(closeLiveStream).not.toHaveBeenCalled();
    });

    it("takes the server's transcode when the engine cannot open the channel, keeping the live stream open", async () => {
      mockPreflight = () => null;
      mockFailure = () => ({ token: "token:http://127.0.0.1:9999/s/abc/master.m3u8", message: "open_input: Input/output error" });

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().sourceUri).toBe(SERVER_MASTER);
      expect(mockTranscodeUrl).not.toHaveBeenCalled();
      expect(closeLiveStream).not.toHaveBeenCalled();
      expect(mockProbeEmit).toHaveBeenCalledWith("fallback", { from: "localRemux", to: "transcode", reason: "engine failed: open_input: Input/output error" });
    });

    it("takes the server's transcode when segment 0 runs below realtime, with no verdict", async () => {
      mockPreflight = () => ({
        token: "token:http://127.0.0.1:9999/s/abc/master.m3u8",
        generation: 0,
        segment: 0,
        produceSeconds: 9,
        segmentSeconds: 2,
        cushion: 0,
        throttled: false,
        thermal: "nominal",
      });

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().sourceUri).toBe(SERVER_MASTER);
      expect(mockRecordVerdict).not.toHaveBeenCalled();
      expect(mockStopLocalRemux).toHaveBeenCalledWith("token:http://127.0.0.1:9999/s/abc/master.m3u8");
    });

    it("keeps a below-realtime engine when the server offers no transcode", async () => {
      mockDetails.mockResolvedValue(liveChannel({ liveTranscodeUrl: undefined }));
      mockPreflight = () => ({
        token: "token:http://127.0.0.1:9999/s/abc/master.m3u8",
        generation: 0,
        segment: 0,
        produceSeconds: 9,
        segmentSeconds: 2,
        cushion: 0,
        throttled: false,
        thermal: "nominal",
      });

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");
      expect(mockProbeEmit).not.toHaveBeenCalledWith("fallback", expect.anything());
    });

    it("ends in the error when the engine fails and the server offers no transcode", async () => {
      mockDetails.mockResolvedValue(liveChannel({ liveTranscodeUrl: undefined }));
      mockPreflight = () => null;
      mockFailure = () => ({ token: "token:http://127.0.0.1:9999/s/abc/master.m3u8", message: "open_input: Input/output error" });

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().state).toMatchObject({ type: "ERROR", canRetryWithTranscode: false });
      expect(closeLiveStream).toHaveBeenCalledWith("ls-1");
    });

    it("starts on the server when the open gave the engine nothing to read", async () => {
      mockDetails.mockResolvedValue(liveChannel({ liveStreamUrl: undefined }));

      const { ref } = await mount({ videoId: "video-1" });

      expect(ref.current!.get().sourceUri).toBe(SERVER_MASTER);
      expect(mockStartLocalRemux).not.toHaveBeenCalled();
      expect(mockProbeEmit).toHaveBeenCalledWith("fallback", { from: "localRemux", to: "transcode", reason: "the open gave the engine nothing to read" });
    });

    it("treats a stream the player has not opened in 45s as dropped", async () => {
      jest.useFakeTimers();
      try {
        const { ref } = await mount({ videoId: "video-1" });
        // The engine lane's deferred steps ride timers under fake time; a few short advances land it.
        for (let round = 0; round < 5 && ref.current!.get().state.type !== "INITIALIZING_PLAYER"; round++) {
          await act(async () => {
            jest.advanceTimersByTime(20);
            for (let hop = 0; hop < 10; hop++) await Promise.resolve();
          });
        }
        expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER" });
        await act(async () => {
          jest.advanceTimersByTime(44_000);
        });
        expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER" });
        await act(async () => {
          jest.advanceTimersByTime(1_500);
        });
        expect(ref.current!.get().state).toMatchObject({ type: "ERROR", error: "Playback stalled while waiting for the server", canRetryWithTranscode: true });
        expect(mockStopLocalRemux).toHaveBeenCalledWith("token:http://127.0.0.1:9999/s/abc/master.m3u8");
      } finally {
        jest.useRealTimers();
      }
    });

    it("reopens on the engine after one drop, moves to the server after the second, and errors on the server's", async () => {
      const { ref } = await mount({ videoId: "video-1" });
      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");

      const drop = async () => {
        await act(async () => {
          ref.current!.get().videoCallbacks.onError({ error: { errorString: "dropped", code: -12885 } } as never);
          await new Promise((resolve) => setImmediate(resolve));
        });
      };
      const reopen = async () => {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 600));
          for (let hop = 0; hop < 10; hop++) await Promise.resolve();
        });
      };

      await drop();
      expect(ref.current!.get().state).toMatchObject({ type: "ERROR", canRetryWithTranscode: true });
      await reopen();
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(2);
      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");

      await drop();
      expect(ref.current!.get().state).toMatchObject({ type: "ERROR", canRetryWithTranscode: true });
      await reopen();
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(2);
      expect(ref.current!.get().sourceUri).toBe(SERVER_MASTER);
      expect(mockProbeEmit).toHaveBeenCalledWith("fallback", { from: "localRemux", to: "transcode", reason: "engine spent on this channel" });

      await drop();
      expect(ref.current!.get().state).toMatchObject({ type: "ERROR", canRetryWithTranscode: false });
    });

    it("ignores a native failure that names a source the player moved on from", async () => {
      const { ref } = await mount({ videoId: "video-1" });
      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");

      await act(async () => {
        ref.current!.get().videoCallbacks.onError({ error: { errorString: "gone", code: -1100 }, uri: "http://127.0.0.1:9999/s/left/master.m3u8" } as never);
        await new Promise((resolve) => setImmediate(resolve));
      });

      expect(ref.current!.get().state.type).not.toBe("ERROR");
      expect(mockStopLocalRemux).not.toHaveBeenCalled();
      expect(closeLiveStream).not.toHaveBeenCalled();
    });

    it("errors on a 401 without reopening the channel", async () => {
      const { ref } = await mount({ videoId: "video-1" });
      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");

      await act(async () => {
        ref.current!.get().videoCallbacks.onError({ error: { errorString: "401 Unauthorized", code: -1013 } } as never);
        await new Promise((resolve) => setImmediate(resolve));
      });
      expect(ref.current!.get().state).toMatchObject({ type: "ERROR", canRetryWithTranscode: false });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
      });
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
    });

    it("ignores the previous channel's failed open after a flip", async () => {
      mockDetails.mockImplementation(async (id: string) => liveChannel({ Id: id, LiveStreamId: `ls-${id}`, liveTranscodeUrl: undefined }));
      let rejectFirst!: (error: Error) => void;
      mockStartLocalRemux.mockImplementationOnce(() => new Promise<string>((_resolve, reject) => (rejectFirst = reject)));
      const { ref, renderer } = await mount({ videoId: "video-1" });

      await act(async () => {
        renderer.update(<Harness ref={ref} videoId="video-2" />);
      });
      await act(async () => {
        for (let hop = 0; hop < 20; hop++) await Promise.resolve();
      });
      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");
      (closeLiveStream as jest.Mock).mockClear();

      await act(async () => {
        rejectFirst(new Error("outgoing channel failed"));
        for (let hop = 0; hop < 20; hop++) await Promise.resolve();
      });
      expect(closeLiveStream).not.toHaveBeenCalled();
      expect(ref.current!.get().state.type).not.toBe("ERROR");
    });
  });

  describe("stale runs", () => {
    const setTV = (value: boolean) => Object.defineProperty(Platform, "isTV", { configurable: true, value });
    const flush = async () => {
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
    };
    afterEach(() => setTV(false));

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
      expect(ref.current!.get().sourceUri).toBe("https://server/Videos/id/master.m3u8");

      await act(async () => {
        resolveA("http://127.0.0.1:9999/s/stale/master.m3u8");
      });
      await act(flush);
      expect(mockStopLocalRemux).toHaveBeenCalledWith("token:http://127.0.0.1:9999/s/stale/master.m3u8");
      expect(ref.current!.get().sourceUri).toBe("https://server/Videos/id/master.m3u8");
    });

    it("a metadata failure from an item the player already left raises no error", async () => {
      let rejectFirst!: (error: Error) => void;
      mockDetails.mockImplementation(async (id: string) => videoItem({ Id: id }));
      mockDetails.mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectFirst = reject)));
      const { ref, renderer } = await mount({ videoId: "video-1" });

      await act(async () => {
        renderer.update(<Harness ref={ref} videoId="video-2" />);
      });
      await act(flush);
      await act(async () => {
        rejectFirst(new Error("channel open timed out"));
      });
      await act(flush);

      expect(ref.current!.get().state.type).not.toBe("ERROR");
      expect(ref.current!.get().sourceUri).toBe("https://server/Videos/id/master.m3u8");
    });

    it("a pre-flight gone stale at its deadline leaves the next item's engine session for its own teardown", async () => {
      const A = "http://127.0.0.1:9999/s/a/master.m3u8";
      const B = "http://127.0.0.1:9999/s/b/master.m3u8";
      mockDetails.mockImplementation(async (id: string) => videoItem({ Id: id }));
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      mockStartLocalRemux.mockResolvedValueOnce(A).mockResolvedValue(B);
      mockPreflight = () => null;
      jest.useFakeTimers();
      try {
        const { ref, renderer } = await mount({ videoId: "video-1" });
        expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);

        mockPreflight = () => ({ token: `token:${B}`, generation: 0, segment: 0, produceSeconds: 1, segmentSeconds: 6, cushion: 0, throttled: false, thermal: "nominal" });
        await act(async () => {
          renderer.update(<Harness ref={ref} videoId="video-2" />);
        });
        for (let round = 0; round < 5 && ref.current!.get().sourceUri !== B; round++) {
          await act(async () => {
            jest.advanceTimersByTime(20);
            await flush();
          });
        }
        expect(ref.current!.get().sourceUri).toBe(B);

        // The first item's pre-flight reaches its deadline only now, with the second session live.
        await act(async () => {
          jest.advanceTimersByTime(20_000);
          await flush();
        });
        expect(mockStopLocalRemux).toHaveBeenCalledWith(`token:${A}`);
        mockStopLocalRemux.mockClear();

        await act(async () => {
          renderer.unmount();
        });
        expect(mockStopLocalRemux).toHaveBeenCalledWith(`token:${B}`);
      } finally {
        jest.useRealTimers();
      }
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
      mockPlaysFromDisk.mockReturnValue(true);
      const { renderer } = await mount({ videoId: "video-1" });

      await act(async () => {
        renderer.unmount();
      });

      expect(mockStopLocalRemux).toHaveBeenCalledWith(null);
    });
  });

  describe("player callbacks", () => {
    it("opens HDR fallback through the same complete-catalogue gateway contract", async () => {
      (isLocalRemuxAvailable as jest.Mock).mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      mockTierDeclared = true;
      (sourceIsHdr as jest.Mock).mockReturnValue(true);
      mockStartLocalRemux.mockRejectedValueOnce(new Error("encoder unavailable"));
      const details = videoItem({
        MediaStreams: [
          { Type: "Video", Index: 0, Codec: "hevc" },
          { Type: "Audio", Index: 3, Codec: "aac" },
          { Type: "Audio", Index: 7, Codec: "truehd" },
          { Type: "Subtitle", Index: 9, Codec: "pgssub" },
        ],
      });
      mockDetails.mockResolvedValue(details);
      (getAudioTracks as jest.Mock).mockReturnValue([{ Index: 3 }, { Index: 7 }]);
      const { ref, renderer } = await mount({ videoId: "video-1", startPositionTicks: 420_000_000 });

      expect(mockStartLocalRemux).toHaveBeenLastCalledWith(details, undefined, 42, { serverVideoOnly: true });
      expect(offeredTierBandwidths).toHaveBeenLastCalledWith(details, undefined, { serverVideoOnly: true });
      expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "transcode" });
      expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");
      expect(ref.current!.get().imageSubtitleSessionUrl).toBe(ref.current!.get().sourceUri);
      expect(ref.current!.get().currentTimeRef.current).toBe(42);
      expect(ref.current!.get().forwardBufferSeconds).toBe(12);
      const listener = (subscribeEngineLink as jest.Mock).mock.calls.at(-1)![1];
      await act(async () => listener({ bps: 1_500_000 }));
      expect(ref.current!.get().maxBitRate).toBe(1_200_000);
      await act(async () => listener({ bps: 100_000 }));
      expect(ref.current!.get().maxBitRate).toBe(496_000);
      expect(mockTranscodeUrl).not.toHaveBeenCalled();
      expect(prepareMultiAudioPlayback).not.toHaveBeenCalled();
      await act(async () => renderer.unmount());
    });

    it("retries a failed server gateway instead of silently dropping to an incomplete URL", async () => {
      (isLocalRemuxAvailable as jest.Mock).mockReturnValue(true);
      mockStartLocalRemux.mockRejectedValue(new Error("subtitle supplier unavailable"));
      const { ref, renderer } = await mount({ videoId: "video-1" });
      expect(mockStartLocalRemux).toHaveBeenCalledWith(expect.objectContaining({ Id: "video-1" }), undefined, undefined, { serverVideoOnly: true });
      expect(ref.current!.get().state).toMatchObject({ type: "ERROR", autoRetry: true });
      expect(ref.current!.get().sourceUri).toBeNull();
      expect(mockTranscodeUrl).not.toHaveBeenCalled();
      expect(prepareMultiAudioPlayback).not.toHaveBeenCalled();
      await act(async () => renderer.unmount());
    });

    it("reports an unsupported source's server processing without losing gateway controls", async () => {
      mockCanRemux.mockResolvedValue(true);
      mockTierDeclared = true;
      mockProgress = () => ({ alive: true, bytesRead: 100, readSeconds: 1, elapsedSeconds: 2, sourceState: "unavailable", recovering: false, hasPlayableSupplier: true });
      const { ref, renderer } = await mount({ videoId: "video-1" });
      const originalUrl = ref.current!.get().sourceUri;
      expect(ref.current!.get().state).toMatchObject({ mode: "transcode" });
      const listener = (subscribeEngineLink as jest.Mock).mock.calls.at(-1)![1];
      await act(async () => listener({ bps: 1_500_000 }));
      expect(ref.current!.get().maxBitRate).toBe(1_200_000);
      expect(ref.current!.get().sourceUri).toBe(originalUrl);
      expect(ref.current!.get().imageSubtitleSessionUrl).toBe(originalUrl);
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
      expect(mockTranscodeUrl).not.toHaveBeenCalled();
      await act(async () => renderer.unmount());
    });

    it("uses the full multi-audio fallback after engine startup fails and clears its cap", async () => {
      mockCanRemux.mockResolvedValue(true);
      mockStartLocalRemux.mockRejectedValue(new Error("encoder unavailable"));
      (slipstreamEligible as jest.Mock).mockReturnValue(true);
      (getQualitySettings as jest.Mock).mockResolvedValue({ mode: "fixed", index: 1, bitrate: 896_000 });
      (getAudioTracks as jest.Mock).mockReturnValue([{ Index: 3 }, { Index: 7 }]);
      (shouldUseMultiAudio as jest.Mock).mockReturnValue(true);
      (isMultiAudioAvailable as jest.Mock).mockReturnValue(true);
      const { ref, renderer } = await mount({ videoId: "video-1", startPositionTicks: 420_000_000 });

      expect(prepareMultiAudioPlayback).toHaveBeenCalledWith("video-1", expect.objectContaining({ Id: "video-1" }), "https://server/Videos/id/master.m3u8", "key");
      expect(ref.current!.get()).toMatchObject({ sourceUri: "jellyfin-multi://session", maxBitRate: null, forwardBufferSeconds: null, imageSubtitleSessionUrl: null });
      expect(ref.current!.get().state).toMatchObject({ mode: "transcode" });
      expect(mockTranscodeUrl.mock.calls[0].slice(2, 6)).toEqual([undefined, undefined, undefined, undefined]);
      await act(async () => renderer.unmount());
    });

    it.each(["image", "off"])("preserves all tracks, selected audio, %s subtitles, pause and position in server-gateway recovery", async (subtitleChoice) => {
      jest.useFakeTimers();
      try {
        (isLocalRemuxAvailable as jest.Mock).mockReturnValue(true);
        mockCanRemux.mockResolvedValue(true);
        mockTierDeclared = true;
        (sourceIsHdr as jest.Mock).mockReturnValue(true);
        const details = videoItem({
          MediaStreams: [
            { Type: "Video", Index: 0, Codec: "hevc" },
            { Type: "Audio", Index: 3, Codec: "aac", Language: "eng" },
            { Type: "Audio", Index: 7, Codec: "truehd", Language: "spa" },
            { Type: "Subtitle", Index: 9, Codec: "pgssub", Language: "eng" },
            { Type: "Subtitle", Index: 11, Codec: "subrip", Language: "eng" },
          ],
        });
        mockDetails.mockResolvedValue(details);
        (getAudioTracks as jest.Mock).mockImplementation(jest.requireActual("@/services/multiAudioLoader").getAudioTracks);
        (sessionSubtitleRenditions as jest.Mock).mockReturnValue([
          { index: 9, name: "English PGS", language: "eng", isImage: true },
          { index: 11, name: "English Text", language: "eng", isImage: false },
        ]);
        (resolveSubtitlePick as jest.Mock).mockImplementation(jest.requireActual("@/services/localRemux").resolveSubtitlePick);
        (observedFromReport as jest.Mock).mockImplementation(jest.requireActual("@/services/subtitlePreference").observedFromReport);
        const textTracks = (imageSelected: boolean, textSelected = false) => [
          { index: 0, title: "English PGS", language: "eng", selected: imageSelected },
          { index: 1, title: "English Text", language: "eng", selected: textSelected },
        ];
        const { ref, renderer } = await mount({ videoId: "video-1" });
        await act(async () => {
          ref.current!.get().videoCallbacks.onLoad({ duration: 120 } as never);
          jest.advanceTimersByTime(101);
        });
        await act(async () => {
          ref.current!.get().play();
        });
        await act(async () => {
          ref.current!.get().videoCallbacks.onProgress({ currentTime: 42, playableDuration: 60, seekableDuration: 120 } as never);
          ref.current!.get().videoCallbacks.onAudioTracks({
            audioTracks: [
              { index: 0, selected: true },
              { index: 1, selected: false },
            ],
          } as never);
          ref.current!.get().videoCallbacks.onTextTracks({ textTracks: textTracks(false, true) } as never);
          jest.advanceTimersByTime(501);
        });
        await act(async () => {
          ref.current!.get().videoCallbacks.onAudioTracks({
            audioTracks: [
              { index: 0, selected: false },
              { index: 1, selected: true },
            ],
          } as never);
          ref.current!.get().videoCallbacks.onTextTracks({ textTracks: textTracks(subtitleChoice === "image") } as never);
          ref.current!.get().pause();
        });
        await act(async () => {
          ref.current!.get().videoCallbacks.onError({ error: { code: -12971, domain: "CoreMediaErrorDomain" } } as never);
          jest.advanceTimersByTime(1);
        });
        await act(async () => {
          jest.advanceTimersByTime(500);
          for (let hop = 0; hop < 30; hop++) await Promise.resolve();
        });
        expect(mockStartLocalRemux).toHaveBeenLastCalledWith(details, 7, 42, { serverVideoOnly: true });
        expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "transcode" });
        expect(ref.current!.get().sourceUri).toBe("http://127.0.0.1:9999/s/abc/master.m3u8");
        expect(ref.current!.get().imageSubtitleSessionUrl).toBe(ref.current!.get().sourceUri);
        expect(mockTranscodeUrl).not.toHaveBeenCalled();
        expect(prepareMultiAudioPlayback).not.toHaveBeenCalled();
        await act(async () => {
          ref.current!.get().videoCallbacks.onLoad({ duration: 120 } as never);
          ref.current!.get().videoCallbacks.onAudioTracks({
            audioTracks: [
              { index: 0, selected: false },
              { index: 1, selected: true },
            ],
          } as never);
          ref.current!.get().videoCallbacks.onTextTracks({ textTracks: textTracks(false, true) } as never);
          jest.advanceTimersByTime(101);
        });
        expect(ref.current!.get().selectedAudioTrack).toEqual({ type: "index", value: "0" });
        expect(ref.current!.get().selectedTextTrack).toEqual(subtitleChoice === "image" ? { type: "index", value: "0" } : { type: "disabled" });
        await act(async () => {
          ref.current!.get().videoCallbacks.onTextTracks({ textTracks: textTracks(subtitleChoice === "image") } as never);
        });
        expect(ref.current!.get().activeImageSubtitleStream).toBe(subtitleChoice === "image" ? 9 : null);
        expect(ref.current!.get().paused).toBe(true);
        expect(ref.current!.get().currentTimeRef.current).toBe(42);
        expect(mockStartLocalRemux).toHaveBeenCalledTimes(2);
        await act(async () => renderer.unmount());
      } finally {
        jest.useRealTimers();
      }
    });

    it.each([
      { hasPlayableSupplier: true, grace: ENGINE_SEGMENT_DEADLINE_MS },
      { hasPlayableSupplier: false, grace: 0 },
    ])("bounds server-only gateway initialization with supplier viability $hasPlayableSupplier", async ({ hasPlayableSupplier, grace }) => {
      jest.useFakeTimers();
      try {
        (isLocalRemuxAvailable as jest.Mock).mockReturnValue(true);
        mockTierDeclared = true;
        mockProgress = () => ({ alive: true, bytesRead: 0, readSeconds: 0, elapsedSeconds: 60, sourceState: "unavailable", recovering: false, hasPlayableSupplier });
        const { ref, renderer } = await mount({ videoId: "video-1" });
        expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "transcode" });
        (engineProgress as jest.Mock).mockClear();
        await act(async () => jest.advanceTimersByTime(VOD_OPEN_DEADLINE_MS - 1));
        expect(engineProgress).not.toHaveBeenCalled();
        await act(async () => jest.advanceTimersByTime(1));
        expect(engineProgress).toHaveBeenCalledTimes(1);
        if (grace > 0) {
          await act(async () => jest.advanceTimersByTime(grace / 2));
          await act(async () => {
            ref.current!.get().videoCallbacks.onError({ error: { code: -12889, domain: "CoreMediaErrorDomain" } } as never);
          });
          expect(engineProgress).toHaveBeenCalledTimes(1);
          await act(async () => jest.advanceTimersByTime(grace / 2));
        }
        await act(async () => jest.advanceTimersByTime(1));
        expect(ref.current!.get().state).toMatchObject({ type: "ERROR", autoRetry: true });
        expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
        await act(async () => {
          jest.advanceTimersByTime(500);
          for (let hop = 0; hop < 30; hop++) await Promise.resolve();
        });
        expect(mockStartLocalRemux).toHaveBeenCalledTimes(2);
        expect(mockStartLocalRemux).toHaveBeenLastCalledWith(expect.objectContaining({ Id: "video-1" }), undefined, undefined, { serverVideoOnly: true });
        await act(async () => renderer.unmount());
      } finally {
        jest.useRealTimers();
      }
    });

    it("lets a viable recovering supplier recover on the same item when the playhead advances", async () => {
      jest.useFakeTimers();
      try {
        mockCanRemux.mockResolvedValue(true);
        mockTierDeclared = true;
        mockProgress = () => ({ alive: true, bytesRead: 100, readSeconds: 1, elapsedSeconds: 2, recovering: true, hasPlayableSupplier: true });
        const { ref, renderer } = await mount({ videoId: "video-1" });
        const originalUrl = ref.current!.get().sourceUri;
        ref.current!.get().currentTimeRef.current = 12;
        await act(async () => {
          ref.current!.get().videoCallbacks.onError({ error: { code: -12889, domain: "CoreMediaErrorDomain" } } as never);
        });
        expect(engineProgress).toHaveBeenCalledWith("token:http://127.0.0.1:9999/s/abc/master.m3u8");
        expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
        await act(async () => {
          ref.current!.get().videoCallbacks.onProgress({ currentTime: 13, playableDuration: 20, seekableDuration: 120 } as never);
          jest.advanceTimersByTime(20_000);
        });
        expect(ref.current!.get().sourceUri).toBe(originalUrl);
        expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
        expect(mockTranscodeUrl).not.toHaveBeenCalled();
        await act(async () => renderer.unmount());
      } finally {
        jest.useRealTimers();
      }
    });

    it("bounds a recovering supplier's stall instead of ignoring it forever", async () => {
      jest.useFakeTimers();
      try {
        mockCanRemux.mockResolvedValue(true);
        mockTierDeclared = true;
        mockProgress = () => ({ alive: true, bytesRead: 100, readSeconds: 1, elapsedSeconds: 2, recovering: true, hasPlayableSupplier: true });
        const { ref, renderer } = await mount({ videoId: "video-1" });
        ref.current!.get().currentTimeRef.current = 12;
        await act(async () => {
          ref.current!.get().videoCallbacks.onError({ error: { code: -12889, domain: "CoreMediaErrorDomain" } } as never);
        });
        await act(async () => {
          jest.advanceTimersByTime(19_999);
        });
        expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
        await act(async () => {
          jest.advanceTimersByTime(2);
          for (let hop = 0; hop < 30; hop++) await Promise.resolve();
        });
        expect(mockStopLocalRemux).toHaveBeenCalledWith("token:http://127.0.0.1:9999/s/abc/master.m3u8");
        expect(ref.current!.get().state).toMatchObject({ type: "ERROR", autoRetry: true, retryGateway: true });
        await act(async () => {
          jest.advanceTimersByTime(500);
          for (let hop = 0; hop < 30; hop++) await Promise.resolve();
        });
        expect(mockStartLocalRemux).toHaveBeenCalledTimes(2);
        expect(mockStartLocalRemux.mock.calls[1][2]).toBe(12);
        expect(mockStartLocalRemux.mock.calls[1][3]).toBeUndefined();
        await act(async () => renderer.unmount());
      } finally {
        jest.useRealTimers();
      }
    });

    it.each(["Connection reset", "Connection timed out", "playback did not start"])("keeps original-capable gateway retries after repeated %s failures", async (errorString) => {
      jest.useFakeTimers();
      try {
        (isLocalRemuxAvailable as jest.Mock).mockReturnValue(true);
        mockCanRemux.mockResolvedValue(true);
        mockTierDeclared = true;
        mockProgress = () => ({ alive: true, bytesRead: 0, readSeconds: 0, elapsedSeconds: 2, recovering: false, hasPlayableSupplier: false });
        const { ref, renderer } = await mount({ videoId: "video-1" });
        ref.current!.get().currentTimeRef.current = 42;
        for (const delay of [500, 1000]) {
          await act(async () => {
            ref.current!.get().videoCallbacks.onError({ error: { errorString } } as never);
          });
          await act(async () => jest.advanceTimersByTime(1));
          expect(ref.current!.get().state).toMatchObject({ type: "ERROR", retryGateway: true });
          await act(async () => {
            jest.advanceTimersByTime(delay);
            for (let hop = 0; hop < 30; hop++) await Promise.resolve();
          });
          expect(mockStartLocalRemux).toHaveBeenLastCalledWith(expect.objectContaining({ Id: "video-1" }), undefined, 42);
          expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "localRemux" });
        }
        expect(mockStartLocalRemux).toHaveBeenCalledTimes(3);
        expect(mockTranscodeUrl).not.toHaveBeenCalled();
        await act(async () => renderer.unmount());
      } finally {
        jest.useRealTimers();
      }
    });

    it("ignores late native callbacks and progress reads after the item changes", async () => {
      mockCanRemux.mockResolvedValue(true);
      mockTierDeclared = true;
      let finishProgress!: (progress: null) => void;
      const { ref, renderer } = await mount({ videoId: "video-1" });
      (engineProgress as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishProgress = resolve;
          }),
      );
      const oldCallbacks = ref.current!.get().videoCallbacks;
      const oldLink = (subscribeEngineLink as jest.Mock).mock.calls.at(-1)![1];
      await act(async () => {
        oldCallbacks.onError({ error: { code: -12889, domain: "CoreMediaErrorDomain" } } as never);
      });
      mockDetails.mockResolvedValue(videoItem({ Id: "video-2" }));
      await act(async () => {
        renderer.update(<Harness ref={ref} videoId="video-2" />);
      });
      const state = ref.current!.get().state;
      const starts = mockStartLocalRemux.mock.calls.length;
      await act(async () => {
        finishProgress(null);
        oldCallbacks.onError({ error: { errorString: "old failure" } } as never);
        oldLink({ bps: 100_000_000 });
      });
      expect(ref.current!.get().state).toBe(state);
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(starts);
      expect(ref.current!.get().maxBitRate).toBeNull();
      await act(async () => renderer.unmount());
    });

    it("retries server startup failures with increasing delays and cancels on exit", async () => {
      jest.useFakeTimers();
      try {
        const { ref, renderer } = await mount({ videoId: "video-1" });
        for (const delay of [500, 1000, 2000]) {
          const starts = mockTranscodeUrl.mock.calls.length;
          await act(async () => {
            ref.current!.get().videoCallbacks.onError({ error: { errorString: "Connection reset" } } as never);
            jest.advanceTimersByTime(1);
          });
          expect(ref.current!.get().state).toMatchObject({ type: "ERROR", autoRetry: true, canRetryWithTranscode: true });
          await act(async () => {
            jest.advanceTimersByTime(delay - 1);
          });
          expect(mockTranscodeUrl).toHaveBeenCalledTimes(starts);
          await act(async () => {
            jest.advanceTimersByTime(1);
            for (let hop = 0; hop < 30; hop++) await Promise.resolve();
          });
          expect(mockTranscodeUrl).toHaveBeenCalledTimes(starts + 1);
        }
        await act(async () => {
          ref.current!.get().videoCallbacks.onError({ error: { errorString: "Connection reset" } } as never);
          jest.advanceTimersByTime(1);
        });
        await act(async () => renderer.unmount());
        const starts = mockTranscodeUrl.mock.calls.length;
        await act(async () => {
          jest.advanceTimersByTime(30_000);
        });
        expect(mockTranscodeUrl).toHaveBeenCalledTimes(starts);
      } finally {
        jest.useRealTimers();
      }
    });

    it.each(["auto", "fixed"])("keeps the %s cap when a link report arrives during engine startup", async (mode) => {
      mockNeedsTranscoding.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      mockTierDeclared = true;
      (slipstreamEligible as jest.Mock).mockReturnValue(true);
      (getQualitySettings as jest.Mock).mockResolvedValue({ mode, index: 1, bitrate: 896_000 });
      (subscribeEngineLink as jest.Mock).mockImplementation((token, listener) => {
        listener({ token, bps: 1_500_000, copyListed: false });
        return jest.fn();
      });
      const { ref, renderer } = await mount({ videoId: "video-1" });
      expect(ref.current!.get().maxBitRate).toBe(mode === "fixed" ? 896_000 : 1_200_000);
      const listener = (subscribeEngineLink as jest.Mock).mock.calls.at(-1)![1];
      await act(async () => {
        listener({ bps: 30_000_000, copyListed: false });
      });
      expect(mockStartLocalRemux).toHaveBeenCalledTimes(1);
      expect(mockProbeEmit).not.toHaveBeenCalledWith("fallback", expect.objectContaining({ reason: "link recovered above source" }));
      await act(async () => renderer.unmount());
      mockProbeEmit.mockClear();
      listener({ bps: 600_000, copyListed: false });
      expect(mockProbeEmit).not.toHaveBeenCalled();
    });

    it("records display readiness separately from playback progress", async () => {
      const { ref, renderer } = await mount({ videoId: "video-1" });
      const result = ref.current!.get();
      result.currentTimeRef.current = 3;
      mockProbeEmit.mockClear();
      result.videoCallbacks.onReadyForDisplay();
      expect(mockProbeEmit).toHaveBeenCalledWith("displayReady", { position: 3 });
      expect(mockProbeEmit).not.toHaveBeenCalledWith("playing", expect.anything());
      await act(async () => renderer.unmount());
      mockProbeEmit.mockClear();
      result.videoCallbacks.onReadyForDisplay();
      expect(mockProbeEmit).not.toHaveBeenCalled();
    });

    it("records AVPlayer's indicated bitrate at the playhead without changing the cap", async () => {
      const { ref, renderer } = await mount({ videoId: "video-1" });
      const result = ref.current!.get();
      result.currentTimeRef.current = 2.25;
      const cap = result.maxBitRate;
      const state = result.state;

      await act(async () => {
        result.videoCallbacks.onBandwidthUpdate({ bitrate: 6_256_603 });
      });

      expect(mockProbeEmit).toHaveBeenCalledWith("access", { indicated: 6_256_603, position: 2.25 });
      expect(ref.current!.get().maxBitRate).toBe(cap);
      expect(ref.current!.get().state).toBe(state);
      await act(async () => renderer.unmount());

      mockProbeEmit.mockClear();
      result.videoCallbacks.onBandwidthUpdate({ bitrate: 260_000 });
      expect(mockProbeEmit).not.toHaveBeenCalled();
    });

    it("does not record an unknown or invalid indicated bitrate", async () => {
      const { ref, renderer } = await mount({ videoId: "video-1" });
      mockProbeEmit.mockClear();

      for (const bitrate of [-1, 0, NaN, Infinity]) {
        ref.current!.get().videoCallbacks.onBandwidthUpdate({ bitrate });
      }

      expect(mockProbeEmit).not.toHaveBeenCalled();
      await act(async () => renderer.unmount());
    });

    it("does not label Android's bandwidth estimate as AVPlayer's indicated bitrate", async () => {
      const originalOS = Platform.OS;
      try {
        const { ref, renderer } = await mount({ videoId: "video-1" });
        Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
        mockProbeEmit.mockClear();
        ref.current!.get().videoCallbacks.onBandwidthUpdate({ bitrate: 6_256_603 });
        expect(mockProbeEmit).not.toHaveBeenCalled();
        await act(async () => renderer.unmount());
      } finally {
        Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
      }
    });

    it("reaches PLAYING through onLoad and onProgress", async () => {
      const { ref } = await mount({ videoId: "video-1" });

      await act(async () => {
        ref.current!.get().videoCallbacks.onLoad({ duration: 120, currentTime: 0, naturalSize: { width: 1920, height: 1080, orientation: "landscape" } } as never);
      });
      expect(ref.current!.get().state).toMatchObject({ type: "READY", mode: "transcode" });

      // PLAYER_PLAYING rides the paused edge, so unpause before the tick.
      await act(async () => {
        ref.current!.get().play();
      });
      expect(ref.current!.get().paused).toBe(false);

      await act(async () => {
        ref.current!.get().videoCallbacks.onProgress({ currentTime: 3, playableDuration: 30, seekableDuration: 120 } as never);
        await new Promise((resolve) => setImmediate(resolve));
      });
      expect(ref.current!.get().state).toMatchObject({ type: "PLAYING", mode: "transcode" });
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

    it("automatically retries a failed server item", async () => {
      const { ref } = await mount({ videoId: "video-1" });

      await act(async () => {
        ref.current!.get().videoCallbacks.onError({ error: { errorString: "boom", code: -11800 } } as never);
      });

      expect(ref.current!.get().state).toMatchObject({ type: "ERROR", canRetryWithTranscode: true });
    });

    // The retry effect latches the transcode rung for every failure that is not direct play.
    // A held file taking that latch lands on the server, which offline is where the engine
    // failure became a dead end instead of a film playing without its sidecar.
    it("replays a held file from disk, not from the server, when its engine lane fails", async () => {
      mockPlaysFromDisk.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      (getTextSubtitleStreams as jest.Mock).mockReturnValue([{ Type: "Subtitle", Index: 2, Codec: "subrip", IsExternal: true }]);

      const { ref } = await mount({ videoId: "video-1" });
      expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "localRemux" });

      // Faked only from here: the 500ms the retry effect waits before it re-picks the lane.
      jest.useFakeTimers();
      try {
        await act(async () => {
          ref.current!.get().videoCallbacks.onError({ error: { errorString: "Could not connect to the server.", code: -1004 } } as never);
        });
        // Two advances: the first lets the deferred error dispatch land, which is what schedules
        // the retry; the second fires that retry. The re-pick then runs several awaits deep.
        await act(async () => {
          jest.advanceTimersByTime(600);
        });
        expect(ref.current!.get().state).toMatchObject({ type: "ERROR", canRetryWithTranscode: true });
        await act(async () => {
          jest.advanceTimersByTime(600);
          for (let hop = 0; hop < 20; hop++) await Promise.resolve();
        });

        expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "direct" });
        expect(mockTranscodeUrl).not.toHaveBeenCalled();
        expect(mockStopLocalRemux).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    // Two failures for one session: RNV registers its AVPlayerItemFailedToPlayToEndTime
    // observer with object: nil, so any item's failure reaches every mounted player, and the
    // second player alive during a queue advance is inside that window.
    it("replays from disk even when a second error lands before the retry", async () => {
      mockPlaysFromDisk.mockReturnValue(true);
      mockCanRemux.mockResolvedValue(true);
      (getTextSubtitleStreams as jest.Mock).mockReturnValue([{ Type: "Subtitle", Index: 2, Codec: "subrip", IsExternal: true }]);

      const { ref } = await mount({ videoId: "video-1" });
      expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "localRemux" });

      jest.useFakeTimers();
      try {
        const boom = { error: { errorString: "Could not connect to the server.", code: -1004 } } as never;
        await act(async () => {
          ref.current!.get().videoCallbacks.onError(boom);
          ref.current!.get().videoCallbacks.onError(boom);
        });
        await act(async () => {
          jest.advanceTimersByTime(600);
        });
        await act(async () => {
          jest.advanceTimersByTime(600);
          for (let hop = 0; hop < 20; hop++) await Promise.resolve();
        });

        expect(ref.current!.get().state).toMatchObject({ type: "INITIALIZING_PLAYER", mode: "direct" });
        expect(mockTranscodeUrl).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
