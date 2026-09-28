/**
 * The focused card's warm session: one engine session without a server open, ended the moment focus moves on,
 * held briefly when focus leaves so the player can adopt it, and ranked as playback once adopted.
 */
const mockResolveWithoutOpen = jest.fn();
const mockStart = jest.fn();
const mockStop = jest.fn();
const mockSetWindow = jest.fn();
const mockSetPriority = jest.fn();
const mockThroughput = new Map<string, () => void>();

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/jellyfinApi", () => ({ resolveChannelWithoutOpen: (id: string) => mockResolveWithoutOpen(id) }));
jest.mock("@/services/localRemux", () => ({
  canRemuxLocally: async () => true,
  localRemuxToken: (url: string) => url.split("/")[3],
  startLocalRemux: (...args: unknown[]) => mockStart(...args),
  stopLocalRemux: (token: string | null) => mockStop(token),
  setLiveWindow: (token: string, seconds: number) => mockSetWindow(token, seconds),
  setLiveSessionPriority: (token: string, priority: string) => mockSetPriority(token, priority),
  subscribeEngineThroughput: (token: string, listener: () => void) => {
    mockThroughput.set(token, listener);
    return () => mockThroughput.delete(token);
  },
  subscribeEngineFailure: () => () => {},
}));

import { showLivePreview, stopLivePreview, takeLivePreview } from "../livePreview";

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe("live preview", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    stopLivePreview();
    mockThroughput.clear();
    mockResolveWithoutOpen.mockReset().mockImplementation(async (id: string) => ({ Id: id, Name: id, liveStreamUrl: `http://origin/${id}.ts`, liveOriginKey: "origin" }));
    mockStart.mockReset().mockImplementation(async (details: { Id: string }) => `http://127.0.0.1:9999/tok-${details.Id}/master.m3u8`);
    mockStop.mockReset();
    mockSetWindow.mockReset();
    mockSetPriority.mockReset();
  });

  afterEach(() => jest.useRealTimers());

  it("starts a preview-ranked session on the channel's origin", async () => {
    showLivePreview("c1");
    await flush();
    expect(mockStart.mock.calls[0][3]).toMatchObject({ prewarm: true, livePriority: "preview" });
  });

  it("never previews a channel only a server open reads", async () => {
    mockResolveWithoutOpen.mockResolvedValue(null);
    showLivePreview("c1");
    await flush();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("ends the running preview the moment focus moves to another channel", async () => {
    showLivePreview("c1");
    await flush();
    showLivePreview("c2");
    expect(mockStop).toHaveBeenCalledWith("tok-c1");
    await flush();
    expect(mockStart).toHaveBeenCalledTimes(2);
  });

  it("holds the preview briefly when focus leaves, then lets it go unless the player took it", async () => {
    showLivePreview("c1");
    await flush();
    showLivePreview(null);
    expect(mockStop).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5_000);
    expect(mockStop).toHaveBeenCalledWith("tok-c1");
  });

  it("hands the session to the player as playback, and the grace then stops nothing", async () => {
    showLivePreview("c1");
    await flush();
    mockThroughput.get("tok-c1")!();
    mockThroughput.get("tok-c1")!();
    showLivePreview(null);
    const session = takeLivePreview("c1");
    expect(session).toMatchObject({ channelId: "c1", token: "tok-c1", ready: true });
    expect(mockSetPriority).toHaveBeenCalledWith("tok-c1", "playback");
    expect(mockSetWindow).toHaveBeenCalledWith("tok-c1", 300);
    jest.advanceTimersByTime(10_000);
    expect(mockStop).not.toHaveBeenCalled();
    expect(takeLivePreview("c1")).toBeNull();
  });

  it("lets every connection go at once in the background", async () => {
    showLivePreview("c1");
    await flush();
    stopLivePreview();
    expect(mockStop).toHaveBeenCalledWith("tok-c1");
  });
});
