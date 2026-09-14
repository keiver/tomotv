/**
 * The live ring owns every session it starts: neighbours heat only while the center plays, a
 * session is bindable only once the engine cut a segment, and whatever leaves the ring is stopped.
 */
import { closeLiveStream, closeWarmedChannels, noteOpenFailed, openChannel, warmChannel } from "@/services/jellyfinApi";
import { isHotChannel, recenterLiveRing, releaseLiveRing, retainLiveSession, ringAround, takeHotChannel } from "@/services/liveRing";
import { setLiveWindow, startLocalRemux, stopLocalRemux } from "@/services/localRemux";

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

jest.mock("@/services/jellyfinApi", () => ({
  openChannel: jest.fn((id: string) => Promise.resolve({ Id: id, Name: id, LiveStreamId: `ls-${id}`, liveStreamUrl: `https://origin/${id}.m3u8` })),
  closeLiveStream: jest.fn(() => Promise.resolve()),
  closeWarmedChannels: jest.fn(() => Promise.resolve()),
  warmChannel: jest.fn(() => Promise.resolve()),
  noteOpenFailed: jest.fn(),
  openRecentlyFailed: jest.fn(() => false),
}));

const mockThroughput = new Map<string, () => void>();
const mockFailures = new Map<string, (failure: { message: string }) => void>();
jest.mock("@/services/localRemux", () => ({
  canRemuxLocally: jest.fn(() => Promise.resolve(true)),
  startLocalRemux: jest.fn((details: { Id: string }) => Promise.resolve(`http://127.0.0.1:1/${details.Id}-s/master.m3u8`)),
  stopLocalRemux: jest.fn(() => Promise.resolve()),
  localRemuxToken: (url: string | null) => url?.split("/").at(-2) ?? null,
  setLiveWindow: jest.fn(() => Promise.resolve()),
  subscribeEngineThroughput: jest.fn((token: string, listener: () => void) => {
    mockThroughput.set(token, listener);
    return jest.fn();
  }),
  subscribeEngineFailure: jest.fn((token: string, listener: (failure: { message: string }) => void) => {
    mockFailures.set(token, listener);
    return jest.fn();
  }),
}));

const RING = Array.from({ length: 30 }, (_, i) => ({ Id: `c${i}` }));
const flush = async () => {
  for (let hop = 0; hop < 12; hop++) await Promise.resolve();
};
const segmentCut = (token: string) => mockThroughput.get(token)!();

describe("liveRing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockThroughput.clear();
    mockFailures.clear();
  });
  afterEach(async () => {
    await releaseLiveRing();
  });

  it("names the ring either way round, wrapping, without the center", () => {
    expect(ringAround(RING, "c0", 2)).toEqual(["c1", "c2", "c29", "c28"]);
  });

  it("heats both neighbours while the center plays, bindable once a segment is cut", async () => {
    recenterLiveRing(RING, "c5", true);
    await flush();

    expect(openChannel).toHaveBeenCalledWith("c6", undefined, { quiet: true });
    expect(openChannel).toHaveBeenCalledWith("c4", undefined, { quiet: true });
    expect(startLocalRemux).toHaveBeenCalledWith(expect.objectContaining({ Id: "c6" }), undefined, undefined, { prewarm: true, liveWindowSeconds: 20 });
    expect(isHotChannel("c6")).toBe(false);
    expect(takeHotChannel("c6")).toBeNull();

    segmentCut("c6-s");
    expect(isHotChannel("c6")).toBe(true);
    expect(takeHotChannel("c6")).toEqual({ channelId: "c6", details: expect.objectContaining({ Id: "c6" }), url: "http://127.0.0.1:1/c6-s/master.m3u8", token: "c6-s" });
    expect(setLiveWindow).toHaveBeenCalledWith("c6-s", 300);
    expect(isHotChannel("c6")).toBe(false);
  });

  it("holds the wider ring open on the server, and starts no engine session while the center loads", async () => {
    recenterLiveRing(RING, "c5", false);
    await flush();

    expect(startLocalRemux).not.toHaveBeenCalled();
    expect(warmChannel).toHaveBeenCalledTimes(20);
    expect(warmChannel).toHaveBeenCalledWith("c6");
    expect(warmChannel).toHaveBeenCalledWith("c25");
    expect(closeWarmedChannels).toHaveBeenCalledWith(expect.arrayContaining(["c4", "c6", "c15", "c25"]));
  });

  it("stops a neighbour that falls off the ring when the center moves", async () => {
    recenterLiveRing(RING, "c5", true);
    await flush();
    segmentCut("c4-s");
    segmentCut("c6-s");

    recenterLiveRing(RING, "c6", true);
    await flush();

    expect(stopLocalRemux).toHaveBeenCalledWith("c4-s");
    expect(closeLiveStream).toHaveBeenCalledWith("ls-c4");
    expect(stopLocalRemux).not.toHaveBeenCalledWith("c6-s");
    expect(startLocalRemux).toHaveBeenCalledWith(expect.objectContaining({ Id: "c7" }), undefined, undefined, expect.anything());
  });

  it("keeps the channel just left hot beside the new center, and releases everything with the player", async () => {
    recenterLiveRing(RING, "c10", true);
    await flush();
    const left = { channelId: "c10", details: { Id: "c10", Name: "c10", LiveStreamId: "ls-c10" } as never, url: "http://127.0.0.1:1/c10-s/master.m3u8", token: "c10-s" };

    expect(retainLiveSession(left)).toBe(true);
    expect(setLiveWindow).toHaveBeenCalledWith("c10-s", 20);
    recenterLiveRing(RING, "c11", true);
    await flush();
    expect(stopLocalRemux).not.toHaveBeenCalledWith("c10-s");
    expect(isHotChannel("c10")).toBe(true);

    await releaseLiveRing();
    expect(stopLocalRemux).toHaveBeenCalledWith("c10-s");
    expect(closeLiveStream).toHaveBeenCalledWith("ls-c10");
    expect(retainLiveSession({ ...left, channelId: "c12", token: "c12-x" })).toBe(false);
  });

  it("leaves a neighbour whose engine failed cold instead of starting it again", async () => {
    recenterLiveRing(RING, "c20", true);
    await flush();
    mockFailures.get("c21-s")!({ message: "open_input: I/O error" });

    expect(stopLocalRemux).toHaveBeenCalledWith("c21-s");
    recenterLiveRing(RING, "c20", true);
    await flush();
    expect((startLocalRemux as jest.Mock).mock.calls.filter(([details]) => details.Id === "c21")).toHaveLength(1);
  });

  it("notes a neighbour whose open failed", async () => {
    (openChannel as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error("timeout")));
    recenterLiveRing(RING, "c25", true);
    await flush();

    expect(noteOpenFailed).toHaveBeenCalledWith("c26");
  });
});
