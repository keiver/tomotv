/**
 * Tests for the poster frame request: the seek rule, the settled cache, one shared job for
 * callers asking at once, a cancel that settles nothing, and the held file's own path.
 */
const mockPosterFrame = jest.fn();
const mockCancelPosterFrame = jest.fn();
const mockClearFramePool = jest.fn();
const mockLocalMediaUri = jest.fn((_id: string): string | null => null);

jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: true },
  NativeModules: {
    LocalRemuxer: {
      startRemux: jest.fn(),
      posterFrame: (config: unknown) => mockPosterFrame(config),
      cancelPosterFrame: (itemId: string) => mockCancelPosterFrame(itemId),
      clearFramePool: () => mockClearFramePool(),
    },
  },
  NativeEventEmitter: jest.fn(),
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/jellyfinApi", () => ({
  JELLYFIN_TIME: { TICKS_PER_SECOND: 10_000_000 },
  generatePlaySessionId: jest.fn(),
  getVideoStreamUrl: jest.fn(),
  getSubtitleUrl: jest.fn(),
  isImageBasedSubtitleCodec: jest.fn(() => false),
}));
jest.mock("@/services/downloads/localSource", () => ({
  localMediaUri: (id: string) => mockLocalMediaUri(id),
  localSubtitleUri: jest.fn(() => null),
  playsFromDisk: jest.fn(() => false),
}));
jest.mock("@/services/jellyfin/streamUrls", () => ({
  getRemoteVideoStreamUrl: jest.fn((id: string) => `https://jf/Videos/${id}/stream?Static=true`),
  getAudioRenditionUrl: jest.fn(),
  getTierPlaylistUrl: jest.fn(),
}));
jest.mock("@/services/jellyfin/bitrateTest", () => ({ rememberedBitrate: jest.fn() }));
jest.mock("@/services/playbackProbe", () => ({ probeEmit: jest.fn() }));

import { cancelPosterFrame, clearFramePool, clearPosterFrameCache, posterFrameGeneration, posterFrameIfCached, posterFrameSeconds, requestPosterFrame } from "../localRemux";

const TICKS = 10_000_000;

describe("posterFrameSeconds", () => {
  it("takes the frame a tenth of the way in, or ten seconds in without a runtime", () => {
    expect(posterFrameSeconds({ RunTimeTicks: 3600 * TICKS })).toBe(360);
    expect(posterFrameSeconds({ RunTimeTicks: 0 })).toBe(10);
    expect(posterFrameSeconds({ RunTimeTicks: undefined as unknown as number })).toBe(10);
  });
});

describe("requestPosterFrame", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPosterFrameCache();
    mockLocalMediaUri.mockReturnValue(null);
    mockPosterFrame.mockResolvedValue({ uri: "file:///caches/chapter-frames/a/poster.jpg", cancelled: false });
  });

  it("asks the engine for the original file a tenth of the way in, then serves the answer from memory", async () => {
    const uri = await requestPosterFrame({ Id: "a", RunTimeTicks: 600 * TICKS });

    expect(uri).toBe("file:///caches/chapter-frames/a/poster.jpg");
    expect(mockPosterFrame).toHaveBeenCalledWith({ itemId: "a", inputUrl: "https://jf/Videos/a/stream?Static=true", seconds: 60 });
    expect(posterFrameIfCached("a")).toBe(uri);

    await requestPosterFrame({ Id: "a", RunTimeTicks: 600 * TICKS });
    expect(mockPosterFrame).toHaveBeenCalledTimes(1);
  });

  it("shares one job between callers asking at once", async () => {
    const [first, second] = await Promise.all([requestPosterFrame({ Id: "a", RunTimeTicks: 0 }), requestPosterFrame({ Id: "a", RunTimeTicks: 0 })]);

    expect(first).toBe(second);
    expect(mockPosterFrame).toHaveBeenCalledTimes(1);
  });

  it("keeps a failure so a card never asks twice for a file the engine cannot open", async () => {
    mockPosterFrame.mockRejectedValueOnce(new Error("open failed"));

    expect(await requestPosterFrame({ Id: "a", RunTimeTicks: 0 })).toBeNull();
    expect(await requestPosterFrame({ Id: "a", RunTimeTicks: 0 })).toBeNull();
    expect(mockPosterFrame).toHaveBeenCalledTimes(1);
  });

  it("asks again for a job the engine dropped while a card still waits", async () => {
    mockPosterFrame.mockResolvedValueOnce({ uri: null, cancelled: true });

    expect(await requestPosterFrame({ Id: "a", RunTimeTicks: 0 })).toBe("file:///caches/chapter-frames/a/poster.jpg");
    expect(mockPosterFrame).toHaveBeenCalledTimes(2);
  });

  it("settles nothing for a job the engine dropped with no card waiting, so the next card asks again", async () => {
    let settle: (value: { uri: string | null; cancelled: boolean }) => void = () => {};
    mockPosterFrame.mockImplementationOnce(() => new Promise((resolve) => (settle = resolve)));

    const first = requestPosterFrame({ Id: "a", RunTimeTicks: 0 });
    cancelPosterFrame("a");
    settle({ uri: null, cancelled: true });
    expect(await first).toBeNull();
    expect(posterFrameIfCached("a")).toBeUndefined();
    expect(await requestPosterFrame({ Id: "a", RunTimeTicks: 0 })).toBe("file:///caches/chapter-frames/a/poster.jpg");
    expect(mockPosterFrame).toHaveBeenCalledTimes(2);
  });

  it("gives a card that came back before the engine reached the dropped job its frame", async () => {
    let settle: (value: { uri: string | null; cancelled: boolean }) => void = () => {};
    mockPosterFrame.mockImplementationOnce(() => new Promise((resolve) => (settle = resolve)));

    const first = requestPosterFrame({ Id: "a", RunTimeTicks: 0 });
    cancelPosterFrame("a");
    const second = requestPosterFrame({ Id: "a", RunTimeTicks: 0 });
    settle({ uri: null, cancelled: true });
    expect(await second).toBe("file:///caches/chapter-frames/a/poster.jpg");
    expect(await first).toBe("file:///caches/chapter-frames/a/poster.jpg");
    expect(posterFrameIfCached("a")).toBe("file:///caches/chapter-frames/a/poster.jpg");
    expect(mockPosterFrame).toHaveBeenCalledTimes(2);
  });

  it("opens a held download by its own file", async () => {
    mockLocalMediaUri.mockReturnValue("file:///downloads/a/media.mkv");

    await requestPosterFrame({ Id: "a", RunTimeTicks: 0 });

    expect(mockPosterFrame).toHaveBeenCalledWith(expect.objectContaining({ inputUrl: "file:///downloads/a/media.mkv" }));
  });
});

describe("clearPosterFrameCache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPosterFrameCache();
    mockLocalMediaUri.mockReturnValue(null);
    mockPosterFrame.mockResolvedValue({ uri: "file:///caches/chapter-frames/a/poster.jpg", cancelled: false });
  });

  it("settles nothing from a job that outlived the clear", async () => {
    let settle: (value: { uri: string | null; cancelled: boolean }) => void = () => {};
    mockPosterFrame.mockImplementationOnce(() => new Promise((resolve) => (settle = resolve)));
    const generation = posterFrameGeneration();
    const job = requestPosterFrame({ Id: "a", RunTimeTicks: 0 });

    clearPosterFrameCache();
    expect(posterFrameGeneration()).not.toBe(generation);
    settle({ uri: "file:///caches/chapter-frames/a/poster.jpg", cancelled: false });
    await job;

    expect(posterFrameIfCached("a")).toBeUndefined();
  });

  it("leaves the job started after it holding its own entry", async () => {
    let settleStale: (value: { uri: string | null; cancelled: boolean }) => void = () => {};
    let settleLive: (value: { uri: string | null; cancelled: boolean }) => void = () => {};
    mockPosterFrame.mockImplementationOnce(() => new Promise((resolve) => (settleStale = resolve)));
    mockPosterFrame.mockImplementationOnce(() => new Promise((resolve) => (settleLive = resolve)));

    const stale = requestPosterFrame({ Id: "a", RunTimeTicks: 0 });
    clearPosterFrameCache();
    const live = requestPosterFrame({ Id: "a", RunTimeTicks: 0 });
    settleStale({ uri: "file:///caches/chapter-frames/a/poster.jpg", cancelled: false });
    await stale;

    // A card arriving after the clear joins the live job instead of starting a third.
    const joined = requestPosterFrame({ Id: "a", RunTimeTicks: 0 });
    expect(mockPosterFrame).toHaveBeenCalledTimes(2);

    // Both of the live job's waiters are still counted, so the engine hears the last cancel.
    cancelPosterFrame("a");
    expect(mockCancelPosterFrame).not.toHaveBeenCalled();
    cancelPosterFrame("a");
    expect(mockCancelPosterFrame).toHaveBeenCalledWith("a");

    settleLive({ uri: "file:///caches/chapter-frames/a/poster.jpg", cancelled: false });
    await Promise.all([live, joined]);
  });

  it("empties the engine's pool on disk as well", async () => {
    await clearFramePool();
    expect(mockClearFramePool).toHaveBeenCalled();
  });
});

describe("cancelPosterFrame", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPosterFrameCache();
    mockLocalMediaUri.mockReturnValue(null);
  });

  it("tells the engine to drop the job only when the last waiting card leaves", async () => {
    let settle: (value: { uri: string | null }) => void = () => {};
    mockPosterFrame.mockImplementation(() => new Promise((resolve) => (settle = resolve)));
    void requestPosterFrame({ Id: "a", RunTimeTicks: 0 });
    void requestPosterFrame({ Id: "a", RunTimeTicks: 0 });

    cancelPosterFrame("a");
    expect(mockCancelPosterFrame).not.toHaveBeenCalled();
    cancelPosterFrame("a");
    expect(mockCancelPosterFrame).toHaveBeenCalledWith("a");

    settle({ uri: null });
  });

  it("does nothing for an item nobody is waiting on", () => {
    cancelPosterFrame("nobody");
    expect(mockCancelPosterFrame).not.toHaveBeenCalled();
  });
});
