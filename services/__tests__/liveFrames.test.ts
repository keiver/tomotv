/**
 * The live frame sampler: one grab at a time, a burst per open looped at a fixed dwell, frames streamed to the
 * card as the grab writes them, a refresh that backs off while a live edge stands still, the oldest first, a
 * manifest channel read at its origin and a tuner channel opened on the server for its burst and closed after,
 * backoff on failure, and standing down for the screen, the app and playback.
 */
const mockLiveFrame = jest.fn();
const mockEmitterListeners = new Map<string, Set<(event: unknown) => void>>();
const mockOnDisk = jest.fn();
const mockCancel = jest.fn();
const mockResolveOrigin = jest.fn();
const mockOpenChannel = jest.fn();
const mockCloseLiveStream = jest.fn();
const mockOpenRecentlyFailed = jest.fn((_id: string) => false);
const mockPreferences = { filter: "all" as string };
const mockPreferenceListeners = new Set<() => void>();
let appStateListener: ((state: string) => void) | null = null;

jest.mock("react-native", () => {
  const AppState = {
    currentState: "active",
    // RN updates currentState before any listener hears the change.
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appStateListener = (state) => {
        AppState.currentState = state;
        listener(state);
      };
      return { remove: jest.fn() };
    },
  };
  class NativeEventEmitter {
    addListener(event: string, listener: (body: unknown) => void) {
      let set = mockEmitterListeners.get(event);
      if (!set) {
        set = new Set();
        mockEmitterListeners.set(event, set);
      }
      set.add(listener);
      return { remove: () => set!.delete(listener) };
    }
  }
  return {
    Platform: { OS: "ios", isTV: true, select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    AppState,
    NativeEventEmitter,
    NativeModules: {
      LocalRemuxer: {
        liveFrame: (config: unknown) => mockLiveFrame(config),
        liveFramesOnDisk: (ids: string[]) => mockOnDisk(ids),
        cancelLiveFrame: (id: string) => mockCancel(id),
      },
    },
  };
});
const mockShowLivePreview = jest.fn();
jest.mock("@keiver/tomo-live/src/livePreview", () => ({ showLivePreview: (id: string | null) => mockShowLivePreview(id), stopLivePreview: jest.fn() }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/localRemux", () => ({ isLocalRemuxAvailable: () => true, nativeEmits: (event: string) => event === "onLiveFrame" }));
jest.mock("@keiver/tomo-engine", () => ({ ...jest.requireActual("@keiver/tomo-engine"), isLocalRemuxAvailable: () => true, nativeEmits: (event: string) => event === "onLiveFrame" }));
jest.mock("@/services/liveTvPreferences", () => ({
  getLiveTvPreferences: () => mockPreferences,
  subscribeLiveTvPreferences: (listener: () => void) => {
    mockPreferenceListeners.add(listener);
    return () => mockPreferenceListeners.delete(listener);
  },
}));
const pickGroup = (filter: string) => {
  mockPreferences.filter = filter;
  for (const listener of mockPreferenceListeners) listener();
};
jest.mock("@/services/jellyfinApi", () => ({
  resolveChannelOrigin: (id: string) => mockResolveOrigin(id),
  openChannel: (id: string, item: unknown, options: unknown) => mockOpenChannel(id, item, options),
  closeLiveStream: (id: string) => mockCloseLiveStream(id),
  openRecentlyFailed: (id: string) => mockOpenRecentlyFailed(id),
}));
jest.mock("@keiver/tomo-live/src/openFailures", () => ({ noteOpenFailed: jest.fn(), openRecentlyFailed: (id: string) => mockOpenRecentlyFailed(id) }));

import {
  clearLiveFrames,
  LIVE_FRAME_BURST_COUNT,
  LIVE_FRAME_CAP_COOLDOWN_MS,
  LIVE_FRAME_COLD_COUNT,
  LIVE_FRAME_COLD_DEADLINE_S,
  LIVE_FRAME_CLIP_S,
  LIVE_FRAME_EXPIRY_MS,
  LIVE_FRAME_REFRESH_CAP_MS,
  LIVE_FRAME_REFRESH_MS,
  LIVE_FRAME_RETRY_MS,
  LIVE_FRAME_SPACING_MS,
  liveClipFor,
  liveFrameDueAt,
  liveFrameFor,
  liveFrameReel,
  setLiveFrameFocus,
  clearLiveFrameFocus,
  LIVE_FRAME_FOCUS_DWELL_MS,
  LIVE_FRAME_FOCUS_REFRESH_MS,
  setLiveFramesActive,
  setLiveFrameViewable,
  subscribeLiveFrame,
} from "@/services/liveFrames";
import { healthFor } from "@/services/channelHealth";
import { setPlaybackHold } from "@/services/playbackHold";
import { AppState } from "react-native";

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
const advance = async (ms: number) => {
  jest.advanceTimersByTime(ms);
  await flush();
};
const grabs = () => mockLiveFrame.mock.calls.map(([config]) => (config as { channelId: string }).channelId);
const emitLiveFrame = (body: { channelId: string; uri: string; index: number }) => {
  for (const listener of mockEmitterListeners.get("onLiveFrame") ?? []) listener(body);
};
/** A burst of `count` files under one stamp, the shape the engine answers with. */
const burst = (channelId: string, stamp: number, count = LIVE_FRAME_BURST_COUNT) => Array.from({ length: count }, (_, i) => `file:///pool/${channelId}/live-${stamp}-${i}.jpg`);
/** The newest frame of a full burst, the one a card rests on. */
const LAST_FRAME = LIVE_FRAME_BURST_COUNT - 1;
/** The pool's answer for a channel: its newest burst and when its validity counts from. */
const onDisk = (channelId: string, at: number, count = LIVE_FRAME_BURST_COUNT) => ({ uris: burst(channelId, at, count), at });

describe("live frames", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    mockLiveFrame.mockReset().mockImplementation(async ({ channelId }: { channelId: string }) => ({ uris: burst(channelId, Date.now()), pts: Date.now(), cancelled: false }));
    mockOnDisk.mockReset().mockResolvedValue({});
    mockCancel.mockReset().mockResolvedValue(undefined);
    mockResolveOrigin.mockReset().mockImplementation(async (id: string) => (id.startsWith("m") ? { url: `https://origin/${id}.m3u8`, headers: { "User-Agent": "Tuner" } } : null));
    mockOpenChannel.mockReset().mockImplementation(async (id: string) => ({ Id: id, LiveStreamId: `ls-${id}`, liveStreamUrl: `https://jf/LiveTv/LiveStreamFiles/${id}/stream.ts` }));
    mockCloseLiveStream.mockReset().mockResolvedValue(undefined);
    mockOpenRecentlyFailed.mockReset().mockReturnValue(false);
    setPlaybackHold("video", false);
    clearLiveFrames();
    setLiveFrameViewable("guide", []);
    setLiveFramesActive("guide", false);
  });

  afterEach(async () => {
    setLiveFrameFocus(null);
    setLiveFramesActive("guide", false);
    setLiveFramesActive("wall", false);
    // A grab still resolving lets go of its slot before the next test starts.
    await flush();
    await flush();
    jest.useRealTimers();
  });

  it("grabs the viewable channels one at a time, a manifest one at its origin with its headers", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "m2"]);
    await advance(0);
    expect(grabs()).toEqual(["m1"]);
    // The first grab for a bare card takes the short cold profile and its clip; one open either way.
    expect(mockLiveFrame.mock.calls[0][0]).toMatchObject({
      channelId: "m1",
      inputUrl: "https://origin/m1.m3u8",
      httpHeaders: { "User-Agent": "Tuner" },
      count: LIVE_FRAME_COLD_COUNT,
      deadline: LIVE_FRAME_COLD_DEADLINE_S,
      clipSpan: LIVE_FRAME_CLIP_S,
    });
    expect(liveFrameFor("m1")).toEqual({ uri: `file:///pool/m1/live-1000000-${LAST_FRAME}.jpg`, cacheKey: `live-m1-1000000-${LAST_FRAME}` });
    expect(mockOnDisk).toHaveBeenCalledWith(["m1", "m2"]);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m2"]);
    expect(mockOpenChannel).not.toHaveBeenCalled();
  });

  it("holds the newest frame at rest and moves only when a grab brings a newer one", async () => {
    const listener = jest.fn();
    subscribeLiveFrame("m1", listener);
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(listener).toHaveBeenCalledTimes(1);
    const resting = liveFrameFor("m1");
    expect(resting?.uri).toBe(`file:///pool/m1/live-1000000-${LAST_FRAME}.jpg`);
    await advance(LIVE_FRAME_REFRESH_MS - 1);
    expect(liveFrameFor("m1")).toBe(resting);
    expect(listener).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(liveFrameFor("m1")?.uri).toBe(`file:///pool/m1/live-${1_000_000 + LIVE_FRAME_REFRESH_MS}-${LAST_FRAME}.jpg`);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("asks the first grab for a preview clip and hands the file to the card with its picture", async () => {
    mockLiveFrame.mockImplementation(async ({ channelId, clipSpan }: { channelId: string; clipSpan: number }) => ({
      uris: burst(channelId, Date.now()),
      clip: clipSpan > 0 ? `file:///pool/${channelId}/live-${Date.now()}-clip.mp4` : null,
      pts: Date.now(),
      cancelled: false,
    }));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(mockLiveFrame.mock.calls[0][0]).toMatchObject({ clipSpan: LIVE_FRAME_CLIP_S });
    const clip = liveClipFor("m1");
    expect(clip).toEqual({ uri: "file:///pool/m1/live-1000000-clip.mp4", cacheKey: "live-m1-1000000-clip" });
    await advance(LIVE_FRAME_REFRESH_MS);
    expect(mockLiveFrame.mock.calls[1][0]).toMatchObject({ clipSpan: LIVE_FRAME_CLIP_S, shownUri: "file:///pool/m1/live-1000000-0.jpg" });
    expect(liveClipFor("m1")).not.toBe(clip);
  });

  it("grabs the focused row first, then its siblings in view nearest first, no dwell needed", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameFocus("m4");
    setLiveFrameViewable("guide", ["m1", "m2", "m3", "m4", "m5"]);
    await advance(0);
    for (let i = 0; i < 5; i += 1) await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m4", "m3", "m5", "m2", "m1"]);
    setLiveFrameFocus(null);
  });

  it("reads a picture still missing its clip again at once, and waits the refresh when a grab brought none", async () => {
    mockOnDisk.mockResolvedValue({ m1: onDisk("m1", 1_000_000 - 2_000, 2) });
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(grabs()).toEqual(["m1"]);
    expect(mockLiveFrame.mock.calls[0][0]).toMatchObject({ clipSpan: LIVE_FRAME_CLIP_S, shownPts: undefined, shownUri: undefined });
    await advance(LIVE_FRAME_REFRESH_MS - 1);
    expect(grabs()).toEqual(["m1"]);
    await advance(1);
    expect(grabs()).toEqual(["m1", "m1"]);
  });

  it("stops a refresh for a focused card still missing its picture, never another card's first grab", async () => {
    const answers = new Map<string, (result: unknown) => void>();
    mockOnDisk.mockResolvedValue({
      m1: { ...onDisk("m1", 1_000_000 - LIVE_FRAME_REFRESH_MS - 1, 2), clip: "file:///pool/m1/c.mp4" },
      m2: { ...onDisk("m2", 1_000_000 - LIVE_FRAME_REFRESH_MS - 1, 2), clip: "file:///pool/m2/c.mp4" },
    });
    mockLiveFrame.mockImplementation(({ channelId }: { channelId: string }) => new Promise((resolve) => answers.set(channelId, resolve)));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "m2", "m3"]);
    await advance(0);
    expect(grabs()).toEqual(["m3"]);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m3", "m1"]);
    answers.get("m3")?.({ uris: burst("m3", Date.now()), pts: 1, cancelled: false });
    await flush();
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m3", "m1", "m2"]);
    setLiveFrameViewable("guide", ["m1", "m2", "m3", "m4"]);
    expect(mockCancel).not.toHaveBeenCalled();
    setLiveFrameFocus("m4");
    expect(mockCancel.mock.calls).toEqual([["m1"]]);
    setLiveFrameFocus(null);
    for (const answer of answers.values()) answer({ uris: [], cancelled: true });
    await flush();
  });

  it("follows focus as it moves, and falls back to view order once it clears", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameFocus("m5");
    setLiveFrameViewable("guide", ["m1", "m2", "m3", "m4", "m5"]);
    await advance(0);
    expect(grabs()).toEqual(["m5"]);
    setLiveFrameFocus("m1");
    await advance(0);
    expect(grabs()).toEqual(["m5", "m1"]);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m5", "m1", "m2"]);
    setLiveFrameFocus(null);
    await advance(LIVE_FRAME_SPACING_MS);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m5", "m1", "m2", "m3", "m4"]);
  });

  it("keeps view order while focus sits on a channel out of view", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameFocus("m9");
    setLiveFrameViewable("guide", ["m1", "m2", "m3"]);
    await advance(0);
    for (let i = 0; i < 3; i += 1) await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m2", "m3"]);
    setLiveFrameFocus(null);
  });

  it("orders the wall's cards by its focused card too", async () => {
    setLiveFramesActive("wall", true);
    setLiveFrameFocus("m3");
    setLiveFrameViewable("wall", ["m1", "m2", "m3", "m4"]);
    await advance(0);
    for (let i = 0; i < 4; i += 1) await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m3", "m2", "m4", "m1"]);
    setLiveFrameFocus(null);
  });

  it("starts a focused card missing its picture at once, without waiting out the dwell or a refresh", async () => {
    mockOnDisk.mockResolvedValue({
      m1: { ...onDisk("m1", 1_000_000 - 1_000, 2), clip: "file:///pool/m1/c.mp4" },
      m2: { ...onDisk("m2", 1_000_000 - 1_000, 2), clip: "file:///pool/m2/c.mp4" },
    });
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "m2"]);
    await advance(0);
    expect(grabs()).toEqual([]);
    setLiveFrameViewable("guide", ["m1", "m2", "m3"]);
    setLiveFrameFocus("m3");
    await advance(0);
    expect(grabs()).toEqual(["m3"]);
    setLiveFrameFocus(null);
  });

  it("takes a card that never failed before one retrying past its backoff", async () => {
    mockLiveFrame.mockImplementation(async ({ channelId }: { channelId: string }) =>
      channelId === "m1" && grabs().filter((id) => id === "m1").length === 1 ? { uris: [], cancelled: false, reason: "frame" } : { uris: burst(channelId, Date.now()), pts: 1, cancelled: false },
    );
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(grabs()).toEqual(["m1"]);
    expect(liveFrameFor("m1")).toBeUndefined();
    // Both become eligible in the same pass: m1 past its backoff, m2 never tried.
    setLiveFramesActive("guide", false);
    await advance(LIVE_FRAME_RETRY_MS);
    setLiveFrameViewable("guide", ["m1", "m2"]);
    setLiveFramesActive("guide", true);
    await advance(0);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m2", "m1"]);
  });

  it("never grabs a card missing its picture before its backoff passes, focused or not", async () => {
    mockLiveFrame.mockImplementation(async () => ({ uris: [], cancelled: false, reason: "frame" }));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(grabs()).toEqual(["m1"]);
    setLiveFrameFocus("m1");
    await advance(LIVE_FRAME_FOCUS_DWELL_MS);
    await advance(LIVE_FRAME_RETRY_MS - LIVE_FRAME_FOCUS_DWELL_MS - 1);
    expect(grabs()).toEqual(["m1"]);
    await advance(1);
    expect(grabs()).toEqual(["m1", "m1"]);
    setLiveFrameFocus(null);
  });

  it("asks a cancelled first grab again on the next slot", async () => {
    let first = true;
    mockLiveFrame.mockImplementation(async ({ channelId }: { channelId: string }) => {
      if (first) {
        first = false;
        return { uris: [], cancelled: true };
      }
      return { uris: burst(channelId, Date.now()), pts: 1, cancelled: false };
    });
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m1"]);
    expect(liveFrameFor("m1")).toBeDefined();
  });

  it("lets a refresh answer unchanged once a grab asked for the clip and brought none", async () => {
    mockLiveFrame.mockImplementation(async ({ channelId }: { channelId: string }) => ({ uris: burst(channelId, Date.now(), 2), pts: 7, cancelled: false }));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(liveClipFor("m1")).toBeUndefined();
    await advance(LIVE_FRAME_REFRESH_MS);
    expect(mockLiveFrame.mock.calls[1][0]).toMatchObject({ shownPts: 7, shownUri: "file:///pool/m1/live-1000000-0.jpg" });
  });

  describe("preempting a refresh for the focused card", () => {
    const answers = new Map<string, (result: unknown) => void>();
    const withClip = (id: string) => ({ ...onDisk(id, 1_000_000 - LIVE_FRAME_REFRESH_MS - 1, 2), clip: `file:///pool/${id}/c.mp4` });
    const settle = async () => {
      setLiveFrameFocus(null);
      for (const answer of answers.values()) answer({ uris: [], cancelled: true });
      answers.clear();
      await flush();
    };
    beforeEach(() => {
      mockLiveFrame.mockImplementation(({ channelId }: { channelId: string }) => new Promise((resolve) => answers.set(channelId, resolve)));
    });

    it("leaves every grab alone while a slot is free", async () => {
      mockOnDisk.mockResolvedValue({ m1: withClip("m1") });
      setLiveFramesActive("guide", true);
      setLiveFrameViewable("guide", ["m1", "m2"]);
      await advance(0);
      expect(grabs()).toEqual(["m2"]);
      setLiveFrameFocus("m2");
      expect(mockCancel).not.toHaveBeenCalled();
      await settle();
    });

    it("leaves two first grabs alone", async () => {
      setLiveFramesActive("guide", true);
      setLiveFrameViewable("guide", ["m1", "m2", "m3"]);
      await advance(0);
      await advance(LIVE_FRAME_SPACING_MS);
      expect(grabs()).toEqual(["m1", "m2"]);
      setLiveFrameFocus("m3");
      expect(mockCancel).not.toHaveBeenCalled();
      await settle();
    });

    it("leaves refreshes alone for a focused card that has its picture and clip", async () => {
      mockOnDisk.mockResolvedValue({ m1: withClip("m1"), m2: withClip("m2"), m3: { ...onDisk("m3", 1_000_000 - 1_000, 2), clip: "file:///pool/m3/c.mp4" } });
      setLiveFramesActive("guide", true);
      setLiveFrameViewable("guide", ["m1", "m2", "m3"]);
      await advance(0);
      await advance(LIVE_FRAME_SPACING_MS);
      expect(grabs()).toEqual(["m1", "m2"]);
      setLiveFrameFocus("m3");
      expect(mockCancel).not.toHaveBeenCalled();
      await settle();
    });

    it("leaves refreshes alone for a focused card out of view", async () => {
      mockOnDisk.mockResolvedValue({ m1: withClip("m1"), m2: withClip("m2") });
      setLiveFramesActive("guide", true);
      setLiveFrameViewable("guide", ["m1", "m2"]);
      await advance(0);
      await advance(LIVE_FRAME_SPACING_MS);
      expect(grabs()).toEqual(["m1", "m2"]);
      setLiveFrameFocus("m9");
      expect(mockCancel).not.toHaveBeenCalled();
      await settle();
    });

    it("stops one refresh, then grabs the focused card in the slot it frees", async () => {
      mockOnDisk.mockResolvedValue({ m1: withClip("m1"), m2: withClip("m2") });
      setLiveFramesActive("guide", true);
      setLiveFrameViewable("guide", ["m1", "m2"]);
      await advance(0);
      await advance(LIVE_FRAME_SPACING_MS);
      expect(grabs()).toEqual(["m1", "m2"]);
      setLiveFrameViewable("guide", ["m1", "m2", "m3"]);
      setLiveFrameFocus("m3");
      expect(mockCancel.mock.calls).toEqual([["m1"]]);
      answers.get("m1")?.({ uris: [], cancelled: true });
      await flush();
      await advance(LIVE_FRAME_SPACING_MS);
      expect(grabs()).toEqual(["m1", "m2", "m3"]);
      await settle();
    });
  });

  it("carries the clip a burst had on disk, and lets it go with the burst", async () => {
    mockOnDisk.mockResolvedValue({ m1: { ...onDisk("m1", 1_000_000 - 2_000, 2), clip: "file:///pool/m1/live-998000-clip.mp4" } });
    mockLiveFrame.mockRejectedValue(new Error("dead origin"));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(liveClipFor("m1")?.uri).toBe("file:///pool/m1/live-998000-clip.mp4");
    await advance(LIVE_FRAME_EXPIRY_MS);
    expect(liveClipFor("m1")).toBeUndefined();
  });

  it("keeps a card's picture while a grab streams, and shows the grab once it lands whole", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    const resting = liveFrameFor("m1");
    let answer: (() => void) | undefined;
    mockLiveFrame.mockImplementation(({ channelId }: { channelId: string }) => new Promise((resolve) => (answer = () => resolve({ uris: burst(channelId, Date.now(), 2), pts: 9, cancelled: false }))));
    await advance(LIVE_FRAME_REFRESH_MS);
    emitLiveFrame({ channelId: "m1", uri: `file:///pool/m1/live-${Date.now()}-0.jpg`, index: 0 });
    expect(liveFrameFor("m1")).toBe(resting);
    answer?.();
    await flush();
    expect(liveFrameFor("m1")?.uri).toBe(`file:///pool/m1/live-${1_000_000 + LIVE_FRAME_REFRESH_MS}-1.jpg`);
  });

  it("shows each frame the grab streams before its burst resolves", async () => {
    let answer: (() => void) | undefined;
    mockLiveFrame.mockImplementation(({ channelId }: { channelId: string }) => new Promise((resolve) => (answer = () => resolve({ uris: burst(channelId, 1_000_000, 2), pts: 5, cancelled: false }))));
    const listener = jest.fn();
    subscribeLiveFrame("m1", listener);
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(grabs()).toEqual(["m1"]);
    expect(listener).not.toHaveBeenCalled();

    emitLiveFrame({ channelId: "m1", uri: "file:///pool/m1/live-1000000-0.jpg", index: 0 });
    expect(liveFrameFor("m1")).toEqual({ uri: "file:///pool/m1/live-1000000-0.jpg", cacheKey: "live-m1-1000000-0" });
    expect(listener).toHaveBeenCalledTimes(1);
    emitLiveFrame({ channelId: "m1", uri: "file:///pool/m1/live-1000000-1.jpg", index: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(liveFrameFor("m1")?.uri).toBe("file:///pool/m1/live-1000000-1.jpg");
    // A frame for a channel no grab is reading is dropped.
    emitLiveFrame({ channelId: "m9", uri: "file:///pool/m9/live-1000000-0.jpg", index: 0 });
    expect(liveFrameFor("m9")).toBeUndefined();

    answer?.();
    await flush();
    expect(liveFrameFor("m1")).toEqual({ uri: "file:///pool/m1/live-1000000-1.jpg", cacheKey: "live-m1-1000000-1" });
  });

  it("replaces the burst on every streamed frame, so a snapshot reader repaints", async () => {
    let answer: (() => void) | undefined;
    mockLiveFrame.mockImplementation(() => new Promise((resolve) => (answer = () => resolve({ uris: [], cancelled: true }))));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    emitLiveFrame({ channelId: "m1", uri: "file:///pool/m1/live-1000000-0.jpg", index: 0 });
    const first = liveFrameReel("m1");
    emitLiveFrame({ channelId: "m1", uri: "file:///pool/m1/live-1000000-1.jpg", index: 1 });
    const second = liveFrameReel("m1");
    expect(second).not.toBe(first);
    expect(second?.frames.map((frame) => frame.cacheKey)).toEqual(["live-m1-1000000-0", "live-m1-1000000-1"]);
    answer?.();
    await flush();
  });

  it("promotes a row focused past the dwell to the front, on its short floor, never past backoff", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "m2"]);
    await advance(0);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m2"]);

    // Fresh bursts everywhere: nothing is due, but a dwell on m2 asks for it after its short floor.
    await advance(LIVE_FRAME_FOCUS_REFRESH_MS);
    setLiveFrameFocus("m2");
    await advance(LIVE_FRAME_FOCUS_DWELL_MS);
    await advance(1);
    expect(grabs()).toEqual(["m1", "m2", "m2"]);

    // Leaving the row retires the promotion: the short floor asks for nothing more.
    clearLiveFrameFocus("m2");
    await advance(LIVE_FRAME_FOCUS_REFRESH_MS);
    expect(grabs()).toEqual(["m1", "m2", "m2"]);

    // A glance shorter than the dwell promotes nothing.
    setLiveFrameFocus("m1");
    await advance(LIVE_FRAME_FOCUS_DWELL_MS / 2);
    clearLiveFrameFocus("m1");
    await advance(LIVE_FRAME_FOCUS_DWELL_MS);
    expect(grabs()).toEqual(["m1", "m2", "m2"]);
  });

  it("asks a channel again at the refresh floor, doubles the wait while its live edge stands still, and drops back once it moves", async () => {
    let pts = 1;
    let still = false;
    mockLiveFrame.mockImplementation(async ({ channelId }: { channelId: string }) =>
      still ? { uris: [], unchanged: true, cancelled: false } : { uris: burst(channelId, Date.now(), 1), pts, cancelled: false },
    );
    const listener = jest.fn();
    subscribeLiveFrame("m1", listener);
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(grabs()).toEqual(["m1"]);
    expect(listener).toHaveBeenCalledTimes(1);

    still = true;
    await advance(LIVE_FRAME_REFRESH_MS);
    expect(grabs()).toHaveLength(2);
    expect(mockLiveFrame.mock.calls[1][0]).toMatchObject({ shownPts: 1 });
    // The verify re-dates the burst and moves its due: subscribers hear it, on the same burst object.
    expect(listener).toHaveBeenCalledTimes(2);
    const shown = liveFrameFor("m1");
    // Each unchanged answer doubles the wait: 4 min, then the 5 min cap.
    for (const waitMs of [240_000, LIVE_FRAME_REFRESH_CAP_MS, LIVE_FRAME_REFRESH_CAP_MS, LIVE_FRAME_REFRESH_CAP_MS]) {
      const before = grabs().length;
      await advance(waitMs - 1);
      expect(grabs()).toHaveLength(before);
      await advance(1);
      expect(grabs()).toHaveLength(before + 1);
    }
    expect(liveFrameFor("m1")).toBe(shown);

    still = false;
    pts = 2;
    await advance(LIVE_FRAME_REFRESH_CAP_MS);
    expect(listener).toHaveBeenCalledTimes(7);
    const moved = grabs().length;
    await advance(LIVE_FRAME_REFRESH_MS);
    expect(grabs()).toHaveLength(moved + 1);
    expect(mockLiveFrame.mock.calls[moved][0]).toMatchObject({ shownPts: 2 });
  });

  describe("liveFrameDueAt", () => {
    it("counts the shown burst's refresh from its grab; nothing before any picture", async () => {
      expect(liveFrameDueAt("m1")).toBeUndefined();
      setLiveFramesActive("guide", true);
      setLiveFrameViewable("guide", ["m1"]);
      await advance(0);
      expect(liveFrameDueAt("m1")).toBe(1_000_000 + LIVE_FRAME_REFRESH_MS);
    });

    it("stretches with the doubled wait while the live edge stands still", async () => {
      let still = false;
      mockLiveFrame.mockImplementation(async ({ channelId }: { channelId: string }) =>
        still ? { uris: [], unchanged: true, cancelled: false } : { uris: burst(channelId, Date.now()), pts: 1, cancelled: false },
      );
      setLiveFramesActive("guide", true);
      setLiveFrameViewable("guide", ["m1"]);
      await advance(0);
      still = true;
      await advance(LIVE_FRAME_REFRESH_MS);
      expect(liveFrameDueAt("m1")).toBe(1_000_000 + LIVE_FRAME_REFRESH_MS + 240_000);
    });

    it("shortens to the focus floor on promotion and stretches back on leave, telling subscribers both times", async () => {
      setLiveFramesActive("guide", true);
      setLiveFrameViewable("guide", ["m1", "m2"]);
      await advance(0);
      await advance(LIVE_FRAME_SPACING_MS);
      expect(grabs()).toEqual(["m1", "m2"]);
      const grabbedAt = 1_000_000 + LIVE_FRAME_SPACING_MS;
      const listener = jest.fn();
      subscribeLiveFrame("m2", listener);
      setLiveFrameFocus("m2");
      await advance(LIVE_FRAME_FOCUS_DWELL_MS);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(liveFrameDueAt("m2")).toBe(grabbedAt + LIVE_FRAME_FOCUS_REFRESH_MS);
      setLiveFrameFocus(null);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(liveFrameDueAt("m2")).toBe(grabbedAt + LIVE_FRAME_REFRESH_MS);
    });
  });

  it("opens a tuner channel on the server for its burst and closes it as soon as the burst is read", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["t1"]);
    await advance(0);
    expect(mockOpenChannel).toHaveBeenCalledWith("t1", undefined, { quiet: true });
    expect(mockLiveFrame.mock.calls[0][0]).toMatchObject({ channelId: "t1", inputUrl: "https://jf/LiveTv/LiveStreamFiles/t1/stream.ts", httpHeaders: {} });
    expect(mockCloseLiveStream).toHaveBeenCalledWith("ls-t1");
    expect(mockCloseLiveStream.mock.invocationCallOrder[0]).toBeGreaterThan(mockLiveFrame.mock.invocationCallOrder[0]);
    await advance(LIVE_FRAME_REFRESH_MS + LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["t1", "t1"]);
    expect(mockOpenChannel).toHaveBeenCalledTimes(2);
    expect(mockCloseLiveStream).toHaveBeenCalledTimes(2);
  });

  it("closes a server open the burst could not read, and one whose grab threw", async () => {
    mockOpenChannel.mockResolvedValueOnce({ Id: "t1", LiveStreamId: "ls-t1" });
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["t1"]);
    await advance(0);
    expect(grabs()).toEqual([]);
    expect(mockCloseLiveStream).toHaveBeenCalledWith("ls-t1");

    mockLiveFrame.mockRejectedValueOnce(new Error("engine gone"));
    setLiveFrameViewable("guide", ["t2"]);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["t2"]);
    expect(mockCloseLiveStream).toHaveBeenCalledWith("ls-t2");
  });

  it("holds nothing open across channels: the next tuner channel opens only after the last closed", async () => {
    const many = ["t0", "t1", "t2"];
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", many);
    for (let i = 0; i < many.length; i += 1) {
      await advance(i === 0 ? 0 : LIVE_FRAME_SPACING_MS);
      expect(mockOpenChannel).toHaveBeenCalledTimes(i + 1);
      expect(mockCloseLiveStream).toHaveBeenCalledTimes(i + 1);
    }
  });

  it("backs off a channel that gives no frame", async () => {
    mockLiveFrame.mockResolvedValue({ uris: [], cancelled: false, reason: "open" });
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(grabs()).toEqual(["m1"]);
    await advance(LIVE_FRAME_RETRY_MS - 1);
    expect(grabs()).toEqual(["m1"]);
    await advance(1);
    expect(grabs()).toEqual(["m1", "m1"]);
    // The second failure doubles the wait past the refresh floor.
    await advance(LIVE_FRAME_REFRESH_MS);
    expect(grabs()).toEqual(["m1", "m1"]);
    await advance(LIVE_FRAME_RETRY_MS * 2 - LIVE_FRAME_REFRESH_MS);
    expect(grabs()).toEqual(["m1", "m1", "m1"]);
    expect(liveFrameFor("m1")).toBeUndefined();
  });

  it("stands down while playback holds the link, the app is in the background or the guide is off screen", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["t1", "m1"]);
    await advance(0);
    expect(grabs()).toEqual(["t1"]);

    setPlaybackHold("video", true);
    await advance(LIVE_FRAME_SPACING_MS * 3);
    expect(grabs()).toEqual(["t1"]);
    setPlaybackHold("video", false);
    await advance(0);
    expect(grabs()).toEqual(["t1", "m1"]);

    appStateListener?.("background");
    await advance(LIVE_FRAME_REFRESH_MS * 2);
    expect(grabs()).toHaveLength(2);
    appStateListener?.("active");
    await advance(0);
    expect(grabs()).toHaveLength(3);

    setLiveFramesActive("guide", false);
    await advance(LIVE_FRAME_REFRESH_MS * 2);
    expect(grabs()).toHaveLength(3);
  });

  it("grabs once the app turned active before any surface wired its listener", async () => {
    (AppState as { currentState: string }).currentState = "inactive";
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(grabs()).toEqual([]);
    (AppState as { currentState: string }).currentState = "active";
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(grabs()).toEqual(["m1"]);
  });

  it("stops the grab reading when the guide leaves, so its server open closes at once", async () => {
    let answer: (() => void) | undefined;
    mockLiveFrame.mockImplementation(() => new Promise((resolve) => (answer = () => resolve({ uris: [], cancelled: true }))));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["t1"]);
    await advance(0);
    expect(grabs()).toEqual(["t1"]);
    expect(mockCloseLiveStream).not.toHaveBeenCalled();

    setLiveFramesActive("guide", false);
    expect(mockCancel.mock.calls).toEqual([["t1"]]);
    answer?.();
    await flush();
    expect(mockCloseLiveStream).toHaveBeenCalledWith("ls-t1");
  });

  it("samples the surface that took over, whichever order the two report in, and plays the guide's set back on return", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(grabs()).toEqual(["m1"]);

    // The wall pushes: it reports active before the guide reports away.
    setLiveFramesActive("wall", true);
    setLiveFrameViewable("wall", ["m2"]);
    setLiveFramesActive("guide", false);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m2"]);
    // The guide's set changes under the wall and waits for its return.
    setLiveFrameViewable("guide", ["m3"]);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m2"]);

    // The wall pops: the guide reports active before the wall reports away.
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("wall", []);
    setLiveFramesActive("wall", false);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m2", "m3"]);
  });

  it("shows the newest burst on disk before any grab and counts the refresh from its time", async () => {
    mockOnDisk.mockResolvedValue({ m1: { ...onDisk("m1", 1_000_000 - 2_000, 2), clip: "file:///pool/m1/live-998000-clip.mp4" } });
    const listener = jest.fn();
    subscribeLiveFrame("m1", listener);
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "m2"]);
    await advance(0);
    expect(liveFrameFor("m1")).toEqual({ uri: "file:///pool/m1/live-998000-1.jpg", cacheKey: "live-m1-998000-1" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(grabs()).toEqual(["m2"]);
    await advance(LIVE_FRAME_REFRESH_MS - 2_000 - 1);
    expect(grabs()).toEqual(["m2"]);
    await advance(1);
    expect(grabs()).toEqual(["m2", "m1"]);
    expect(mockLiveFrame.mock.calls[1][0].shownPts).toBeUndefined();
    expect(mockOnDisk).toHaveBeenCalledTimes(1);
  });

  it("stops the grab reading the moment playback takes the link, and asks again only once it lets go", async () => {
    let answer: (() => void) | undefined;
    mockLiveFrame.mockImplementation(() => new Promise((resolve) => (answer = () => resolve({ uris: [], cancelled: true }))));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "m2"]);
    await advance(0);
    expect(grabs()).toEqual(["m1"]);

    setPlaybackHold("video", true);
    expect(mockCancel.mock.calls).toEqual([["m1"]]);
    answer?.();
    await flush();
    await advance(LIVE_FRAME_REFRESH_CAP_MS);
    expect(grabs()).toEqual(["m1"]);
    setPlaybackHold("video", false);
    // The cancelled grab delivered nothing, so its channel is asked again first.
    mockLiveFrame.mockImplementation(async ({ channelId }: { channelId: string }) => ({ uris: burst(channelId, Date.now()), pts: 1, cancelled: false }));
    await advance(0);
    expect(grabs()).toEqual(["m1", "m1"]);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m1", "m2"]);
  });

  it("starts no read for a grab whose server open lands after playback took the link, and closes that open", async () => {
    let opened: (() => void) | undefined;
    mockOpenChannel.mockImplementation((id: string) => new Promise((resolve) => (opened = () => resolve({ Id: id, LiveStreamId: `ls-${id}`, liveStreamUrl: `https://jf/${id}.ts` }))));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["t1"]);
    await advance(0);
    expect(mockOpenChannel).toHaveBeenCalledWith("t1", undefined, { quiet: true });

    setPlaybackHold("video", true);
    expect(mockCancel.mock.calls).toEqual([["t1"]]);
    opened?.();
    await flush();
    expect(grabs()).toEqual([]);
    expect(mockCloseLiveStream).toHaveBeenCalledWith("ls-t1");
    setPlaybackHold("video", false);
  });

  it("starts no read for a grab whose server open lands after the guide left, and closes that open", async () => {
    let opened: (() => void) | undefined;
    mockOpenChannel.mockImplementation((id: string) => new Promise((resolve) => (opened = () => resolve({ Id: id, LiveStreamId: `ls-${id}`, liveStreamUrl: `https://jf/${id}.ts` }))));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["t1"]);
    await advance(0);
    expect(mockOpenChannel).toHaveBeenCalledWith("t1", undefined, { quiet: true });

    setLiveFramesActive("guide", false);
    expect(mockCancel.mock.calls).toEqual([["t1"]]);
    opened?.();
    await flush();
    expect(grabs()).toEqual([]);
    expect(mockCloseLiveStream).toHaveBeenCalledWith("ls-t1");
  });

  it("starts no read for a grab whose card scrolled away while its server open ran, and asks it again when it returns", async () => {
    let opened: (() => void) | undefined;
    mockOpenChannel.mockImplementation((id: string) => new Promise((resolve) => (opened = () => resolve({ Id: id, LiveStreamId: `ls-${id}`, liveStreamUrl: `https://jf/${id}.ts` }))));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["t1"]);
    await advance(0);

    setLiveFrameViewable("guide", ["m2"]);
    expect(mockCancel.mock.calls).toEqual([["t1"]]);
    opened?.();
    await flush();
    expect(grabs()).toEqual([]);
    expect(mockCloseLiveStream).toHaveBeenCalledWith("ls-t1");

    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m2"]);
    mockOpenChannel.mockImplementation(async (id: string) => ({ Id: id, LiveStreamId: `ls-${id}`, liveStreamUrl: `https://jf/${id}.ts` }));
    setLiveFrameViewable("guide", ["t1"]);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m2", "t1"]);
  });

  it("stops every grab on a group pick, the one still opening included", async () => {
    let opened: (() => void) | undefined;
    mockOpenChannel.mockImplementation((id: string) => new Promise((resolve) => (opened = () => resolve({ Id: id, LiveStreamId: `ls-${id}`, liveStreamUrl: `https://jf/${id}.ts` }))));
    let answer: ((result: unknown) => void) | undefined;
    mockLiveFrame.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "t2"]);
    await advance(0);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1"]);
    expect(mockOpenChannel).toHaveBeenCalledWith("t2", undefined, { quiet: true });

    pickGroup("favorites");
    expect(mockCancel.mock.calls).toEqual([["m1"], ["t2"]]);
    opened?.();
    await flush();
    expect(grabs()).toEqual(["m1"]);
    expect(mockCloseLiveStream).toHaveBeenCalledWith("ls-t2");
    pickGroup("favorites");
    expect(mockCancel).toHaveBeenCalledTimes(2);
    answer?.({ uris: [], cancelled: true });
    await flush();
    pickGroup("all");
  });

  it("promotes the card focused past its dwell to a live preview while it samples, and drops it when focus moves", async () => {
    mockShowLivePreview.mockClear();
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "m2"]);
    await advance(0);
    setLiveFrameFocus("m1");
    expect(mockShowLivePreview).toHaveBeenLastCalledWith(null);
    await advance(LIVE_FRAME_FOCUS_DWELL_MS);
    expect(mockShowLivePreview).toHaveBeenLastCalledWith("m1");
    setLiveFrameFocus("m2");
    expect(mockShowLivePreview).toHaveBeenLastCalledWith(null);
  });

  it("upgrades a cold grab to the full burst on the refresh, one open per cycle", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(mockLiveFrame.mock.calls[0][0]).toMatchObject({ count: LIVE_FRAME_COLD_COUNT });
    await advance(LIVE_FRAME_REFRESH_MS);
    expect(mockLiveFrame.mock.calls[1][0]).toMatchObject({ count: LIVE_FRAME_BURST_COUNT });
  });

  it("cancels the grab whose card scrolled away and asks it again as soon as it returns", async () => {
    let answer: ((result: unknown) => void) | undefined;
    mockLiveFrame.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "m2"]);
    await advance(0);
    expect(grabs()).toEqual(["m1"]);

    setLiveFrameViewable("guide", ["m2", "m3"]);
    expect(mockCancel.mock.calls).toEqual([["m1"]]);
    answer?.({ uris: [], cancelled: true });
    await flush();
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m2"]);

    answer?.({ uris: burst("m2", Date.now()), pts: 1, cancelled: false });
    await flush();
    // Nothing landed for m1, so scrolling back does not sit out a refresh interval.
    mockLiveFrame.mockImplementation(async ({ channelId }: { channelId: string }) => ({ uris: burst(channelId, Date.now()), pts: 1, cancelled: false }));
    setLiveFrameViewable("guide", ["m1", "m2"]);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m2", "m1"]);
  });

  it("rests the sampler once opens are refused in a row, then tries again after the cooldown", async () => {
    mockLiveFrame.mockImplementation(async () => ({ uris: [], cancelled: false, reason: "open" }));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "m2", "m3", "m4"]);
    await advance(0);
    await advance(LIVE_FRAME_SPACING_MS);
    await advance(LIVE_FRAME_SPACING_MS);
    // Three refusals trip the cap; the fourth card is not walked into it.
    expect(grabs()).toEqual(["m1", "m2", "m3"]);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m2", "m3"]);

    mockLiveFrame.mockImplementation(async ({ channelId }: { channelId: string }) => ({ uris: burst(channelId, Date.now()), pts: 1, cancelled: false }));
    await advance(LIVE_FRAME_CAP_COOLDOWN_MS);
    expect(grabs().length).toBeGreaterThan(3);
    expect(liveFrameFor("m4")).toBeDefined();
  });

  it("judges channels no tuner carries down at once, without resting the sampler for the rest", async () => {
    mockResolveOrigin.mockImplementation(async (id: string) => (id.startsWith("g") ? "untuned" : null));
    mockOpenChannel.mockImplementation(async (id: string) => {
      if (id.startsWith("g")) throw new Error("Failed to open channel: 500");
      return { Id: id, LiveStreamId: `ls-${id}`, liveStreamUrl: `https://jf/LiveTv/LiveStreamFiles/${id}/stream.ts` };
    });
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["g1", "g2", "g3", "t1"]);
    await advance(0);
    await advance(LIVE_FRAME_SPACING_MS);
    await advance(LIVE_FRAME_SPACING_MS);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(["g1", "g2", "g3"].map(healthFor)).toEqual(["down", "down", "down"]);
    expect(grabs()).toEqual(["t1"]);
  });

  it("asks the server every grab, so a channel re-keyed under a live picture drops it and goes down", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(liveFrameFor("m1")).toBeDefined();
    mockResolveOrigin.mockImplementation(async () => "untuned");
    mockOpenChannel.mockRejectedValue(new Error("Failed to open channel: 500"));
    await advance(LIVE_FRAME_REFRESH_MS + LIVE_FRAME_SPACING_MS);
    expect(mockResolveOrigin).toHaveBeenCalledTimes(2);
    expect(liveFrameFor("m1")).toBeUndefined();
    expect(healthFor("m1")).toBe("down");
  });

  it("keeps a channel listed with no tuner whose open still plays", async () => {
    mockResolveOrigin.mockImplementation(async () => "untuned");
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["t1"]);
    await advance(0);
    expect(grabs()).toEqual(["t1"]);
    expect(healthFor("t1")).toBe("up");
  });

  it("leaves a stale burst on disk off screen and asks that channel at once", async () => {
    mockOnDisk.mockResolvedValue({ m1: onDisk("m1", 1_000_000 - LIVE_FRAME_EXPIRY_MS - 60_000, 2) });
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    // The day-old pictures never show; the first grab replaces nothing but a placeholder.
    expect(grabs()).toEqual(["m1"]);
    expect(liveFrameFor("m1")?.uri).toBe(`file:///pool/m1/live-1000000-${LAST_FRAME}.jpg`);
  });

  it("expires a burst whose channel keeps failing, so the card lets its old picture go", async () => {
    mockOnDisk.mockResolvedValue({ m1: onDisk("m1", 1_000_000 - 2_000, 2) });
    mockLiveFrame.mockRejectedValue(new Error("dead origin"));
    const listener = jest.fn();
    subscribeLiveFrame("m1", listener);
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(liveFrameFor("m1")).toBeDefined();
    await advance(LIVE_FRAME_EXPIRY_MS);
    expect(liveFrameFor("m1")).toBeUndefined();
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("expires a single-frame burst too, though it has nothing to walk", async () => {
    mockOnDisk.mockResolvedValue({ m1: onDisk("m1", 1_000_000 - 2_000, 1) });
    mockLiveFrame.mockRejectedValue(new Error("dead origin"));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(liveFrameFor("m1")).toBeDefined();
    const listener = jest.fn();
    subscribeLiveFrame("m1", listener);
    await advance(LIVE_FRAME_EXPIRY_MS);
    expect(liveFrameFor("m1")).toBeUndefined();
    expect(listener).toHaveBeenCalled();
  });

  it("keeps a burst alive past the expiry while the engine answers unchanged", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(liveFrameFor("m1")).toBeDefined();
    mockLiveFrame.mockImplementation(async () => ({ unchanged: true, missing: false }));
    // Stepped so each unchanged grab lands before the next stretch of ticks ages the burst.
    for (let stepped = 0; stepped < LIVE_FRAME_EXPIRY_MS + LIVE_FRAME_REFRESH_MS; stepped += LIVE_FRAME_REFRESH_CAP_MS) {
      await advance(LIVE_FRAME_REFRESH_CAP_MS);
    }
    expect(liveFrameFor("m1")).toBeDefined();
    expect(liveFrameReel("m1")?.frames).toHaveLength(LIVE_FRAME_BURST_COUNT);
  });

  it("shows the reel while its frames are valid and lets them go the moment they expire", async () => {
    mockOnDisk.mockResolvedValue({ m1: onDisk("m1", 1_000_000 - 2_000, 3) });
    mockLiveFrame.mockRejectedValue(new Error("dead origin"));
    const listener = jest.fn();
    subscribeLiveFrame("m1", listener);
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(liveFrameReel("m1")?.frames).toHaveLength(3);
    await advance(LIVE_FRAME_EXPIRY_MS - 2_000 - 1_000);
    expect(liveFrameReel("m1")?.frames).toHaveLength(3);
    const told = listener.mock.calls.length;
    await advance(2_000);
    expect(liveFrameReel("m1")).toBeUndefined();
    expect(liveFrameFor("m1")).toBeUndefined();
    expect(listener.mock.calls.length).toBeGreaterThan(told);
  });

  it("lets an off-screen channel's frames go at their expiry too, and asks for a full burst when it returns", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "m2"]);
    await advance(0);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(liveFrameReel("m1")).toBeDefined();
    setLiveFrameViewable("guide", ["m2"]);
    await advance(LIVE_FRAME_EXPIRY_MS + 1_000);
    expect(liveFrameReel("m1")).toBeUndefined();
    const before = grabs().length;
    setLiveFrameViewable("guide", ["m1", "m2"]);
    await advance(0);
    expect(grabs().slice(before)).toContain("m1");
    const call = mockLiveFrame.mock.calls.find(([config], index) => index >= before && (config as { channelId: string }).channelId === "m1");
    expect(call?.[0]).toMatchObject({ shownPts: undefined, count: LIVE_FRAME_COLD_COUNT });
  });

  it("drops a burst whose files the engine no longer holds and asks the channel again", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(liveFrameReel("m1")).toBeDefined();
    const listener = jest.fn();
    subscribeLiveFrame("m1", listener);
    mockLiveFrame.mockResolvedValueOnce({ unchanged: true, missing: true });
    await advance(LIVE_FRAME_REFRESH_MS);
    expect(liveFrameReel("m1")).toBeUndefined();
    expect(liveFrameFor("m1")).toBeUndefined();
    expect(listener).toHaveBeenCalled();
    const before = grabs().length;
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs().length).toBeGreaterThan(before);
    expect(liveFrameReel("m1")).toBeDefined();
  });

  it("tells a channel's subscribers about its frame and drops every frame on a clear", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeLiveFrame("m1", listener);
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(listener).toHaveBeenCalledTimes(1);
    clearLiveFrames();
    expect(liveFrameFor("m1")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
