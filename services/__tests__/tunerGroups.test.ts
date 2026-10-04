/** Tuner groups through the native module: the config read, which tuners qualify, merging, tvg-ids, and failure caching. */
import { fetchTunerData, fetchTunerGroups, lastKnownTunerData, resetTunerCache } from "../jellyfin/tunerGroups";
import { clearRequestCache } from "../requestCache";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

jest.mock("@/services/liveSources", () => ({
  isTunerGroupsAvailable: jest.fn(() => true),
  loadTunerPlaylist: jest.fn(),
  cancelTunerGroups: jest.fn(),
}));
const mockLiveSources = jest.requireMock("@/services/liveSources") as {
  isTunerGroupsAvailable: jest.Mock;
  loadTunerPlaylist: jest.Mock;
  cancelTunerGroups: jest.Mock;
};

jest.mock("../jellyfin/session", () => ({
  getConfig: jest.fn(async () => ({ server: "http://s", apiKey: "k", userId: "u", deviceId: "d" })),
  getAuthHeader: jest.fn(() => "auth"),
  throwRequestError: jest.fn((_response: unknown, message: string) => {
    throw new Error(message);
  }),
}));

describe("fetchTunerGroups", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRequestCache();
    resetTunerCache();
    jest.useRealTimers();
  });

  const configResponse = (tuners: unknown[]) => ({ ok: true, json: async () => ({ TunerHosts: tuners }) });

  it("streams each http(s) M3U tuner with its UserAgent and merges same-named groups", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      configResponse([
        { Type: "m3u", Url: "http://t/one.m3u", UserAgent: "UA/1" },
        { Type: "M3U", Url: "https://t/two.m3u" },
        { Type: "m3u", Url: "/var/lib/local.m3u" },
        { Type: "hdhomerun", Url: "http://t/hdhr" },
      ]),
    );
    mockLiveSources.loadTunerPlaylist
      .mockResolvedValueOnce({ groups: [{ name: "News", channelIds: ["a", "b"] }], channels: [{ id: "a", tvgId: "A.us" }], tvgUrls: ["http://g/a.xml", "ftp://nope", "http://g/a.xml"] })
      .mockResolvedValueOnce({
        groups: [
          { name: "News", channelIds: ["b", "c"] },
          { name: "Kids", channelIds: ["d"] },
        ],
        channels: [{ id: "d", tvgId: "D.us@SD" }],
        tvgUrls: ["https://g/b.xml.gz", "http://g/a.xml"],
      });
    await expect(fetchTunerData()).resolves.toEqual({
      groups: [
        { name: "News", channelIds: ["a", "b", "c"] },
        { name: "Kids", channelIds: ["d"] },
      ],
      tvgById: { a: "A.us", d: "D.us@SD" },
      tvgNameById: {},
      // Declared guide URLs merge in order, http(s) only, deduped.
      tvgUrls: ["http://g/a.xml", "https://g/b.xml.gz"],
      // Each guide names every playlist that declares it, once.
      tvgUrlSources: { "http://g/a.xml": ["http://t/one.m3u", "https://t/two.m3u"], "https://g/b.xml.gz": ["https://t/two.m3u"] },
      tunerUrls: ["http://t/one.m3u", "https://t/two.m3u"],
      complete: true,
    });
    expect(mockLiveSources.loadTunerPlaylist).toHaveBeenCalledTimes(2);
    expect(mockLiveSources.loadTunerPlaylist).toHaveBeenCalledWith(expect.any(String), "http://t/one.m3u", "UA/1");
    expect(mockLiveSources.loadTunerPlaylist).toHaveBeenCalledWith(expect.any(String), "https://t/two.m3u", undefined);
    // The second call is served from the cache.
    await fetchTunerGroups();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns no groups without the native module and never reads the config", async () => {
    mockLiveSources.isTunerGroupsAvailable.mockReturnValueOnce(false);
    global.fetch = jest.fn();
    await expect(fetchTunerGroups()).resolves.toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps the other tuners when one playlist fails, marking the read partial", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      configResponse([
        { Type: "m3u", Url: "http://t/bad.m3u" },
        { Type: "m3u", Url: "http://t/good.m3u" },
      ]),
    );
    mockLiveSources.loadTunerPlaylist.mockRejectedValueOnce(new Error("403")).mockResolvedValueOnce({ groups: [{ name: "News", channelIds: ["a"] }], channels: [], tvgUrls: [] });
    await expect(fetchTunerData()).resolves.toMatchObject({ groups: [{ name: "News", channelIds: ["a"] }], complete: false });
  });

  it("merges a partial read with the last good one, and retries it after the failure window", async () => {
    jest.useFakeTimers();
    const tuners = configResponse([
      { Type: "m3u", Url: "http://t/busy.m3u" },
      { Type: "m3u", Url: "http://t/other.m3u" },
    ]);
    global.fetch = jest.fn().mockResolvedValue(tuners);
    mockLiveSources.loadTunerPlaylist
      .mockResolvedValueOnce({ groups: [{ name: "Sports", channelIds: ["s"] }], channels: [{ id: "s", tvgId: "S.uk" }], tvgUrls: ["http://g/busy.xml"] })
      .mockResolvedValueOnce({ groups: [{ name: "News", channelIds: ["a"] }], channels: [], tvgUrls: [] });
    await fetchTunerData();
    clearRequestCache();
    // The busy tuner refuses while it streams; its group and tvg-ids survive from the last good read.
    mockLiveSources.loadTunerPlaylist.mockRejectedValueOnce(new Error("refused")).mockResolvedValueOnce({ groups: [{ name: "News", channelIds: ["a", "b"] }], channels: [], tvgUrls: [] });
    const partial = await fetchTunerData();
    expect(partial).toEqual({
      groups: [
        { name: "Sports", channelIds: ["s"] },
        { name: "News", channelIds: ["a", "b"] },
      ],
      tvgById: { s: "S.uk" },
      tvgNameById: {},
      tvgUrls: ["http://g/busy.xml"],
      tvgUrlSources: { "http://g/busy.xml": ["http://t/busy.m3u"] },
      tunerUrls: ["http://t/busy.m3u", "http://t/other.m3u"],
      complete: false,
    });
    expect(lastKnownTunerData()).toEqual(partial);
    // Within the failure window the partial read is served without re-streaming.
    await fetchTunerData();
    expect(mockLiveSources.loadTunerPlaylist).toHaveBeenCalledTimes(4);
    jest.setSystemTime(Date.now() + 6 * 60 * 1000);
    mockLiveSources.loadTunerPlaylist
      .mockResolvedValueOnce({ groups: [{ name: "Sports", channelIds: ["s"] }], channels: [], tvgUrls: [] })
      .mockResolvedValueOnce({ groups: [{ name: "News", channelIds: ["a"] }], channels: [], tvgUrls: [] });
    await expect(fetchTunerData()).resolves.toMatchObject({ complete: true });
  });

  it("lets a tuner that answered drop a group while another refuses", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue(
      configResponse([
        { Type: "m3u", Url: "http://t/busy.m3u" },
        { Type: "m3u", Url: "http://t/other.m3u" },
      ]),
    );
    mockLiveSources.loadTunerPlaylist.mockResolvedValueOnce({ groups: [{ name: "Sports", channelIds: ["s"] }], channels: [], tvgUrls: [] }).mockResolvedValueOnce({
      groups: [
        { name: "Kids", channelIds: ["k"] },
        { name: "News", channelIds: ["a", "x"] },
      ],
      channels: [],
      tvgUrls: [],
    });
    await fetchTunerData();
    clearRequestCache();
    jest.setSystemTime(Date.now() + 6 * 60 * 1000);
    // The other tuner dropped Kids and channel x; the busy one refuses and stands in with its own last playlist.
    mockLiveSources.loadTunerPlaylist.mockRejectedValueOnce(new Error("refused")).mockResolvedValueOnce({ groups: [{ name: "News", channelIds: ["a"] }], channels: [], tvgUrls: [] });
    await expect(fetchTunerData()).resolves.toMatchObject({
      groups: [
        { name: "Sports", channelIds: ["s"] },
        { name: "News", channelIds: ["a"] },
      ],
      complete: false,
    });
  });

  it("drops a read that outlived a reset instead of writing the old server's groups", async () => {
    global.fetch = jest.fn().mockResolvedValue(configResponse([{ Type: "m3u", Url: "http://t/one.m3u" }]));
    let release: (value: unknown) => void = () => {};
    mockLiveSources.loadTunerPlaylist.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const pending = fetchTunerData();
    await Promise.resolve();
    await Promise.resolve();
    resetTunerCache();
    clearRequestCache();
    release({ groups: [{ name: "Old", channelIds: ["o"] }], channels: [], tvgUrls: [] });
    await pending;
    expect(lastKnownTunerData()).toBeNull();
  });

  it("treats a read where every tuner failed as a failure, serving the last good groups", async () => {
    global.fetch = jest.fn().mockResolvedValue(configResponse([{ Type: "m3u", Url: "http://t/one.m3u" }]));
    mockLiveSources.loadTunerPlaylist.mockResolvedValueOnce({ groups: [{ name: "News", channelIds: ["a"] }], channels: [], tvgUrls: [] });
    await fetchTunerGroups();
    clearRequestCache();
    // The tuner is busy serving a stream: the playlist read is refused.
    mockLiveSources.loadTunerPlaylist.mockRejectedValueOnce(new Error("connection refused"));
    await expect(fetchTunerGroups()).resolves.toEqual([{ name: "News", channelIds: ["a"] }]);
    expect(lastKnownTunerData()?.groups).toEqual([{ name: "News", channelIds: ["a"] }]);
  });

  it("rejects an all-tuners-failed read with no last good data instead of resolving empty", async () => {
    global.fetch = jest.fn().mockResolvedValue(configResponse([{ Type: "m3u", Url: "http://t/one.m3u" }]));
    mockLiveSources.loadTunerPlaylist.mockRejectedValueOnce(new Error("connection refused"));
    await expect(fetchTunerGroups()).rejects.toThrow("connection refused");
    expect(lastKnownTunerData()).toBeNull();
  });

  it("caches a failed config read instead of re-streaming on every mount", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(fetchTunerGroups()).rejects.toThrow("500");
    await expect(fetchTunerGroups()).resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // The failure window passes and the next read tries again.
    jest.setSystemTime(Date.now() + 6 * 60 * 1000);
    global.fetch = jest.fn().mockResolvedValue(configResponse([]));
    await expect(fetchTunerGroups()).resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("serves the last good read when a refetch fails, until a reset", async () => {
    global.fetch = jest.fn().mockResolvedValue(configResponse([{ Type: "m3u", Url: "http://t/one.m3u" }]));
    mockLiveSources.loadTunerPlaylist.mockResolvedValueOnce({ groups: [{ name: "News", channelIds: ["a"] }], channels: [], tvgUrls: [] });
    await fetchTunerGroups();
    expect(lastKnownTunerData()?.groups).toEqual([{ name: "News", channelIds: ["a"] }]);
    clearRequestCache();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(fetchTunerGroups()).resolves.toEqual([{ name: "News", channelIds: ["a"] }]);
    resetTunerCache();
    expect(lastKnownTunerData()).toBeNull();
    clearRequestCache();
    await expect(fetchTunerGroups()).rejects.toThrow("500");
  });

  it("revalidating re-reads at once when the server gained a playlist, and keeps the cache when it did not", async () => {
    const one = configResponse([{ Type: "m3u", Url: "http://t/one.m3u" }]);
    global.fetch = jest.fn().mockResolvedValue(one);
    mockLiveSources.loadTunerPlaylist.mockResolvedValue({ groups: [], channels: [], tvgUrls: ["http://g/one.xml"] });
    await fetchTunerData();
    // Same tuner list: one config read, no re-stream.
    await fetchTunerData({ revalidate: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockLiveSources.loadTunerPlaylist).toHaveBeenCalledTimes(1);
    global.fetch = jest.fn().mockResolvedValue(
      configResponse([
        { Type: "m3u", Url: "http://t/one.m3u" },
        { Type: "m3u", Url: "http://t/new.m3u" },
      ]),
    );
    mockLiveSources.loadTunerPlaylist
      .mockResolvedValueOnce({ groups: [], channels: [], tvgUrls: ["http://g/one.xml"] })
      .mockResolvedValueOnce({ groups: [], channels: [], tvgUrls: ["http://g/new.xml"] });
    const data = await fetchTunerData({ revalidate: true });
    expect(data.tunerUrls).toEqual(["http://t/one.m3u", "http://t/new.m3u"]);
    expect(data.tvgUrls).toEqual(["http://g/one.xml", "http://g/new.xml"]);
    expect(data.tvgUrlSources["http://g/new.xml"]).toEqual(["http://t/new.m3u"]);
  });
});
