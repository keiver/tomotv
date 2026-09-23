/**
 * The live frame sampler: one grab at a time, a refresh that backs off while a live edge stands still, the oldest first, a manifest
 * channel read at its origin and a tuner channel off a warm open, the hold cap, holds closing after
 * their rows leave, backoff on failure, and standing down for the screen, the app and playback.
 */
const mockLiveFrame = jest.fn();
const mockOnDisk = jest.fn();
const mockCancel = jest.fn();
const mockResolveOrigin = jest.fn();
const mockWarm = jest.fn();
const mockWarmedUrl = jest.fn();
const mockWarmedCount = jest.fn(() => 0);
const mockCloseWarmed = jest.fn();
const mockOpenRecentlyFailed = jest.fn((_id: string) => false);
let appStateListener: ((state: string) => void) | null = null;

jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: true, select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    },
  },
  NativeModules: {
    LocalRemuxer: {
      liveFrame: (config: unknown) => mockLiveFrame(config),
      liveFramesOnDisk: (ids: string[]) => mockOnDisk(ids),
      cancelLiveFrame: (id: string) => mockCancel(id),
    },
  },
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/localRemux", () => ({ isLocalRemuxAvailable: () => true }));
jest.mock("@/services/jellyfinApi", () => ({
  resolveChannelOrigin: (id: string) => mockResolveOrigin(id),
  warmChannel: (id: string) => mockWarm(id),
  warmedStreamUrl: (id: string) => mockWarmedUrl(id),
  warmedChannelCount: () => mockWarmedCount(),
  closeWarmedChannels: (keep?: Iterable<string>) => mockCloseWarmed(keep ? [...keep] : []),
  openRecentlyFailed: (id: string) => mockOpenRecentlyFailed(id),
}));

import {
  clearLiveFrames,
  LIVE_FRAME_HOLD_CAP,
  LIVE_FRAME_HOLD_GRACE_MS,
  LIVE_FRAME_REFRESH_CAP_MS,
  LIVE_FRAME_REFRESH_MS,
  LIVE_FRAME_RETRY_MS,
  LIVE_FRAME_SPACING_MS,
  liveFrameFor,
  setLiveFramesActive,
  setLiveFrameViewable,
  subscribeLiveFrame,
} from "@/services/liveFrames";
import { setPlaybackHold } from "@/services/playbackHold";

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
const advance = async (ms: number) => {
  jest.advanceTimersByTime(ms);
  await flush();
};
const grabs = () => mockLiveFrame.mock.calls.map(([config]) => (config as { channelId: string }).channelId);
const held = new Map<string, string>();

describe("live frames", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    mockLiveFrame.mockReset().mockImplementation(async ({ channelId }: { channelId: string }) => ({ uri: `file:///pool/${channelId}/live-${Date.now()}.jpg`, pts: Date.now(), cancelled: false }));
    mockOnDisk.mockReset().mockResolvedValue({});
    mockCancel.mockReset().mockResolvedValue(undefined);
    mockResolveOrigin.mockReset().mockImplementation(async (id: string) => (id.startsWith("m") ? { url: `https://origin/${id}.m3u8`, headers: { "User-Agent": "Tuner" } } : null));
    held.clear();
    mockWarm.mockReset().mockImplementation(async (id: string) => {
      held.set(id, `https://jf/LiveTv/LiveStreamFiles/${id}/stream.ts`);
    });
    mockWarmedUrl.mockReset().mockImplementation((id: string) => held.get(id));
    mockWarmedCount.mockReset().mockImplementation(() => held.size);
    mockCloseWarmed.mockReset().mockImplementation(async (keep: string[]) => {
      for (const id of [...held.keys()]) if (!keep.includes(id)) held.delete(id);
    });
    mockOpenRecentlyFailed.mockReset().mockReturnValue(false);
    setPlaybackHold("video", false);
    clearLiveFrames();
    setLiveFrameViewable("guide", []);
    setLiveFramesActive("guide", false);
  });

  afterEach(() => {
    setLiveFramesActive("guide", false);
    setLiveFramesActive("wall", false);
    jest.useRealTimers();
  });

  it("grabs the viewable channels one at a time, a manifest one at its origin with its headers", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "m2"]);
    await advance(0);
    expect(grabs()).toEqual(["m1"]);
    expect(mockLiveFrame.mock.calls[0][0]).toMatchObject({ channelId: "m1", inputUrl: "https://origin/m1.m3u8", httpHeaders: { "User-Agent": "Tuner" } });
    expect(liveFrameFor("m1")).toEqual({ uri: "file:///pool/m1/live-1000000.jpg", cacheKey: "live-m1-1000000" });
    expect(mockOnDisk).toHaveBeenCalledWith(["m1", "m2"]);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m2"]);
    expect(mockWarm).not.toHaveBeenCalled();
  });

  it("asks a channel again at the refresh floor, doubles the wait while its live edge stands still, and drops back once it moves", async () => {
    let pts = 1;
    let still = false;
    mockLiveFrame.mockImplementation(async ({ channelId }: { channelId: string }) =>
      still ? { uri: null, unchanged: true, cancelled: false } : { uri: `file:///pool/${channelId}/live-${Date.now()}.jpg`, pts, cancelled: false },
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
    expect(listener).toHaveBeenCalledTimes(1);
    const shown = liveFrameFor("m1");
    // Each unchanged answer doubles the wait: 10 s, 20 s, 40 s, then the 60 s cap.
    for (const waitMs of [10_000, 20_000, 40_000, LIVE_FRAME_REFRESH_CAP_MS, LIVE_FRAME_REFRESH_CAP_MS]) {
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
    expect(listener).toHaveBeenCalledTimes(2);
    const moved = grabs().length;
    await advance(LIVE_FRAME_REFRESH_MS);
    expect(grabs()).toHaveLength(moved + 1);
    expect(mockLiveFrame.mock.calls[moved][0]).toMatchObject({ shownPts: 2 });
  });

  it("samples a tuner channel off a warm open and reads the held stream", async () => {
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["t1"]);
    await advance(0);
    expect(mockWarm).toHaveBeenCalledWith("t1");
    expect(mockLiveFrame.mock.calls[0][0]).toMatchObject({ channelId: "t1", inputUrl: "https://jf/LiveTv/LiveStreamFiles/t1/stream.ts", httpHeaders: {} });
    await advance(LIVE_FRAME_REFRESH_MS + LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["t1", "t1"]);
    expect(mockWarm).toHaveBeenCalledTimes(1);
  });

  it("holds no more tuner opens than the cap and closes a hold once its row has been out of view past the grace", async () => {
    const many = Array.from({ length: LIVE_FRAME_HOLD_CAP + 2 }, (_, i) => `t${i}`);
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", many);
    for (let i = 0; i < many.length; i += 1) await advance(LIVE_FRAME_SPACING_MS);
    expect(held.size).toBe(LIVE_FRAME_HOLD_CAP);
    expect(grabs()).toHaveLength(LIVE_FRAME_HOLD_CAP);

    setLiveFrameViewable("guide", many.slice(1));
    await advance(LIVE_FRAME_SPACING_MS);
    expect(held.has("t0")).toBe(true);
    await advance(LIVE_FRAME_HOLD_GRACE_MS);
    expect(held.has("t0")).toBe(false);
  });

  it("backs off a channel that gives no frame", async () => {
    mockLiveFrame.mockResolvedValue({ uri: null, cancelled: false, reason: "open" });
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(grabs()).toEqual(["m1"]);
    await advance(LIVE_FRAME_REFRESH_MS + LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1"]);
    await advance(LIVE_FRAME_RETRY_MS);
    expect(grabs()).toEqual(["m1", "m1"]);
    expect(liveFrameFor("m1")).toBeUndefined();
  });

  it("stands down while playback holds the link, the app is in the background or the guide is off screen, and closes its holds when the guide leaves", async () => {
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
    expect(held.size).toBe(0);
    await advance(LIVE_FRAME_REFRESH_MS * 2);
    expect(grabs()).toHaveLength(3);
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

  it("shows the newest frame on disk before any grab and counts the refresh from its time", async () => {
    mockOnDisk.mockResolvedValue({ m1: `file:///pool/m1/live-${1_000_000 - 2_000}.jpg` });
    const listener = jest.fn();
    subscribeLiveFrame("m1", listener);
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "m2"]);
    await advance(0);
    expect(liveFrameFor("m1")).toEqual({ uri: "file:///pool/m1/live-998000.jpg", cacheKey: "live-m1-998000" });
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
    mockLiveFrame.mockImplementation(() => new Promise((resolve) => (answer = () => resolve({ uri: null, cancelled: true }))));
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
    await advance(0);
    expect(grabs()).toEqual(["m1", "m2"]);
    answer?.();
    await flush();
  });

  it("starts no read for a grab whose server open lands after playback took the link", async () => {
    let opened: (() => void) | undefined;
    mockWarm.mockImplementation((id: string) => new Promise<void>((resolve) => (opened = () => (held.set(id, `https://jf/${id}.ts`), resolve()))));
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["t1"]);
    await advance(0);
    expect(mockWarm).toHaveBeenCalledWith("t1");

    setPlaybackHold("video", true);
    expect(mockCancel.mock.calls).toEqual([["t1"]]);
    opened?.();
    await flush();
    expect(grabs()).toEqual([]);
    setPlaybackHold("video", false);
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
