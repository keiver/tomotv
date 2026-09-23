/**
 * The live frame sampler: one grab at a time, a burst per open walked across the refresh, a refresh that backs off
 * while a live edge stands still, the oldest first, a manifest channel read at its origin and a tuner channel
 * opened on the server for its burst and closed after, backoff on failure, and standing down for the screen, the
 * app and playback.
 */
const mockLiveFrame = jest.fn();
const mockOnDisk = jest.fn();
const mockCancel = jest.fn();
const mockResolveOrigin = jest.fn();
const mockOpenChannel = jest.fn();
const mockCloseLiveStream = jest.fn();
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
  openChannel: (id: string, item: unknown, options: unknown) => mockOpenChannel(id, item, options),
  closeLiveStream: (id: string) => mockCloseLiveStream(id),
  openRecentlyFailed: (id: string) => mockOpenRecentlyFailed(id),
}));

import {
  clearLiveFrames,
  LIVE_FRAME_BURST_COUNT,
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
/** A burst of `count` files under one stamp, the shape the engine answers with. */
const burst = (channelId: string, stamp: number, count = LIVE_FRAME_BURST_COUNT) => Array.from({ length: count }, (_, i) => `file:///pool/${channelId}/live-${stamp}-${i}.jpg`);

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
    expect(mockLiveFrame.mock.calls[0][0]).toMatchObject({ channelId: "m1", inputUrl: "https://origin/m1.m3u8", httpHeaders: { "User-Agent": "Tuner" }, count: LIVE_FRAME_BURST_COUNT });
    expect(liveFrameFor("m1")).toEqual({ uri: "file:///pool/m1/live-1000000-0.jpg", cacheKey: "live-m1-1000000-0" });
    expect(mockOnDisk).toHaveBeenCalledWith(["m1", "m2"]);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m2"]);
    expect(mockOpenChannel).not.toHaveBeenCalled();
  });

  it("walks a burst across the refresh, one frame per slice, telling the card at each step", async () => {
    const listener = jest.fn();
    subscribeLiveFrame("m1", listener);
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(listener).toHaveBeenCalledTimes(1);
    const slice = LIVE_FRAME_REFRESH_MS / LIVE_FRAME_BURST_COUNT;
    await advance(slice - 1_000);
    expect(liveFrameFor("m1")?.uri).toBe("file:///pool/m1/live-1000000-0.jpg");
    // The ticker walks once a second; the slice edge is noticed on the tick after it.
    await advance(1_500);
    expect(liveFrameFor("m1")?.uri).toBe("file:///pool/m1/live-1000000-1.jpg");
    expect(listener).toHaveBeenCalledTimes(2);
    await advance(slice * 6);
    expect(liveFrameFor("m1")?.uri).toBe("file:///pool/m1/live-1000000-7.jpg");
    expect(listener).toHaveBeenCalledTimes(8);
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
    expect(listener).toHaveBeenCalledTimes(1);
    const shown = liveFrameFor("m1");
    // Each unchanged answer doubles the wait: 2 min, 4 min, then the 5 min cap.
    for (const waitMs of [120_000, 240_000, LIVE_FRAME_REFRESH_CAP_MS, LIVE_FRAME_REFRESH_CAP_MS]) {
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
    await advance(LIVE_FRAME_REFRESH_MS + LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1"]);
    await advance(LIVE_FRAME_RETRY_MS);
    expect(grabs()).toEqual(["m1", "m1"]);
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
    mockOnDisk.mockResolvedValue({ m1: burst("m1", 1_000_000 - 2_000, 2) });
    const listener = jest.fn();
    subscribeLiveFrame("m1", listener);
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1", "m2"]);
    await advance(0);
    expect(liveFrameFor("m1")).toEqual({ uri: "file:///pool/m1/live-998000-0.jpg", cacheKey: "live-m1-998000-0" });
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
    await advance(0);
    expect(grabs()).toEqual(["m1", "m2"]);
    answer?.();
    await flush();
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
