/**
 * Channel health: down only on proof (two conclusive strikes), a manifest body is up (HLS or
 * DASH), a thrown network read changes nothing, a burst redeems any verdict, a clear drops all.
 */
const mockResolveOrigin = jest.fn();

jest.mock("@/services/jellyfinApi", () => ({
  resolveChannelOrigin: (id: string) => mockResolveOrigin(id),
}));
jest.mock("@/utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: jest.fn() },
  // Expo's lazy fetch global reads Platform through expo-modules-core on first access.
  Platform: { OS: "ios", select: (spec: Record<string, unknown>) => spec.ios ?? spec.native ?? spec.default },
}));

import { clearChannelHealth, HEALTH_STRIKE_RETRY_MS, healthFor, noteChannelAlive, setHealthViewable, subscribeChannelHealth } from "../channelHealth";

const fetchMock = jest.fn();

function answers(body: string, status = 200) {
  fetchMock.mockResolvedValue({ ok: status < 400, status, text: async () => body });
}

async function settle(ms = 1): Promise<void> {
  await jest.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  mockResolveOrigin.mockReset();
  mockResolveOrigin.mockResolvedValue({ url: "http://origin/playlist.m3u8" });
  clearChannelHealth();
  setHealthViewable([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("channelHealth", () => {
  it("marks a channel up on an HLS playlist body", async () => {
    answers("#EXTM3U\n#EXT-X-VERSION:3\n");
    setHealthViewable(["a"]);
    await settle();
    expect(healthFor("a")).toBe("up");
  });

  it("marks a channel up on a DASH manifest body", async () => {
    answers('<?xml version="1.0"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">');
    setHealthViewable(["a"]);
    await settle();
    expect(healthFor("a")).toBe("up");
  });

  it("needs two conclusive strikes before a down verdict", async () => {
    answers("not found", 404);
    setHealthViewable(["a"]);
    await settle();
    expect(healthFor("a")).toBe("unknown");
    await settle(HEALTH_STRIKE_RETRY_MS + 1_000);
    expect(healthFor("a")).toBe("down");
  });

  it("keeps the verdict when the read throws", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));
    setHealthViewable(["a"]);
    await settle();
    expect(healthFor("a")).toBe("unknown");
  });

  it("never opens a server-carried channel", async () => {
    mockResolveOrigin.mockResolvedValue(null);
    setHealthViewable(["a"]);
    await settle();
    expect(healthFor("a")).toBe("unknown");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a burst redeems a down channel and notifies", async () => {
    answers("dead", 404);
    setHealthViewable(["a"]);
    await settle();
    await settle(HEALTH_STRIKE_RETRY_MS + 1_000);
    expect(healthFor("a")).toBe("down");
    const listener = jest.fn();
    subscribeChannelHealth("a", listener);
    noteChannelAlive("a");
    expect(healthFor("a")).toBe("up");
    expect(listener).toHaveBeenCalled();
  });

  it("a clear drops every verdict", async () => {
    answers("#EXTM3U\n");
    setHealthViewable(["a"]);
    await settle();
    expect(healthFor("a")).toBe("up");
    clearChannelHealth();
    expect(healthFor("a")).toBe("unknown");
  });
});
