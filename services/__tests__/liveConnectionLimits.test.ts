/** liveConnectionLimits: a playlist's limit reaches the engine for each host it reads, at startup, on every change, and after a tuner sync. */
import { applyConnectionLimits, limitChanges, originBudgets, watchConnectionLimits } from "@/services/liveConnectionLimits";
import { createGroup, getLiveTvPreferences, setConnectionLimit, toggleLocalFavoriteChannel, updateLiveTvPreferences } from "@/services/liveTvPreferences";
import { setOriginConnectionBudget } from "@keiver/tomo-engine";
import { subscribePlaylistChannels } from "@keiver/tomo-live";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/jellyfin/session", () => ({ getCachedConfig: jest.fn(() => ({ server: "", apiKey: "", userId: "", deviceId: "" })) }));
jest.mock("@keiver/tomo-engine", () => ({ setOriginConnectionBudget: jest.fn(async () => true) }));
jest.mock("@keiver/tomo-live", () => {
  const listeners = new Set<() => void>();
  return {
    subscribePlaylistChannels: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    playlistRebuilt: () => listeners.forEach((listener) => listener()),
    playlistOrigins: () => [
      { originKey: "a.example", channels: 3, sources: ["http://one/list.m3u"] },
      { originKey: "b.example", channels: 1, sources: ["http://one/list.m3u", "http://two/list.m3u"] },
      { originKey: "c.example", channels: 2, sources: ["http://three/list.m3u"] },
    ],
  };
});

const budget = setOriginConnectionBudget as jest.Mock;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const ONE = "http://one/list.m3u";
const TWO = "http://two/list.m3u";

describe("originBudgets", () => {
  const origins = (jest.requireMock("@keiver/tomo-live") as { playlistOrigins: () => never[] }).playlistOrigins();

  it("gives each host the lowest limit among the playlists reading it and skips hosts no limited playlist reads", () => {
    expect(originBudgets({ [ONE]: 2, [TWO]: 1 }, origins)).toEqual({ "a.example": 2, "b.example": 1 });
    expect(originBudgets({}, origins)).toEqual({});
  });
});

describe("limitChanges", () => {
  it("tells the engine every budget in the next set and forgets a host no longer in it", () => {
    expect(limitChanges({}, { "a.example": 1 })).toEqual({ "a.example": 1 });
    expect(limitChanges({ "a.example": 1, "b.example": 2 }, { "a.example": 3 })).toEqual({ "a.example": 3, "b.example": 0 });
    expect(limitChanges({}, {})).toEqual({});
  });
});

describe("applying the limits", () => {
  beforeEach(() => budget.mockClear());

  it("hands a playlist's limit to each of its hosts, and a playlist set back to Auto is forgotten there", async () => {
    setConnectionLimit(ONE, 1);
    await applyConnectionLimits();
    expect(budget).toHaveBeenCalledWith("a.example", 1);
    expect(budget).toHaveBeenCalledWith("b.example", 1);
    expect(budget).not.toHaveBeenCalledWith("c.example", expect.anything());
    budget.mockClear();
    setConnectionLimit(ONE, 0);
    await applyConnectionLimits();
    expect(budget).toHaveBeenCalledWith("a.example", 0);
    expect(budget).toHaveBeenCalledWith("b.example", 0);
  });

  it("applies at once, on a preference change and when the channel table is rebuilt", async () => {
    setConnectionLimit(TWO, 2);
    const stop = watchConnectionLimits();
    await flush();
    expect(budget).toHaveBeenCalledWith("b.example", 2);
    budget.mockClear();
    setConnectionLimit(TWO, 4);
    await flush();
    expect(budget).toHaveBeenCalledWith("b.example", 4);
    budget.mockClear();
    (jest.requireMock("@keiver/tomo-live") as { playlistRebuilt: () => void }).playlistRebuilt();
    await flush();
    expect(budget).toHaveBeenCalledWith("b.example", 4);
    stop();
    expect(subscribePlaylistChannels).toHaveBeenCalled();
    setConnectionLimit(TWO, 0);
  });

  it.each([
    ["favorites", () => toggleLocalFavoriteChannel({ Id: "channel-1", Name: "News", ChannelNumber: "1" })],
    ["filter", () => updateLiveTvPreferences({ filter: "favorites" })],
    ["groups", () => createGroup("News")],
  ] as const)("does not reapply manual budgets when %s change", async (_name, change) => {
    const previous = getLiveTvPreferences();
    setConnectionLimit(ONE, 5);
    const stop = watchConnectionLimits();
    try {
      await flush();
      expect(budget).toHaveBeenCalledWith("a.example", 5);
      budget.mockClear();
      change();
      await flush();
      expect(budget).not.toHaveBeenCalled();
    } finally {
      stop();
      updateLiveTvPreferences(previous);
    }
  });

  it("reapplies an explicitly selected limit and clears it when Auto is selected", async () => {
    const previous = getLiveTvPreferences();
    setConnectionLimit(ONE, 5);
    const stop = watchConnectionLimits();
    try {
      await flush();
      budget.mockClear();
      setConnectionLimit(ONE, 5);
      await flush();
      expect(budget).toHaveBeenCalledWith("a.example", 5);
      expect(budget).toHaveBeenCalledWith("b.example", 5);
      budget.mockClear();
      setConnectionLimit(ONE, 0);
      await flush();
      expect(budget).toHaveBeenCalledWith("a.example", 0);
      expect(budget).toHaveBeenCalledWith("b.example", 0);
    } finally {
      stop();
      updateLiveTvPreferences(previous);
    }
  });
});
