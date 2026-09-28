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
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/localRemux", () => ({ isLocalRemuxAvailable: () => true, nativeEmits: (event: string) => event === "onLiveFrame" }));
jest.mock("@/services/jellyfinApi", () => ({
  resolveChannelOrigin: (id: string) => mockResolveOrigin(id),
  openChannel: (id: string, item: unknown, options: unknown) => mockOpenChannel(id, item, options),
  closeLiveStream: (id: string) => mockCloseLiveStream(id),
  openRecentlyFailed: (id: string) => mockOpenRecentlyFailed(id),
}));

import {
  clearLiveFrames,
  LIVE_FRAME_BURST_COUNT,
  LIVE_FRAME_CAP_COOLDOWN_MS,
  LIVE_FRAME_COLD_COUNT,
  LIVE_FRAME_COLD_DEADLINE_S,
  LIVE_FRAME_DWELL_MS,
  LIVE_FRAME_EXPIRY_MS,
  LIVE_FRAME_REFRESH_CAP_MS,
  LIVE_FRAME_REFRESH_MS,
  LIVE_FRAME_RETRY_MS,
  LIVE_FRAME_SPACING_MS,
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
    // The first grab for a bare card takes the short cold profile; one open either way.
    expect(mockLiveFrame.mock.calls[0][0]).toMatchObject({
      channelId: "m1",
      inputUrl: "https://origin/m1.m3u8",
      httpHeaders: { "User-Agent": "Tuner" },
      count: LIVE_FRAME_COLD_COUNT,
      deadline: LIVE_FRAME_COLD_DEADLINE_S,
    });
    expect(liveFrameFor("m1")).toEqual({ uri: "file:///pool/m1/live-1000000-0.jpg", cacheKey: "live-m1-1000000-0" });
    expect(mockOnDisk).toHaveBeenCalledWith(["m1", "m2"]);
    await advance(LIVE_FRAME_SPACING_MS);
    expect(grabs()).toEqual(["m1", "m2"]);
    expect(mockOpenChannel).not.toHaveBeenCalled();
  });

  it("walks a burst one frame per dwell, telling the card at each step", async () => {
    const listener = jest.fn();
    subscribeLiveFrame("m1", listener);
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    expect(listener).toHaveBeenCalledTimes(1);
    await advance(LIVE_FRAME_DWELL_MS - 1_000);
    expect(liveFrameFor("m1")?.uri).toBe("file:///pool/m1/live-1000000-0.jpg");
    // The ticker walks once a second; the dwell edge is noticed on the tick after it.
    await advance(1_500);
    expect(liveFrameFor("m1")?.uri).toBe("file:///pool/m1/live-1000000-1.jpg");
    expect(listener).toHaveBeenCalledTimes(2);
    await advance(LIVE_FRAME_DWELL_MS * 6);
    expect(liveFrameFor("m1")?.uri).toBe("file:///pool/m1/live-1000000-7.jpg");
    expect(listener).toHaveBeenCalledTimes(8);
    // The burst loops: a full lap lands back on the same frame.
    await advance(LIVE_FRAME_DWELL_MS * LIVE_FRAME_BURST_COUNT);
    expect(liveFrameFor("m1")?.uri).toBe("file:///pool/m1/live-1000000-7.jpg");
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
    // A frame for a channel no grab is reading is dropped.
    emitLiveFrame({ channelId: "m9", uri: "file:///pool/m9/live-1000000-0.jpg", index: 0 });
    expect(liveFrameFor("m9")).toBeUndefined();

    answer?.();
    await flush();
    expect(liveFrameFor("m1")).toEqual({ uri: "file:///pool/m1/live-1000000-0.jpg", cacheKey: "live-m1-1000000-0" });
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
    expect(listener).toHaveBeenCalledTimes(1);
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
    mockOnDisk.mockResolvedValue({ m1: onDisk("m1", 1_000_000 - 2_000, 2) });
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

  it("leaves a stale burst on disk off screen and asks that channel at once", async () => {
    mockOnDisk.mockResolvedValue({ m1: onDisk("m1", 1_000_000 - LIVE_FRAME_EXPIRY_MS - 60_000, 2) });
    setLiveFramesActive("guide", true);
    setLiveFrameViewable("guide", ["m1"]);
    await advance(0);
    // The day-old pictures never show; the first grab replaces nothing but a placeholder.
    expect(grabs()).toEqual(["m1"]);
    expect(liveFrameFor("m1")?.uri).toBe("file:///pool/m1/live-1000000-0.jpg");
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
