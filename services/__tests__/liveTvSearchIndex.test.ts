/** The server's programme index for Live TV search: built in the background page by page, never awaited, rebuilt by a guide refresh. */
import { fetchWithTimeout } from "../jellyfin/http";
import { invalidateLiveTvSearchIndex, liveTvSearchHorizon, liveTvSearchIndex, liveTvSearchIndexVersion, subscribeLiveTvSearchIndex } from "../jellyfin/liveTvSearchIndex";

jest.mock("../jellyfin/http", () => ({ fetchWithTimeout: jest.fn() }));
jest.mock("../jellyfin/session", () => ({ getAuthHeader: jest.fn(() => "auth") }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const CONFIG = { server: "http://jf", apiKey: "k", userId: "u", deviceId: "d" } as Parameters<typeof liveTvSearchIndex>[0];
const fetchMock = fetchWithTimeout as jest.Mock;
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const program = (id: string, overview: string) => ({
  Id: id,
  Name: "MLB Baseball",
  ChannelId: "tbs",
  EpisodeTitle: "Game 3",
  Overview: overview,
  StartDate: new Date(Date.now() + 3_600_000).toISOString(),
  EndDate: new Date(Date.now() + 4 * 3_600_000).toISOString(),
});
const page = (items: unknown[]) => ({ ok: true, json: async () => ({ Items: items }) });

describe("liveTvSearchIndex", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateLiveTvSearchIndex();
  });

  it("answers null at once, builds in the background, then answers the folded programmes and tells subscribers", async () => {
    fetchMock.mockResolvedValue(page([program("p1", "The New York Yankees visit the Rays."), { ...program("x", "no channel"), ChannelId: undefined }]));
    const listener = jest.fn();
    const off = subscribeLiveTvSearchIndex(listener);
    const before = liveTvSearchIndexVersion();
    expect(liveTvSearchIndex(CONFIG)).toBeNull();
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(liveTvSearchIndexVersion()).toBe(before + 1);
    expect(liveTvSearchIndex(CONFIG)).toEqual([expect.objectContaining({ id: "p1", channelId: "tbs", text: "mlb baseball game 3 the new york yankees visit the rays." })]);
    off();
  });

  it("asks only for today and tomorrow, descriptions without images, in pages until a short one", async () => {
    const full = Array.from({ length: 2000 }, (_, i) => program(`a${i}`, "x"));
    fetchMock.mockResolvedValueOnce(page(full)).mockResolvedValueOnce(page([program("b1", "y")]));
    liveTvSearchIndex(CONFIG);
    await settle();
    const urls = fetchMock.mock.calls.map(([url]) => new URL(url as string));
    expect(urls).toHaveLength(2);
    expect(urls[0].pathname).toBe("/LiveTv/Programs");
    expect(Object.fromEntries(urls[0].searchParams)).toMatchObject({ userId: "u", fields: "Overview", enableImages: "false", startIndex: "0", limit: "2000" });
    expect(urls[1].searchParams.get("startIndex")).toBe("2000");
    expect(Date.parse(urls[0].searchParams.get("maxStartDate")!)).toBe(liveTvSearchHorizon(Date.now()));
    expect(liveTvSearchIndex(CONFIG)).toHaveLength(2001);
  });

  it("builds once per server and user however many searches ask, and a guide refresh rebuilds", async () => {
    fetchMock.mockResolvedValue(page([program("p1", "x")]));
    liveTvSearchIndex(CONFIG);
    liveTvSearchIndex(CONFIG);
    await settle();
    liveTvSearchIndex(CONFIG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(liveTvSearchIndex({ ...CONFIG, userId: "other" })).toBeNull();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    invalidateLiveTvSearchIndex();
    expect(liveTvSearchIndex(CONFIG)).toBeNull();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("backs off after a refused read instead of asking on every keystroke", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    liveTvSearchIndex(CONFIG);
    await settle();
    liveTvSearchIndex(CONFIG);
    liveTvSearchIndex(CONFIG);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reaches the local midnight that ends tomorrow", () => {
    const now = new Date(2026, 9, 4, 20, 15).getTime();
    expect(liveTvSearchHorizon(now)).toBe(new Date(2026, 9, 6).getTime());
  });
});
