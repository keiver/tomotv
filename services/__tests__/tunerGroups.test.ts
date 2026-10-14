/** Tuner groups through the native module: the config read, which tuners qualify, merging, tvg-ids, and failure caching. */
import type { TunerRow } from "../liveSources";
import { allPlaylistChannelIds, playlistChannelById, syncPlaylistSources } from "@keiver/tomo-live";
import { fetchTunerData, fetchTunerGroups, guideChannelRequests, lastKnownTunerData, resetTunerCache, tunerDataSettled } from "../jellyfin/tunerGroups";
import { clearRequestCache } from "../requestCache";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const mockRowsByRequest = new Map<string, TunerRow[]>();

jest.mock("@/services/liveSources", () => ({
  isTunerGroupsAvailable: jest.fn(() => true),
  loadTunerPlaylist: jest.fn(),
  tunerPlaylistRows: jest.fn(async (requestId: string) => mockRowsByRequest.get(requestId) ?? []),
  releaseTunerPlaylist: jest.fn(async () => {}),
  cancelTunerGroups: jest.fn(),
}));
const mockLiveSources = jest.requireMock("@/services/liveSources") as {
  isTunerGroupsAvailable: jest.Mock;
  loadTunerPlaylist: jest.Mock;
  tunerPlaylistRows: jest.Mock;
  releaseTunerPlaylist: jest.Mock;
  cancelTunerGroups: jest.Mock;
};

// The disk cache serves the URL back: the loader's fetch expectations stay about URLs.
jest.mock("@/services/guideFileCache", () => ({
  cachedPlaylistFile: jest.fn(async (url: string) => url),
  onPlaylistFileRefreshed: jest.fn(() => () => {}),
}));
const mockFileCache = jest.requireMock("@/services/guideFileCache") as { cachedPlaylistFile: jest.Mock; onPlaylistFileRefreshed: jest.Mock };
/** The module's refreshed listener, taken before any clearAllMocks drops the registration call. */
const playlistRefreshed = mockFileCache.onPlaylistFileRefreshed.mock.calls[0][0] as (url: string) => void;

jest.mock("../jellyfin/session", () => ({
  getConfig: jest.fn(async () => ({ server: "http://s", apiKey: "k", userId: "u", deviceId: "d" })),
  getAuthHeader: jest.fn(() => "auth"),
  throwRequestError: jest.fn((_response: unknown, message: string) => {
    throw new Error(message);
  }),
}));

/** One playlist entry row, as the native module pages them out. */
const row = (id: string, over: Partial<TunerRow> = {}): TunerRow => ({
  id,
  name: `Channel ${id}`,
  number: null,
  logo: null,
  url: `http://h/${id}.ts`,
  headers: {},
  groups: [],
  tvgId: null,
  tvgName: null,
  radio: false,
  drm: false,
  ...over,
});

/** Queues one tuner's answer: its rows (paged out by requestId) and declared guide URLs, or a failure. */
function queueTuner(result: { rows?: TunerRow[]; tvgUrls?: string[] } | Error): void {
  mockLiveSources.loadTunerPlaylist.mockImplementationOnce(async (requestId: string) => {
    if (result instanceof Error) throw result;
    const rows = result.rows ?? [];
    mockRowsByRequest.set(requestId, rows);
    return { groups: [], channels: [], tvgUrls: result.tvgUrls ?? [], entryCount: rows.length };
  });
}

describe("fetchTunerGroups", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRequestCache();
    resetTunerCache();
    mockRowsByRequest.clear();
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
    queueTuner({ rows: [row("a", { groups: ["News"], tvgId: "A.us" }), row("b", { groups: ["News"] })], tvgUrls: ["http://g/a.xml", "ftp://nope", "http://g/a.xml"] });
    queueTuner({ rows: [row("b", { groups: ["News"] }), row("c", { groups: ["News"] }), row("d", { groups: ["Kids"], tvgId: "D.us@SD" })], tvgUrls: ["https://g/b.xml.gz", "http://g/a.xml"] });
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
    expect(mockLiveSources.loadTunerPlaylist).toHaveBeenCalledWith(expect.any(String), "http://t/one.m3u", "UA/1", "http://t/one.m3u");
    expect(mockLiveSources.loadTunerPlaylist).toHaveBeenCalledWith(expect.any(String), "https://t/two.m3u", undefined, "https://t/two.m3u");
    // Both download through the disk cache, which holds them back during playback; the User-Agent rides the download.
    expect(mockFileCache.cachedPlaylistFile).toHaveBeenCalledWith("http://t/one.m3u", undefined, { headers: { "User-Agent": "UA/1" } });
    expect(mockFileCache.cachedPlaylistFile).toHaveBeenCalledWith("https://t/two.m3u", undefined, undefined);
    // The second call is served from the cache.
    await fetchTunerGroups();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("reads the tuners again once a playlist download owed during playback lands", async () => {
    global.fetch = jest.fn().mockResolvedValue(configResponse([{ Type: "m3u", Url: "http://t/one.m3u" }]));
    queueTuner({ rows: [row("a")] });
    await fetchTunerData();
    playlistRefreshed("http://t/one.m3u");
    queueTuner({ rows: [row("a"), row("b")] });
    await fetchTunerData();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(allPlaylistChannelIds()).toEqual(["a", "b"]);
  });

  it("reads a tuner the server reaches on its own loopback at the server's host, hashing ids with the stored URL", async () => {
    const session = jest.requireMock("../jellyfin/session") as { getConfig: jest.Mock };
    session.getConfig.mockResolvedValueOnce({ server: "http://192.168.1.5:8096", apiKey: "k", userId: "u", deviceId: "d" });
    global.fetch = jest.fn().mockResolvedValue(
      configResponse([
        { Type: "m3u", Url: "http://127.0.0.1:9109/a.m3u" },
        { Type: "m3u", Url: "http://localhost/b.m3u" },
        { Type: "m3u", Url: "https://[::1]:8443/c.m3u" },
        { Type: "m3u", Url: "http://localhost.example.com/d.m3u" },
      ]),
    );
    for (let i = 0; i < 4; i++) queueTuner({});
    const data = await fetchTunerData();
    expect(mockLiveSources.loadTunerPlaylist.mock.calls.map(([, url, , fetchUrl]) => [url, fetchUrl])).toEqual([
      ["http://127.0.0.1:9109/a.m3u", "http://192.168.1.5:9109/a.m3u"],
      ["http://localhost/b.m3u", "http://192.168.1.5/b.m3u"],
      ["https://[::1]:8443/c.m3u", "https://192.168.1.5:8443/c.m3u"],
      ["http://localhost.example.com/d.m3u", "http://localhost.example.com/d.m3u"],
    ]);
    expect(data.tunerUrls).toEqual(["http://127.0.0.1:9109/a.m3u", "http://localhost/b.m3u", "https://[::1]:8443/c.m3u", "http://localhost.example.com/d.m3u"]);
  });

  it("lists the server's http(s) XMLTV listing providers as guide URLs, loopback rewritten", async () => {
    const session = jest.requireMock("../jellyfin/session") as { getConfig: jest.Mock };
    session.getConfig.mockResolvedValueOnce({ server: "http://192.168.1.5:8096", apiKey: "k", userId: "u", deviceId: "d" });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        TunerHosts: [{ Type: "m3u", Url: "http://t/one.m3u" }],
        ListingProviders: [
          { Type: "xmltv", Path: "http://127.0.0.1:8000/guide.xml.gz" },
          { Type: "xmltv", Path: "/var/lib/local-guide.xml" },
          { Type: "schedulesdirect", Path: "http://sd/guide" },
        ],
      }),
    });
    queueTuner({ tvgUrls: ["http://g/a.xml"] });
    const data = await fetchTunerData();
    // Playlist-declared guides first, then the server's own providers.
    expect(data.tvgUrls).toEqual(["http://g/a.xml", "http://192.168.1.5:8000/guide.xml.gz"]);
  });

  it("builds the guide-match request list once per (table, lineup) pair and forgets it on reset", async () => {
    const data = { tvgById: { a: "A.us" }, tvgNameById: { b: "B Name" } };
    const lineup = [
      { Id: "a", Name: "Alpha" },
      { Id: "c", Name: "Gamma" },
    ];
    const first = guideChannelRequests(data, lineup);
    expect(first.requests).toEqual([
      { channelId: "a", tvgId: "A.us", tvgName: undefined, name: "Alpha" },
      { channelId: "b", tvgId: undefined, tvgName: "B Name", name: "B Name" },
      { channelId: "c", tvgId: undefined, tvgName: undefined, name: "Gamma" },
    ]);
    expect(first.names).toEqual({ a: "Alpha", c: "Gamma" });
    // Same pair: the same array object back, so downstream identity-keyed memos hold.
    expect(guideChannelRequests(data, lineup).requests).toBe(first.requests);
    // A new lineup object rebuilds; a reset forgets the pair entirely.
    expect(guideChannelRequests(data, [...lineup]).requests).not.toBe(first.requests);
    const again = guideChannelRequests(data, lineup);
    resetTunerCache();
    expect(guideChannelRequests(data, lineup).requests).not.toBe(again.requests);
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
    queueTuner(new Error("403"));
    queueTuner({ rows: [row("a", { groups: ["News"] })] });
    await expect(fetchTunerData()).resolves.toMatchObject({ groups: [{ name: "News", channelIds: ["a"] }], complete: false });
  });

  it("merges a partial read with the last good one, and retries it after the failure window", async () => {
    jest.useFakeTimers();
    const tuners = configResponse([
      { Type: "m3u", Url: "http://t/busy.m3u" },
      { Type: "m3u", Url: "http://t/other.m3u" },
    ]);
    global.fetch = jest.fn().mockResolvedValue(tuners);
    queueTuner({ rows: [row("s", { groups: ["Sports"], tvgId: "S.uk" })], tvgUrls: ["http://g/busy.xml"] });
    queueTuner({ rows: [row("a", { groups: ["News"] })] });
    await fetchTunerData();
    clearRequestCache();
    // The busy tuner refuses while it streams; its group and tvg-ids survive from the last good read.
    queueTuner(new Error("refused"));
    queueTuner({ rows: [row("a", { groups: ["News"] }), row("b", { groups: ["News"] })] });
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
    queueTuner({ rows: [row("s", { groups: ["Sports"] })] });
    queueTuner({ rows: [row("a", { groups: ["News"] })] });
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
    queueTuner({ rows: [row("s", { groups: ["Sports"] })] });
    queueTuner({ rows: [row("k", { groups: ["Kids"] }), row("a", { groups: ["News"] }), row("x", { groups: ["News"] })] });
    await fetchTunerData();
    clearRequestCache();
    jest.setSystemTime(Date.now() + 6 * 60 * 1000);
    // The other tuner dropped Kids and channel x; the busy one refuses and stands in with its own last playlist.
    queueTuner(new Error("refused"));
    queueTuner({ rows: [row("a", { groups: ["News"] })] });
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
    while (mockLiveSources.loadTunerPlaylist.mock.calls.length === 0) await Promise.resolve();
    resetTunerCache();
    clearRequestCache();
    release({ groups: [], channels: [], tvgUrls: [], entryCount: 0 });
    await pending;
    expect(lastKnownTunerData()).toBeNull();
  });

  it("keeps the last sign-in's tuners out of the table when the reset lands during its config read", async () => {
    let answer: (value: unknown) => void = () => {};
    global.fetch = jest.fn(() => new Promise((resolve) => (answer = resolve))) as unknown as typeof fetch;
    const pending = fetchTunerData();
    while ((global.fetch as jest.Mock).mock.calls.length === 0) await Promise.resolve();
    resetTunerCache();
    clearRequestCache();
    // The next sign-in's playlist is tabled before the old read's config answers.
    await syncPlaylistSources([
      { key: "http://b/list.m3u", url: "http://b/list.m3u", loadRows: async () => ({ rows: [{ ...row("b1"), logoUrl: null, streamUrl: "http://b/1.ts", originKey: "b" }], tvgUrls: [] }) },
    ]);
    answer(configResponse([{ Type: "m3u", Url: "http://a/list.m3u" }]));
    await pending;
    expect(mockLiveSources.loadTunerPlaylist).not.toHaveBeenCalled();
    expect(allPlaylistChannelIds()).toEqual(["b1"]);
  });

  it("puts the tuner's User-Agent on every stream that names none of its own", async () => {
    global.fetch = jest.fn().mockResolvedValue(configResponse([{ Type: "m3u", Url: "http://t/one.m3u", UserAgent: "UA/1" }]));
    queueTuner({ rows: [row("a"), row("b", { headers: { "User-Agent": "own", referer: "http://r" } })] });
    await fetchTunerData();
    expect(playlistChannelById("a")?.headers).toEqual({ "user-agent": "UA/1" });
    expect(playlistChannelById("b")?.headers).toEqual({ "User-Agent": "own", referer: "http://r" });
  });

  it("is settled once a read finishes, a failed one included, and not again after a reset", async () => {
    expect(tunerDataSettled()).toBe(false);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(fetchTunerData()).rejects.toThrow("500");
    expect(tunerDataSettled()).toBe(true);
    resetTunerCache();
    expect(tunerDataSettled()).toBe(false);
  });

  it("rejects a second read that shares the first one's failing playlist load instead of resolving empty", async () => {
    global.fetch = jest.fn().mockResolvedValue(configResponse([{ Type: "m3u", Url: "http://t/one.m3u" }]));
    let refuse: (error: Error) => void = () => {};
    mockLiveSources.loadTunerPlaylist.mockReturnValueOnce(new Promise((_resolve, reject) => (refuse = reject)));
    const first = fetchTunerData();
    while (mockLiveSources.loadTunerPlaylist.mock.calls.length === 0) await Promise.resolve();
    // An invalidation mid-read starts a second read; the playlist load already running answers for both.
    clearRequestCache();
    const second = fetchTunerData();
    const outcomes = Promise.allSettled([first, second]);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    refuse(new Error("connection refused"));
    expect((await outcomes).map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);
    expect(mockLiveSources.loadTunerPlaylist).toHaveBeenCalledTimes(1);
    expect(lastKnownTunerData()).toBeNull();
  });

  it("treats a read where every tuner failed as a failure, serving the last good groups", async () => {
    global.fetch = jest.fn().mockResolvedValue(configResponse([{ Type: "m3u", Url: "http://t/one.m3u" }]));
    queueTuner({ rows: [row("a", { groups: ["News"] })] });
    await fetchTunerGroups();
    clearRequestCache();
    // The tuner is busy serving a stream: the playlist read is refused.
    queueTuner(new Error("connection refused"));
    await expect(fetchTunerGroups()).resolves.toEqual([{ name: "News", channelIds: ["a"] }]);
    expect(lastKnownTunerData()?.groups).toEqual([{ name: "News", channelIds: ["a"] }]);
  });

  it("rejects an all-tuners-failed read with no last good data instead of resolving empty", async () => {
    global.fetch = jest.fn().mockResolvedValue(configResponse([{ Type: "m3u", Url: "http://t/one.m3u" }]));
    queueTuner(new Error("connection refused"));
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
    queueTuner({ rows: [row("a", { groups: ["News"] })] });
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
    queueTuner({ tvgUrls: ["http://g/one.xml"] });
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
    queueTuner({ tvgUrls: ["http://g/one.xml"] });
    queueTuner({ tvgUrls: ["http://g/new.xml"] });
    const data = await fetchTunerData({ revalidate: true });
    expect(data.tunerUrls).toEqual(["http://t/one.m3u", "http://t/new.m3u"]);
    expect(data.tvgUrls).toEqual(["http://g/one.xml", "http://g/new.xml"]);
    expect(data.tvgUrlSources["http://g/new.xml"]).toEqual(["http://t/new.m3u"]);
  });
});
