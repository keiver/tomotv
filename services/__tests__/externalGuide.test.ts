/** External guides: asked in order, tvg-id then name, one native load per window, per-guide status and matches, failure backoff. */
import {
  activeGuideUrls,
  clearDownloadedGuides,
  fetchExternalPrograms,
  fetchExternalProgramWindow,
  forgetGuide,
  searchExternalPrograms,
  guideSourcesBusy,
  guideSourceStatuses,
  preloadGuide,
  refreshExternalGuide,
  resetExternalGuide,
  subscribeGuideSources,
} from "../externalGuide";
import { EXTERNAL_GUIDE_PREFIX } from "@/utils/guide";

jest.mock("@keiver/tomo-engine", () => ({
  ...jest.requireActual("@keiver/tomo-engine"),
  isLiveSourcesAvailable: jest.fn(() => true),
  loadGuide: jest.fn(),
  guideChannels: jest.fn(),
  guideProgrammes: jest.fn(),
  searchGuide: jest.fn(),
  closeGuide: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@keiver/tomo-live/src/guideFileCache", () => ({
  cachedGuideFile: jest.fn(async (url: string) => `file:///cache/${encodeURIComponent(url)}`),
  clearGuideFileCache: jest.fn(),
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const native = jest.requireMock("@keiver/tomo-engine") as {
  isLiveSourcesAvailable: jest.Mock;
  loadGuide: jest.Mock;
  guideChannels: jest.Mock;
  guideProgrammes: jest.Mock;
  searchGuide: jest.Mock;
  closeGuide: jest.Mock;
};
const cache = jest.requireMock("@keiver/tomo-live/src/guideFileCache") as { cachedGuideFile: jest.Mock; clearGuideFileCache: jest.Mock };

const URL = "http://g/guide.xml.gz";
const OTHER = "http://g/other.xml";
const FILE = `file:///cache/${encodeURIComponent(URL)}`;
const WINDOW = { from: 1_000_000, to: 2_000_000 };
const DAY = 24 * 60 * 60 * 1000;

const programme = (channel: string, start: number, title = "Show") => ({ channel, start, stop: start + 1000, title, subTitle: null, desc: null, categories: [], icon: null, rating: null });

describe("fetchExternalPrograms", () => {
  let tokens = 0;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    resetExternalGuide();
    tokens = 0;
    cache.cachedGuideFile.mockImplementation(async (url: string) => `file:///cache/${encodeURIComponent(url)}`);
    native.loadGuide.mockImplementation(async () => ({ token: `tok-${++tokens}`, stats: { channels: 12, programmes: 340 } }));
    native.guideChannels.mockResolvedValue([]);
    native.guideProgrammes.mockResolvedValue([]);
  });

  it("distinguishes an empty window from a failed source, and accepts a successful fallback", async () => {
    const channels = [{ channelId: "c1", tvgId: "A.us", name: "Alpha" }];
    native.guideChannels.mockResolvedValue([{ id: "A.us", displayNames: ["Alpha"], icon: null }]);
    expect(await fetchExternalProgramWindow([URL], channels, WINDOW)).toEqual({ programs: [], failedChannelIds: [] });
    refreshExternalGuide();
    cache.cachedGuideFile.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchExternalProgramWindow([URL], channels, WINDOW)).toEqual({ programs: [], failedChannelIds: ["c1"] });
    expect(await fetchExternalProgramWindow([URL, OTHER], channels, WINDOW)).toEqual({ programs: [], failedChannelIds: ["c1"] });
    native.guideProgrammes.mockResolvedValue([programme("A.us", WINDOW.from)]);
    const fallback = await fetchExternalProgramWindow([URL, OTHER], channels, WINDOW);
    expect(fallback.failedChannelIds).toEqual([]);
    expect(fallback.programs.map((program) => program.ChannelId)).toEqual(["c1"]);
  });

  it("marks only matched channels when an open guide's programme read fails", async () => {
    native.guideChannels.mockResolvedValue([{ id: "A.us", displayNames: ["Alpha"], icon: null }]);
    native.guideProgrammes.mockRejectedValueOnce(new Error("store closed"));
    const result = await fetchExternalProgramWindow(
      [URL],
      [
        { channelId: "c1", tvgId: "A.us", name: "Alpha" },
        { channelId: "c2", tvgId: "B.us", name: "Bravo" },
      ],
      WINDOW,
    );
    expect(result).toEqual({ programs: [], failedChannelIds: ["c1"] });
  });

  it("pairs by tvg-id, shaping programmes like the server's", async () => {
    native.guideChannels.mockResolvedValue([
      { id: "A.us@SD", displayNames: ["Alpha"], icon: null },
      { id: "A.us@HD", displayNames: ["Alpha HD"], icon: null },
      { id: "B.us@HD", displayNames: ["Bravo"], icon: null },
    ]);
    native.guideProgrammes.mockResolvedValue([
      { channel: "A.us@SD", start: 1_200_000, stop: 1_500_000, title: "Show", subTitle: "Ep", desc: "D", categories: ["News"], icon: null, rating: "TV-PG" },
      { channel: "A.us@HD", start: 1_200_000, stop: 1_500_000, title: "Show", subTitle: "Ep", desc: "D", categories: ["News"], icon: null, rating: "TV-PG" },
      { channel: "B.us@HD", start: 1_100_000, stop: null, title: "Other", subTitle: null, desc: null, categories: [], icon: null, rating: null },
    ]);
    const programs = await fetchExternalPrograms(
      [URL],
      [
        { channelId: "c1", tvgId: "A.us@SD", name: "Alpha SD" },
        { channelId: "c2", tvgId: "A.us@HD", name: "Alpha HD" },
        { channelId: "c3", tvgId: "B.us@HD", name: "Bravo" },
      ],
      WINDOW,
    );
    // The native parser reads the cached file, never the network URL, and this service owns its closing.
    expect(native.loadGuide).toHaveBeenCalledWith(FILE, { from: WINDOW.from, to: WINDOW.to + DAY }, "external", 0);
    expect(native.guideProgrammes).toHaveBeenCalledWith("tok-1", ["A.us@SD", "A.us@HD", "B.us@HD"], WINDOW);
    expect(programs.map((program) => [program.ChannelId, program.Name])).toEqual([
      ["c1", "Show"],
      ["c2", "Show"],
      ["c3", "Other"],
    ]);
    expect(programs[0]).toMatchObject({
      Id: `${EXTERNAL_GUIDE_PREFIX}c1:1200000`,
      StartDate: new Date(1_200_000).toISOString(),
      EndDate: new Date(1_500_000).toISOString(),
      Overview: "D",
      EpisodeTitle: "Ep",
      Genres: ["News"],
      OfficialRating: "TV-PG",
    });
    expect(programs[2].EndDate).toBeUndefined();
    expect(programs[2].OfficialRating).toBeUndefined();
  });

  it("falls back to the tvg-name, then the channel name, exactly and case aside", async () => {
    native.guideChannels.mockResolvedValue([
      { id: "464745", displayNames: ["ABC News Live"], icon: null },
      { id: "x1", displayNames: ["Local 7"], icon: null },
    ]);
    native.guideProgrammes.mockImplementation(async (_token: string, ids: string[]) => ids.map((id) => programme(id, 1_200_000)));
    const programs = await fetchExternalPrograms(
      [URL],
      [
        { channelId: "c1", tvgId: "ABCNewsLive.us@SD", tvgName: "abc news live", name: "ABC News Live (720p)" },
        { channelId: "c2", name: "LOCAL 7" },
        { channelId: "c3", name: "Local 7 HD" },
      ],
      WINDOW,
    );
    expect(programs.map((program) => program.ChannelId)).toEqual(["c1", "c2"]);
    expect(guideSourceStatuses()[URL].matched).toEqual([
      { channelId: "c1", name: "ABC News Live (720p)", via: "tvgName" },
      { channelId: "c2", name: "LOCAL 7", via: "name" },
    ]);
  });

  it("asks the next guide only for the channels the earlier ones left without programmes", async () => {
    native.guideChannels.mockImplementation(async (token: string) =>
      token === "tok-1"
        ? [
            { id: "A", displayNames: [], icon: null },
            { id: "B", displayNames: [], icon: null },
          ]
        : [
            { id: "B", displayNames: [], icon: null },
            { id: "C", displayNames: [], icon: null },
          ],
    );
    // The first guide names B but lists nothing for it in the window.
    native.guideProgrammes.mockImplementation(async (token: string, ids: string[]) => ids.filter((id) => token !== "tok-1" || id === "A").map((id) => programme(id, 1_200_000, `${token}:${id}`)));
    const channels = ["A", "B", "C"].map((id) => ({ channelId: id.toLowerCase(), tvgId: id, name: id }));
    const programs = await fetchExternalPrograms([URL, OTHER], channels, WINDOW);
    expect(programs.map((program) => program.Name)).toEqual(["tok-1:A", "tok-2:B", "tok-2:C"]);
    expect(native.guideProgrammes).toHaveBeenLastCalledWith("tok-2", ["B", "C"], WINDOW);
    expect(guideSourceStatuses()[OTHER].asked).toBe(2);
  });

  it("keeps asking the next guide when one fails, and backs off the failed one", async () => {
    jest.useFakeTimers();
    native.loadGuide.mockImplementation(async (file: string) => {
      if (file === FILE) throw new Error("404");
      return { token: `tok-${++tokens}`, stats: null };
    });
    native.guideChannels.mockResolvedValue([{ id: "A", displayNames: [], icon: null }]);
    native.guideProgrammes.mockResolvedValue([programme("A", 1_200_000)]);
    const channels = [{ channelId: "a", tvgId: "A", name: "A" }];
    await expect(fetchExternalPrograms([URL, OTHER], channels, WINDOW)).resolves.toHaveLength(1);
    expect(guideSourceStatuses()[URL].state).toBe("error");
    await fetchExternalPrograms([URL, OTHER], channels, WINDOW);
    expect(native.loadGuide.mock.calls.filter(([file]) => file === FILE)).toHaveLength(1);
    jest.setSystemTime(Date.now() + 6 * 60 * 1000);
    await fetchExternalPrograms([URL, OTHER], channels, WINDOW);
    expect(native.loadGuide.mock.calls.filter(([file]) => file === FILE)).toHaveLength(2);
  });

  it("loads once per window, reloads past it, and returns nothing without URLs, channels or the module", async () => {
    const channels = [{ channelId: "c1", tvgId: "A.us", name: "A" }];
    await fetchExternalPrograms([URL], channels, WINDOW);
    await fetchExternalPrograms([URL], channels, { from: WINDOW.from, to: WINDOW.to + DAY });
    expect(native.loadGuide).toHaveBeenCalledTimes(1);
    await fetchExternalPrograms([URL], channels, { from: WINDOW.from, to: WINDOW.to + 2 * DAY });
    expect(native.loadGuide).toHaveBeenCalledTimes(2);
    expect(native.closeGuide).toHaveBeenCalledWith("tok-1");
    await expect(fetchExternalPrograms([], channels, WINDOW)).resolves.toEqual([]);
    await expect(fetchExternalPrograms([URL], [], WINDOW)).resolves.toEqual([]);
    native.isLiveSourcesAvailable.mockReturnValueOnce(false);
    await expect(fetchExternalPrograms([URL], channels, WINDOW)).resolves.toEqual([]);
  });

  it("a window asked before the open guide's start reloads a day further back, so the next spans back reload nothing", async () => {
    const channels = [{ channelId: "c1", tvgId: "A.us", name: "A" }];
    const SPAN = 6 * 60 * 60 * 1000;
    const later = { from: WINDOW.from + 3 * DAY, to: WINDOW.from + 3 * DAY + SPAN };
    await fetchExternalPrograms([URL], channels, later);
    await fetchExternalPrograms([URL], channels, { from: later.from - SPAN, to: later.from });
    expect(native.loadGuide).toHaveBeenLastCalledWith(FILE, { from: later.from - SPAN - DAY, to: later.from + DAY }, "external", 0);
    await fetchExternalPrograms([URL], channels, { from: later.from - 2 * SPAN, to: later.from - SPAN });
    expect(native.loadGuide).toHaveBeenCalledTimes(2);
  });

  it("reports each guide's progress, reading, counts and pairings, and the HUD's busy flag", async () => {
    cache.cachedGuideFile.mockImplementation(async (_url: string, onProgress?: (p: { bytesWritten: number; totalBytes: number }) => void) => {
      onProgress?.({ bytesWritten: 5, totalBytes: 10 });
      return FILE;
    });
    native.guideChannels.mockResolvedValue([{ id: "A.us", displayNames: [], icon: null }]);
    const seen: { state: string; progress: number | null; busy: boolean }[] = [];
    const unsubscribe = subscribeGuideSources(() => {
      const status = guideSourceStatuses()[URL];
      if (status) seen.push({ state: status.state, progress: status.progress, busy: guideSourcesBusy() });
    });
    await fetchExternalPrograms([URL], [{ channelId: "c1", tvgId: "A.us", name: "A" }], WINDOW);
    unsubscribe();
    expect(seen.slice(0, 4)).toEqual([
      { state: "downloading", progress: null, busy: true },
      { state: "downloading", progress: 0.5, busy: true },
      { state: "reading", progress: null, busy: true },
      { state: "ready", progress: null, busy: false },
    ]);
    expect(guideSourceStatuses()[URL]).toMatchObject({ channels: 12, programmes: 340, asked: 1, matched: [{ channelId: "c1", name: "A", via: "id" }] });
  });

  it("refresh forces the next open past the cache window, once", async () => {
    const channels = [{ channelId: "c1", tvgId: "A.us", name: "A" }];
    await fetchExternalPrograms([URL], channels, WINDOW);
    expect(cache.cachedGuideFile).toHaveBeenLastCalledWith(URL, expect.any(Function), { force: false, keep: [URL] });
    refreshExternalGuide();
    expect(native.closeGuide).toHaveBeenCalledWith("tok-1");
    await fetchExternalPrograms([URL], channels, WINDOW);
    expect(cache.cachedGuideFile).toHaveBeenLastCalledWith(URL, expect.any(Function), { force: true, keep: [URL] });
    await fetchExternalPrograms([URL], channels, { from: WINDOW.from, to: WINDOW.to + 3 * DAY });
    expect(cache.cachedGuideFile).toHaveBeenLastCalledWith(URL, expect.any(Function), { force: false, keep: [URL] });
  });

  it("two callers queued behind an open that fits neither share one new open, leaving no handle unclosed", async () => {
    const channels = [{ channelId: "c1", tvgId: "A.us", name: "A" }];
    let land: () => void = () => {};
    native.loadGuide.mockImplementationOnce(() => new Promise((resolve) => (land = () => resolve({ token: `tok-${++tokens}`, stats: null }))));
    const first = fetchExternalPrograms([URL], channels, WINDOW);
    await new Promise((resolve) => setImmediate(resolve));
    const later = { from: WINDOW.from, to: WINDOW.to + 3 * DAY };
    const both = Promise.all([fetchExternalPrograms([URL], channels, later), fetchExternalPrograms([URL], channels, later)]);
    land();
    await Promise.all([first, both]);
    expect(native.loadGuide).toHaveBeenCalledTimes(2);
    expect(native.closeGuide).toHaveBeenCalledWith("tok-1");
    expect(native.closeGuide).not.toHaveBeenCalledWith("tok-2");
  });

  it("a refresh during an open closes what it lands and the next open re-downloads", async () => {
    const channels = [{ channelId: "c1", tvgId: "A.us", name: "A" }];
    let land: () => void = () => {};
    native.loadGuide.mockImplementationOnce(() => new Promise((resolve) => (land = () => resolve({ token: `tok-${++tokens}`, stats: null }))));
    const first = fetchExternalPrograms([URL], channels, WINDOW);
    await new Promise((resolve) => setImmediate(resolve));
    refreshExternalGuide();
    land();
    await first;
    expect(native.closeGuide).toHaveBeenCalledWith("tok-1");
    expect(guideSourceStatuses()[URL].state).not.toBe("error");
    await fetchExternalPrograms([URL], channels, WINDOW);
    expect(cache.cachedGuideFile).toHaveBeenLastCalledWith(URL, expect.any(Function), { force: true, keep: [URL] });
    expect(native.loadGuide).toHaveBeenCalledTimes(2);
  });

  it("closes a guide dropped from the list, forgets one at once, and clears the files on request", async () => {
    const channels = [{ channelId: "c1", tvgId: "A.us", name: "A" }];
    await fetchExternalPrograms([URL, OTHER], channels, WINDOW);
    await fetchExternalPrograms([OTHER], channels, WINDOW);
    expect(native.closeGuide).toHaveBeenCalledWith("tok-1");
    expect(Object.keys(guideSourceStatuses())).toEqual([OTHER]);
    forgetGuide(OTHER);
    expect(native.closeGuide).toHaveBeenCalledWith("tok-2");
    expect(guideSourceStatuses()).toEqual({});
    clearDownloadedGuides();
    expect(cache.clearGuideFileCache).toHaveBeenCalled();
  });

  it("preloads a guide so a URL just added reports what it holds, and a failure only reports", async () => {
    await preloadGuide(URL);
    expect(guideSourceStatuses()[URL]).toMatchObject({ state: "ready", channels: 12 });
    native.loadGuide.mockRejectedValueOnce(new Error("not xml"));
    await expect(preloadGuide(OTHER)).resolves.toBeUndefined();
    expect(guideSourceStatuses()[OTHER].state).toBe("error");
  });
});

describe("searchExternalPrograms", () => {
  let tokens = 0;
  const hit = (channel: string, start: number, title: string, desc: string) => ({ ...programme(channel, start, title), desc });
  beforeEach(() => {
    jest.clearAllMocks();
    resetExternalGuide();
    tokens = 0;
    cache.cachedGuideFile.mockImplementation(async (url: string) => `file:///cache/${encodeURIComponent(url)}`);
    native.loadGuide.mockImplementation(async () => ({ token: `tok-${++tokens}`, stats: { channels: 2, programmes: 4 } }));
    native.guideChannels.mockResolvedValue([
      { id: "A.us", displayNames: ["Alpha"], icon: null },
      { id: "B.us", displayNames: ["Bravo"], icon: null },
    ]);
    native.searchGuide.mockResolvedValue([]);
  });

  it("asks the native store for the paired channels and maps each hit onto its app channel, earliest first", async () => {
    native.searchGuide.mockResolvedValue([hit("B.us", WINDOW.from + 5_000, "Late Game", "Yankees again."), hit("A.us", WINDOW.from, "MLB Baseball", "Yankees at Rays.")]);
    const programs = await searchExternalPrograms(
      [URL],
      [
        { channelId: "c1", tvgId: "A.us", name: "Alpha" },
        { channelId: "c2", name: "Bravo" },
        { channelId: "c3", name: "Nobody" },
      ],
      WINDOW,
      "yankees",
      30,
    );
    expect(native.searchGuide).toHaveBeenCalledWith("tok-1", ["A.us", "B.us"], WINDOW, "yankees", 30);
    expect(programs.map((program) => [program.ChannelId, program.Name])).toEqual([
      ["c1", "MLB Baseball"],
      ["c2", "Late Game"],
    ]);
    expect(programs[0]).toMatchObject({ Id: `${EXTERNAL_GUIDE_PREFIX}c1:${WINDOW.from}`, Overview: "Yankees at Rays." });
  });

  it("asks a later guide only for the channels earlier ones did not pair, and skips a guide that fails", async () => {
    await searchExternalPrograms([URL, OTHER], [{ channelId: "c1", tvgId: "A.us", name: "Alpha" }], WINDOW, "yankees", 30);
    expect(native.searchGuide).toHaveBeenCalledTimes(1);
    native.searchGuide.mockClear();
    resetExternalGuide();
    native.loadGuide.mockRejectedValueOnce(new Error("not xml"));
    native.searchGuide.mockResolvedValue([hit("A.us", WINDOW.from, "MLB Baseball", "Yankees.")]);
    const programs = await searchExternalPrograms([URL, OTHER], [{ channelId: "c1", tvgId: "A.us", name: "Alpha" }], WINDOW, "yankees", 30);
    expect(programs.map((program) => program.ChannelId)).toEqual(["c1"]);
  });
});

describe("activeGuideUrls", () => {
  it("asks the viewer's guides first, then the playlists', once each, less the switched-off ones", () => {
    expect(activeGuideUrls({ guideUrls: ["http://mine/a.xml", "http://both.xml"], guideSourcesOff: ["http://off.xml"] }, ["http://both.xml", "http://off.xml", "http://declared.xml"])).toEqual([
      "http://mine/a.xml",
      "http://both.xml",
      "http://declared.xml",
    ]);
  });
});
