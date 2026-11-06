/** liveTiles - multiview's live sessions: who opens, in what order, at what priority, and what drops back to a clip. */

const mockFailures = new Map<string, (failure: { token: string; message: string }) => void>();
const mockThroughput = new Map<string, (sample: { produceSeconds: number; readSeconds: number; segmentSeconds: number }) => void>();
const mockStopped: string[] = [];
const mockPriorities: [string, string][] = [];
const mockLimits = new Map<string, number>();
const mockHolds: [string, boolean][] = [];
const mockBudgetListeners = new Set<() => void>();
let mockAppListeners: Record<string, (state?: string) => void> = {};

jest.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: (event: string, listener: (state?: string) => void) => (mockAppListeners[event] = listener) },
  Platform: { OS: "ios", isTV: true, select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
  NativeModules: {},
  NativeEventEmitter: class {
    addListener() {
      return { remove: () => {} };
    }
  },
}));
jest.mock("@keiver/tomo-engine", () => ({
  ...jest.requireActual("@keiver/tomo-engine"),
  engineLog: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn() }),
  originHeld: () => false,
  localRemuxToken: (url: string) => /^http:\/\/127\.0\.0\.1\/([^/]+)\//.exec(url)?.[1] ?? null,
  stopLocalRemux: async (token: string) => {
    mockStopped.push(token);
  },
  setLiveWindow: async () => {},
  setLiveSessionPriority: async (token: string, priority: string) => {
    mockPriorities.push([token, priority]);
  },
  originConnectionLimit: (key: string | undefined) => (key ? (mockLimits.get(key) ?? null) : null),
  subscribeOriginConnectionBudget: (listener: () => void) => {
    mockBudgetListeners.add(listener);
    return () => mockBudgetListeners.delete(listener);
  },
  subscribeEngineFailure: (token: string, listener: (failure: { token: string; message: string }) => void) => {
    mockFailures.set(token, listener);
    return () => mockFailures.delete(token);
  },
  subscribeEngineThroughput: (token: string, listener: (sample: { produceSeconds: number; readSeconds: number }) => void) => {
    mockThroughput.set(token, listener);
    return () => mockThroughput.delete(token);
  },
}));
jest.mock("../src/liveFrames", () => ({
  setLiveFrameOriginHold: (key: string, held: boolean) => mockHolds.push([key, held]),
}));
// "pl-" channels come from a playlist, whose provider is known without opening them.
jest.mock("../src/playlistChannels", () => ({
  ...jest.requireActual("../src/playlistChannels"),
  playlistChannelById: (id: string) => (id.startsWith("pl-") ? { id, originKey: "one.example" } : null),
}));

import { configureLive } from "../src/config";
import { clearTunerChannels, noteTunerChannel } from "../src/channelOrigin";
import {
  LIVE_TILE_DROP_SPACING_MS,
  LIVE_TILE_HANDOFF_GRACE_MS,
  LIVE_TILE_MAIN_RETRY_MS,
  LIVE_TILE_OPEN_SPACING_MS,
  liveTileFailed,
  liveTileUnavailable,
  liveTileUrl,
  noteLiveTileFailed,
  retainLiveTile,
  setLiveTiles,
  takeLiveTile,
} from "../src/liveTiles";
import { MULTIVIEW_PLAYBACK_OWNER, setPlaybackHold } from "../src/playbackHold";

type Item = { Id: string; LiveStreamId?: string; origin?: string };
const resolvedWithout: string[] = [];
const openedOnServer: string[] = [];
const closed: string[] = [];
const started: [string, string | undefined][] = [];
let startFailure: ((id: string) => Error | null) | null = null;
let serverOnly = new Set<string>();

configureLive<Item>({
  channels: {
    // Resolved as the player resolves: read at its origin, else opened on the server ("srv" channels).
    resolve: async (id) => {
      openedOnServer.push(id);
      return id.startsWith("srv") ? { Id: id, LiveStreamId: `ls-${id}` } : { Id: id, origin: id.startsWith("one") ? "one.example" : "many.example" };
    },
    resolveWithoutOpen: async (id) => {
      resolvedWithout.push(id);
      return serverOnly.has(id) ? null : { Id: id, origin: id.startsWith("one") ? "one.example" : "many.example" };
    },
    resolveOrigin: async () => null,
    open: async (id) => ({ Id: id }),
    close: async (item) => {
      closed.push(item.LiveStreamId ?? item.Id);
    },
    holdsOpen: (item) => !!item.LiveStreamId,
    streamUrl: () => "https://origin/stream",
    name: (item) => item.Id,
    canPlayOnDevice: async () => true,
    originKey: (item) => item.origin,
    startSession: async (item, options) => {
      started.push([item.Id, options.livePriority]);
      const failure = startFailure?.(item.Id);
      if (failure) throw failure;
      return `http://127.0.0.1/t-${item.Id}/master.m3u8`;
    },
    subscribeListChange: () => () => {},
  },
});

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
const advance = async (ms: number) => {
  jest.advanceTimersByTime(ms);
  await flush();
};
/** Lets every queued open run, one spacing at a time. */
const openAll = async (opens: number) => {
  await flush();
  for (let i = 0; i < opens; i += 1) await advance(LIVE_TILE_OPEN_SPACING_MS);
};
const bound = { produceSeconds: 2, readSeconds: 2, segmentSeconds: 1 };

beforeEach(() => {
  jest.useFakeTimers();
  for (const list of [resolvedWithout, openedOnServer, closed, started, mockStopped, mockPriorities, mockHolds]) list.length = 0;
  mockFailures.clear();
  mockThroughput.clear();
  mockLimits.clear();
  startFailure = null;
  serverOnly = new Set();
  clearTunerChannels();
  setPlaybackHold("video", false);
});

afterEach(async () => {
  setLiveTiles([]);
  await flush();
  jest.useRealTimers();
});

describe("liveTiles", () => {
  it("opens the main first at playback priority as the player would, then each satellite at preview priority without a server open, a second apart", async () => {
    setLiveTiles(["a", "b", "c"]);
    await flush();
    expect(started).toEqual([["a", "playback"]]);
    expect(openedOnServer).toEqual(["a"]);
    await advance(LIVE_TILE_OPEN_SPACING_MS);
    expect(started).toEqual([
      ["a", "playback"],
      ["b", "preview"],
    ]);
    await openAll(2);
    expect(started.map(([id]) => id)).toEqual(["a", "b", "c"]);
    expect(resolvedWithout).toEqual(["b", "c"]);
    expect(liveTileUrl("c")).toBe("http://127.0.0.1/t-c/master.m3u8");
  });

  it("never opens a hardware tuner satellite, and keeps a satellite the server must open out of the grid", async () => {
    noteTunerChannel("hd1");
    serverOnly = new Set(["srv"]);
    setLiveTiles(["a", "hd1", "srv", "b"]);
    await openAll(4);
    expect(resolvedWithout).not.toContain("hd1");
    expect(openedOnServer).toEqual(["a"]);
    expect(liveTileUnavailable("hd1")).toBe(true);
    expect(liveTileUnavailable("srv")).toBe(true);
    expect(liveTileUrl("b")).not.toBeNull();
    // Still unavailable once the grid is rebuilt without them.
    setLiveTiles(["a", "b", "d"]);
    expect(liveTileUnavailable("srv")).toBe(true);
  });

  it("opens a spot the viewer filled the way the player opens a channel, a hardware tuner included, and never one Tomo filled", async () => {
    noteTunerChannel("hd1");
    noteTunerChannel("hd2");
    setLiveTiles(["a", "hd1", "hd2"], { chosen: ["hd1"] });
    await openAll(3);
    expect(openedOnServer).toEqual(["a", "hd1"]);
    expect(liveTileUrl("hd1")).not.toBeNull();
    expect(liveTileUrl("hd2")).toBeNull();
    setLiveTiles(["a", "hd1", "hd2"], { chosen: [] });
    await flush();
    expect(liveTileUrl("hd1")).toBeNull();
  });

  it("closes the main's server open when its tile ends", async () => {
    setLiveTiles(["srv-a", "b"]);
    await openAll(2);
    expect(openedOnServer).toEqual(["srv-a"]);
    setLiveTiles([]);
    await flush();
    expect(closed).toEqual(["ls-srv-a"]);
    expect(mockStopped).toEqual(expect.arrayContaining(["t-srv-a", "t-b"]));
  });

  it("leaves a satellite refused for the provider's budget on its clip until a tile session closes, then tries it again", async () => {
    startFailure = (id) => (id === "c" ? new Error("no connection left on the provider") : null);
    setLiveTiles(["a", "b", "c"]);
    await openAll(4);
    expect(liveTileUrl("c")).toBeNull();
    expect(started.filter(([id]) => id === "c")).toHaveLength(1);
    startFailure = null;
    mockFailures.get("t-b")!({ token: "t-b", message: "input ended" });
    await openAll(2);
    expect(liveTileUrl("c")).not.toBeNull();
  });

  it("stops a tile session that failed, so it never counts against the engine's sessions", async () => {
    setLiveTiles(["a", "b"]);
    await openAll(2);
    mockFailures.get("t-b")!({ token: "t-b", message: "input ended" });
    await flush();
    expect(mockStopped).toContain("t-b");
  });

  it("keeps two satellites that lost their connection to the provider's budget on their clips, never reopening each other", async () => {
    const yielded = "live input yielded its connection to a higher-priority read";
    setLiveTiles(["a", "b", "c"]);
    await openAll(3);
    mockFailures.get("t-b")!({ token: "t-b", message: yielded });
    await flush();
    mockFailures.get("t-c")!({ token: "t-c", message: yielded });
    await openAll(5);
    expect(started.filter(([id]) => id === "b")).toHaveLength(1);
    expect(started.filter(([id]) => id === "c")).toHaveLength(1);
    expect(liveTileUrl("a")).not.toBeNull();
  });

  it("keeps a satellite live whose segment spent its time reading but still came faster than it plays", async () => {
    setLiveTiles(["a", "b", "c"]);
    await openAll(3);
    mockThroughput.get("t-c")!({ produceSeconds: 0.07, readSeconds: 0.07, segmentSeconds: 1 });
    await flush();
    expect(liveTileUrl("b")).not.toBeNull();
    expect(liveTileUrl("c")).not.toBeNull();
  });

  it("drops the satellite furthest from the main to its clip on a read-bound segment, one per spacing, until the set changes", async () => {
    setLiveTiles(["a", "b", "c", "d"]);
    await openAll(4);
    mockThroughput.get("t-a")!(bound);
    await flush();
    expect(liveTileUrl("d")).toBeNull();
    mockThroughput.get("t-a")!(bound);
    await flush();
    expect(liveTileUrl("c")).not.toBeNull();
    await advance(LIVE_TILE_DROP_SPACING_MS);
    mockThroughput.get("t-a")!(bound);
    await flush();
    expect(liveTileUrl("c")).toBeNull();
    expect(liveTileUrl("a")).not.toBeNull();
    await openAll(2);
    expect(liveTileUrl("d")).toBeNull();
  });

  it("tries a main that failed to open again after 5, 15 and 45 seconds, reports it failed meanwhile, and stops after the third", async () => {
    startFailure = (id) => (id === "a" ? new Error("Failed to open channel: 500") : null);
    setLiveTiles(["a", "b"]);
    await openAll(2);
    const opens = () => started.filter(([id]) => id === "a").length;
    expect(opens()).toBe(1);
    expect(liveTileFailed("a")).toBe(true);
    for (const [i, delay] of LIVE_TILE_MAIN_RETRY_MS.entries()) {
      await advance(delay);
      await openAll(1);
      expect(opens()).toBe(i + 2);
    }
    await advance(120_000);
    await openAll(2);
    expect(opens()).toBe(4);
    expect(liveTileFailed("a")).toBe(true);
  });

  it("brings a failed main back on a retry that opens, and clears its failed report", async () => {
    startFailure = (id) => (id === "a" ? new Error("Failed to open channel: 500") : null);
    setLiveTiles(["a", "b"]);
    await openAll(2);
    startFailure = null;
    await advance(LIVE_TILE_MAIN_RETRY_MS[0]);
    await openAll(1);
    expect(liveTileUrl("a")).not.toBeNull();
    expect(liveTileFailed("a")).toBe(false);
  });

  it("ends a tile whose player failed: a satellite drops to its clip, and the main stops being live until its first retry", async () => {
    setLiveTiles(["a", "b", "c"]);
    await openAll(3);
    noteLiveTileFailed("c");
    await openAll(1);
    expect(mockStopped).toContain("t-c");
    expect(liveTileUrl("c")).toBeNull();
    noteLiveTileFailed("a");
    await openAll(2);
    expect(mockStopped).toContain("t-a");
    expect(liveTileUrl("a")).toBeNull();
    expect(started.filter(([id]) => id === "a" || id === "c")).toHaveLength(2);
    expect(liveTileUrl("b")).not.toBeNull();
  });

  it("drops every satellite on a memory warning and keeps the main", async () => {
    setLiveTiles(["a", "b", "c"]);
    await openAll(3);
    mockAppListeners.memoryWarning?.();
    await flush();
    expect(liveTileUrl("a")).not.toBeNull();
    expect(liveTileUrl("b")).toBeNull();
    expect(liveTileUrl("c")).toBeNull();
  });

  it("promotes a live satellite by swapping priorities, without reopening either", async () => {
    setLiveTiles(["a", "b"]);
    await openAll(2);
    const opens = started.length;
    mockPriorities.length = 0;
    setLiveTiles(["b", "a"]);
    await openAll(1);
    expect(started).toHaveLength(opens);
    expect(mockPriorities).toEqual(
      expect.arrayContaining([
        ["t-b", "playback"],
        ["t-a", "preview"],
      ]),
    );
  });

  it("hands the main's session to the player, which hands it back when it leaves", async () => {
    setLiveTiles(["a", "b"]);
    await openAll(2);
    const taken = takeLiveTile<Item>("a");
    expect(taken).toEqual({ channelId: "a", details: { Id: "a", origin: "many.example" }, url: "http://127.0.0.1/t-a/master.m3u8", token: "t-a", ready: true });
    expect(liveTileUrl("a")).toBeNull();
    expect(mockStopped).not.toContain("t-a");
    expect(retainLiveTile(taken!)).toBe(true);
    expect(liveTileUrl("a")).toBe("http://127.0.0.1/t-a/master.m3u8");
    expect(retainLiveTile({ channelId: "zz", details: {}, url: "u", token: "t" })).toBe(false);
  });

  it("stops the satellites when playback takes the link, keeps the main for the player's handoff, and ends it if the player never takes it", async () => {
    setLiveTiles(["a", "b"]);
    await openAll(2);
    setPlaybackHold("video", true);
    await flush();
    expect(mockStopped).toContain("t-b");
    expect(liveTileUrl("a")).not.toBeNull();
    await advance(LIVE_TILE_HANDOFF_GRACE_MS);
    expect(mockStopped).toContain("t-a");
  });

  describe("with the main in the player", () => {
    it("opens only the satellites, never the main", async () => {
      setLiveTiles(["a", "b", "c"], { mainInPlayer: true });
      await openAll(3);
      expect(started.map(([id]) => id)).toEqual(["b", "c"]);
      expect(liveTileUrl("a")).toBeNull();
    });

    it("keeps a main tile for the player to take, and ends it after the handoff grace if the player never does", async () => {
      setLiveTiles(["a", "b"]);
      await openAll(2);
      setLiveTiles(["a", "b"], { mainInPlayer: true });
      await flush();
      expect(liveTileUrl("a")).not.toBeNull();
      await advance(LIVE_TILE_HANDOFF_GRACE_MS);
      expect(mockStopped).toContain("t-a");
      expect(liveTileUrl("b")).not.toBeNull();
    });

    it("keeps the satellites live while Multiview's player holds the link, and stops them when other playback takes it", async () => {
      setLiveTiles(["a", "b", "c"], { mainInPlayer: true });
      setPlaybackHold(MULTIVIEW_PLAYBACK_OWNER, true);
      await openAll(3);
      expect(started.map(([id]) => id)).toEqual(["b", "c"]);
      setPlaybackHold("video", true);
      await flush();
      expect(mockStopped).toEqual(expect.arrayContaining(["t-b", "t-c"]));
      setPlaybackHold("video", false);
      await openAll(3);
      expect(liveTileUrl("b")).not.toBeNull();
      setPlaybackHold(MULTIVIEW_PLAYBACK_OWNER, false);
    });

    it("waits for the player to hand back the channel it played when the sound moves, never opening it a second time", async () => {
      setLiveTiles(["a", "b"], { mainInPlayer: true });
      await openAll(2);
      setLiveTiles(["b", "a"], { mainInPlayer: true });
      await openAll(2);
      expect(started.map(([id]) => id)).toEqual(["b"]);
      expect(retainLiveTile({ channelId: "a", details: { Id: "a" }, url: "http://127.0.0.1/t-player/master.m3u8", token: "t-player" })).toBe(true);
      expect(liveTileUrl("a")).toBe("http://127.0.0.1/t-player/master.m3u8");
      await openAll(2);
      expect(started.map(([id]) => id)).toEqual(["b"]);
    });

    it("opens the channel the player played as a tile once the handoff grace passes without it", async () => {
      setLiveTiles(["a", "b"], { mainInPlayer: true });
      await openAll(2);
      setLiveTiles(["b", "a"], { mainInPlayer: true });
      await openAll(1);
      expect(started.map(([id]) => id)).toEqual(["b"]);
      await advance(LIVE_TILE_HANDOFF_GRACE_MS);
      await openAll(1);
      expect(started.map(([id]) => id)).toEqual(["b", "a"]);
    });

    it("holds the sampler off a one-connection provider while the player plays the main there", async () => {
      mockLimits.set("one.example", 1);
      setLiveTiles(["pl-a", "pl-b"], { mainInPlayer: true });
      await openAll(2);
      expect(started).toEqual([]);
      expect(mockHolds).toEqual([["one.example", true]]);
      setLiveTiles([]);
      expect(mockHolds.at(-1)).toEqual(["one.example", false]);
    });
  });

  it("plays only the main on a one-connection provider, holding the sampler off that provider, and never stops it", async () => {
    mockLimits.set("one.example", 1);
    setLiveTiles(["one-a", "one-b", "one-c"]);
    await openAll(3);
    expect(started.map(([id]) => id)).toEqual(["one-a"]);
    expect(mockHolds).toEqual([["one.example", true]]);
    await advance(60_000);
    expect(liveTileUrl("one-a")).not.toBeNull();
    expect(mockStopped).toEqual([]);
  });

  it("lets the sampler back onto the provider and opens the satellites when its one-connection limit is lifted, and holds it again when it returns", async () => {
    mockLimits.set("one.example", 1);
    setLiveTiles(["one-a", "one-b", "one-c"]);
    await openAll(3);
    expect(started.map(([id]) => id)).toEqual(["one-a"]);
    mockLimits.delete("one.example");
    mockBudgetListeners.forEach((listener) => listener());
    await openAll(3);
    expect(mockHolds.at(-1)).toEqual(["one.example", false]);
    expect(started.map(([id]) => id)).toEqual(["one-a", "one-b", "one-c"]);
    expect(liveTileUrl("one-a")).not.toBeNull();
    mockLimits.set("one.example", 1);
    mockBudgetListeners.forEach((listener) => listener());
    await flush();
    expect(mockHolds.at(-1)).toEqual(["one.example", true]);
    expect(liveTileUrl("one-b")).toBeNull();
    expect(liveTileUrl("one-a")).not.toBeNull();
  });
});
