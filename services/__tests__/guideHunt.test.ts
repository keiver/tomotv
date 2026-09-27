/**
 * The guide hunt: exact-after-normalization matching (ambiguity matches nothing), lazy
 * per-country files capped at two, silent failures, and programmes shaped as the server's.
 */
const mockCachedGuideFile = jest.fn();
const mockLoadGuide = jest.fn();
const mockGuideChannels = jest.fn();
const mockGuideProgrammes = jest.fn();
const mockCloseGuide = jest.fn();

jest.mock("@/services/guideFileCache", () => ({
  cachedGuideFile: (url: string) => mockCachedGuideFile(url),
}));
jest.mock("@/services/liveSources", () => ({
  isLiveSourcesAvailable: () => true,
  loadGuide: (url: string, window: unknown) => mockLoadGuide(url, window),
  guideChannels: (token: string) => mockGuideChannels(token),
  guideProgrammes: (token: string, ids: string[], window: unknown) => mockGuideProgrammes(token, ids, window),
  closeGuide: (token: string) => mockCloseGuide(token),
}));
jest.mock("@/utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { buildGuideIndex, channelKeys, cleanKey, huntPrograms, resetGuideHunt, tvgCountry } from "../guideHunt";

const fetchMock = jest.fn();

const WINDOW = { from: 1_000_000, to: 2_000_000 };
const LISTING = '<a href="epg_ripper_US2.xml.gz">epg_ripper_US2.xml.gz</a> <a href="epg_ripper_UK1.xml.gz">epg_ripper_UK1.xml.gz</a>';

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, text: async () => LISTING });
  mockCachedGuideFile.mockReset().mockResolvedValue("file:///guide.xml.gz");
  mockLoadGuide.mockReset().mockResolvedValue({ token: "tok-1", stats: { channels: 2, programmes: 4 } });
  mockGuideChannels.mockReset().mockResolvedValue([
    { id: "Hallmark.Channel.HD.us2", displayNames: ["Hallmark Channel"], icon: null },
    { id: "Newsmax.TV.HD.us2", displayNames: ["Newsmax TV"], icon: null },
  ]);
  mockGuideProgrammes.mockReset().mockResolvedValue([]);
  mockCloseGuide.mockReset().mockResolvedValue(undefined);
  resetGuideHunt();
});

describe("normalization and matching", () => {
  it("cleans identity out of case, punctuation and quality tokens", () => {
    expect(cleanKey("Hallmark.Channel.HD")).toBe(cleanKey("Hallmark Channel"));
    expect(cleanKey("TNT.Sports.1.HD")).toBe(cleanKey("TNT Sports 1"));
  });

  it("names the country off the tvg-id, feed suffix stripped", () => {
    expect(tvgCountry("BBCNews.uk@HD")).toBe("UK");
    expect(tvgCountry("Channel9.il")).toBe("IL");
    expect(tvgCountry("NoCountry")).toBeNull();
  });

  it("keys a playlist channel by id stem and bare display name", () => {
    expect(channelKeys("HallmarkChannel.us", "Hallmark Channel (1080p)")).toContain(cleanKey("HallmarkChannel"));
    expect(channelKeys("X.us", "Some Channel [Geo-blocked]")).toContain(cleanKey("Some Channel"));
  });

  it("drops a key two guide channels share", () => {
    const index = buildGuideIndex([
      { id: "A.One.us", displayNames: ["Duplicate"] },
      { id: "B.Two.us", displayNames: ["Duplicate"] },
    ]);
    expect(index.has(cleanKey("Duplicate"))).toBe(false);
    expect(index.get(cleanKey("A.One"))).toBe("A.One.us");
  });
});

describe("huntPrograms", () => {
  it("matches a bare channel and shapes its programmes like the server's", async () => {
    mockGuideProgrammes.mockResolvedValue([{ channel: "Hallmark.Channel.HD.us2", start: 1_200_000, stop: 1_500_000, title: "Movie", desc: null, subTitle: null, categories: [] }]);
    const programs = await huntPrograms([{ channelId: "jf1", tvgId: "HallmarkChannel.us", name: "Hallmark Channel (1080p)" }], WINDOW);
    expect(programs).toHaveLength(1);
    expect(programs[0]).toMatchObject({ Id: "epg:jf1:1200000", Name: "Movie", ChannelId: "jf1" });
    expect(mockCachedGuideFile).toHaveBeenCalledWith("https://epgshare01.online/epgshare01/epg_ripper_US2.xml.gz");
  });

  it("reads at most the two most-demanded countries", async () => {
    const channels = [
      { channelId: "a", tvgId: "One.us", name: "One" },
      { channelId: "b", tvgId: "Two.us", name: "Two" },
      { channelId: "c", tvgId: "Three.uk", name: "Three" },
      { channelId: "d", tvgId: "Four.es", name: "Four" },
    ];
    await huntPrograms(channels, WINDOW);
    // ES has no hosted file in the listing; US and UK load, ES never asked.
    const urls = mockCachedGuideFile.mock.calls.map(([url]) => url);
    expect(urls).toEqual(expect.arrayContaining([expect.stringContaining("US2"), expect.stringContaining("UK1")]));
    expect(urls.some((url) => url.includes("ES"))).toBe(false);
  });

  it("answers nothing when the host listing is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));
    const programs = await huntPrograms([{ channelId: "a", tvgId: "One.us", name: "One" }], WINDOW);
    expect(programs).toEqual([]);
    expect(mockCachedGuideFile).not.toHaveBeenCalled();
  });

  it("answers nothing and remembers the failure when a country file cannot load", async () => {
    mockLoadGuide.mockRejectedValue(new Error("404"));
    const first = await huntPrograms([{ channelId: "a", tvgId: "One.us", name: "One" }], WINDOW);
    expect(first).toEqual([]);
    mockLoadGuide.mockClear();
    await huntPrograms([{ channelId: "a", tvgId: "One.us", name: "One" }], WINDOW);
    expect(mockLoadGuide).not.toHaveBeenCalled();
  });

  it("reuses an open guide for a covering window instead of reloading", async () => {
    const request = [{ channelId: "jf1", tvgId: "HallmarkChannel.us", name: "Hallmark Channel" }];
    await huntPrograms(request, WINDOW);
    await huntPrograms(request, WINDOW);
    expect(mockLoadGuide).toHaveBeenCalledTimes(1);
  });
});
