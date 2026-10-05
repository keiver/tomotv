/** Live TV search: the server's name matches plus the airing set matched by description; channels first, ended programmes dropped; a failed source keeps the other. */
import { matchesProgramText, orderLiveTvResults, searchLiveTv } from "../jellyfin/search";
import { fetchWithTimeout } from "../jellyfin/http";
import { clearRequestCache } from "../requestCache";

jest.mock("../jellyfin/http", () => ({ fetchWithTimeout: jest.fn() }));
jest.mock("../jellyfin/session", () => ({
  getConfig: jest.fn(async () => ({ server: "http://jf", apiKey: "k", userId: "u", deviceId: "d" })),
  getAuthHeader: jest.fn(() => "auth"),
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("../jellyfin/tunerGroups", () => ({ fetchTunerData: jest.fn() }));
jest.mock("@/services/externalGuide", () => ({ activeGuideUrls: jest.requireActual("@/services/externalGuide").activeGuideUrls, searchExternalPrograms: jest.fn() }));
jest.mock("@/services/liveTvPreferences", () => ({ getLiveTvPreferences: jest.fn(() => ({ guideUrls: [], guideSourcesOff: [] })) }));
jest.mock("../jellyfin/liveTvSearchIndex", () => ({ ...jest.requireActual("../jellyfin/liveTvSearchIndex"), liveTvSearchIndex: jest.fn(() => null) }));
const { liveTvSearchIndex } = jest.requireMock("../jellyfin/liveTvSearchIndex") as { liveTvSearchIndex: jest.Mock };

const { fetchTunerData } = jest.requireMock("../jellyfin/tunerGroups") as { fetchTunerData: jest.Mock };
const { searchExternalPrograms } = jest.requireMock("@/services/externalGuide") as { searchExternalPrograms: jest.Mock };
const { getLiveTvPreferences } = jest.requireMock("@/services/liveTvPreferences") as { getLiveTvPreferences: jest.Mock };
const NO_TUNER = { groups: [], tvgById: {}, tvgNameById: {}, tvgUrls: [], tvgUrlSources: {} };

const NOW = Date.parse("2026-09-25T02:00:00Z");
const program = (id: string, start: string, end: string) => ({ Id: id, Name: id, Type: "Program", Path: "", ChannelId: "c1", StartDate: start, EndDate: end });
const channel = (id: string) => ({ Id: id, Name: id, Type: "TvChannel", Path: "" });

describe("orderLiveTvResults", () => {
  it("puts channels first, drops ended programmes and orders the rest by start", () => {
    const items = [
      program("later", "2026-09-25T05:00:00Z", "2026-09-25T06:00:00Z"),
      program("ended", "2026-09-25T00:00:00Z", "2026-09-25T01:00:00Z"),
      channel("ch"),
      program("now", "2026-09-25T01:30:00Z", "2026-09-25T02:30:00Z"),
    ];
    expect(orderLiveTvResults(items, NOW).map((item) => item.Id)).toEqual(["ch", "now", "later"]);
  });

  it("keeps at most thirty", () => {
    const many = Array.from({ length: 40 }, (_, i) => channel(`c${i}`));
    expect(orderLiveTvResults(many, NOW)).toHaveLength(30);
  });

  it("reaches the end of tomorrow and no further", () => {
    const local = new Date(NOW);
    const at = (dayOffset: number, hour: number) => new Date(local.getFullYear(), local.getMonth(), local.getDate() + dayOffset, hour).toISOString();
    const items = [program("tomorrow-night", at(1, 23), at(2, 0)), program("day-after", at(2, 1), at(2, 2))];
    expect(orderLiveTvResults(items, NOW).map((item) => item.Id)).toEqual(["tomorrow-night"]);
  });

  it("collapses a title's airings on a channel into its next one, and keeps the title on other channels", () => {
    const airingOn = (id: string, channelId: string, name: string, start: string, end: string) => ({ ...program(id, start, end), Name: name, ChannelId: channelId });
    const items = [
      airingOn("trek-2", "trek", "Star Trek", "2026-09-25T03:00:00Z", "2026-09-25T04:00:00Z"),
      airingOn("trek-1", "trek", "STAR TREK", "2026-09-25T01:30:00Z", "2026-09-25T02:30:00Z"),
      airingOn("scifi-1", "scifi", "Star Trek", "2026-09-25T05:00:00Z", "2026-09-25T06:00:00Z"),
      airingOn("voyager", "trek", "Star Trek: Voyager", "2026-09-25T04:00:00Z", "2026-09-25T05:00:00Z"),
    ];
    expect(orderLiveTvResults(items, NOW).map((item) => item.Id)).toEqual(["trek-1", "voyager", "scifi-1"]);
  });
});

describe("matchesProgramText", () => {
  const game = { Name: "MLB Baseball", EpisodeTitle: "Yankees at Rays", Overview: "The New York Yankees visit the Tampa Bay Rays in St. Petersburg." };

  it("finds a listing by any word of its name, episode title or description, case and accents folded", () => {
    expect(matchesProgramText(game, "mlb")).toBe(true);
    expect(matchesProgramText(game, "Yankees")).toBe(true);
    expect(matchesProgramText(game, "tampa bay")).toBe(true);
    expect(matchesProgramText(game, "yank")).toBe(true);
    expect(matchesProgramText({ Name: "Fútbol", Overview: "Real Madrid y Atlético" }, "atletico")).toBe(true);
  });

  it("needs every word, and at least three characters", () => {
    expect(matchesProgramText(game, "Yankees Mets")).toBe(false);
    expect(matchesProgramText(game, "ml")).toBe(false);
    expect(matchesProgramText(game, "")).toBe(false);
    expect(matchesProgramText({ Name: "News" }, "yankees")).toBe(false);
  });
});

describe("searchLiveTv", () => {
  const ON_NOW = { StartDate: new Date(Date.now() - 30 * 60_000).toISOString(), EndDate: new Date(Date.now() + 90 * 60_000).toISOString() };
  const airing = (id: string, channelId: string, overview: string, name = "MLB Baseball") => ({
    Id: id,
    Name: name,
    Type: "Program",
    Path: "",
    ChannelId: channelId,
    ChannelName: channelId.toUpperCase(),
    Overview: overview,
    ...ON_NOW,
  });
  const ok = (Items: unknown[]) => ({ ok: true, json: async () => ({ Items }) });
  /** Answers by endpoint: the name search at /Items, the airing set at /LiveTv/Programs, one programme at /LiveTv/Programs/{id}. */
  const serve = (names: unknown, airingSet: unknown, details: Record<string, unknown> = {}) =>
    (fetchWithTimeout as jest.Mock).mockImplementation(async (url: string) => {
      const detail = url.match(/\/LiveTv\/Programs\/([^?]+)/);
      const answer = detail ? (details[detail[1]] ?? { ok: false, status: 404 }) : url.includes("/LiveTv/Programs") ? airingSet : names;
      if (answer instanceof Error) throw answer;
      return answer;
    });
  const urls = () => (fetchWithTimeout as jest.Mock).mock.calls.map(([url]) => url as string);

  beforeEach(() => {
    jest.clearAllMocks();
    clearRequestCache();
    fetchTunerData.mockResolvedValue(NO_TUNER);
    searchExternalPrograms.mockResolvedValue([]);
    liveTvSearchIndex.mockReturnValue(null);
  });

  describe("the server's programme index", () => {
    const later = (hours: number) => new Date(Date.now() + hours * 3_600_000).getTime();
    const indexed = (id: string, text: string, startMs: number, channelId = "tbs", name = "MLB Baseball") => ({ id, name, channelId, startMs, endMs: startMs + 3 * 3_600_000, text });

    it("finds tonight's game by its description and completes the card with its channel and artwork", async () => {
      liveTvSearchIndex.mockReturnValue([indexed("g7", "mlb baseball the new york yankees visit the tampa bay rays", later(5)), indexed("g8", "mlb baseball dodgers at giants", later(6))]);
      serve(ok([]), ok([]), {
        g7: {
          ok: true,
          json: async () => ({
            Id: "g7",
            Name: "MLB Baseball",
            Type: "Program",
            ChannelId: "tbs",
            ChannelName: "TBS",
            StartDate: new Date(later(5)).toISOString(),
            EndDate: new Date(later(8)).toISOString(),
          }),
        },
      });
      const result = await searchLiveTv("Yankees");
      expect(result.map((item) => item.Id)).toEqual(["g7"]);
      expect(result[0]).toMatchObject({ Type: "Program", ChannelId: "tbs", ChannelName: "TBS" });
      expect(urls().filter((url) => url.includes("/LiveTv/Programs/g7"))).toHaveLength(1);
    });

    it("keeps a bare card when its details cannot be read, and reads a shown card's details once", async () => {
      liveTvSearchIndex.mockReturnValue([indexed("g9", "mlb baseball yankees", later(4))]);
      serve(ok([]), ok([]));
      expect((await searchLiveTv("yankees"))[0]).toMatchObject({ Id: "g9", Name: "MLB Baseball", Type: "Program", ChannelId: "tbs" });
      serve(ok([]), ok([]), {
        g9: {
          ok: true,
          json: async () => ({
            Id: "g9",
            Name: "MLB Baseball",
            Type: "Program",
            ChannelId: "tbs",
            ChannelName: "TBS",
            StartDate: new Date(later(4)).toISOString(),
            EndDate: new Date(later(7)).toISOString(),
          }),
        },
      });
      await searchLiveTv("yankees");
      await searchLiveTv("yankees");
      expect(urls().filter((url) => url.includes("/LiveTv/Programs/g9"))).toHaveLength(2);
    });

    it("reads a shown card's details again for another server or account", async () => {
      const { getConfig } = jest.requireMock("../jellyfin/session") as { getConfig: jest.Mock };
      liveTvSearchIndex.mockReturnValue([indexed("g5", "mlb baseball yankees", later(4))]);
      const details = (ChannelName: string) => ({
        ok: true,
        json: async () => ({ Id: "g5", Name: "MLB Baseball", Type: "Program", ChannelId: "tbs", ChannelName, StartDate: new Date(later(4)).toISOString(), EndDate: new Date(later(7)).toISOString() }),
      });
      serve(ok([]), ok([]), { g5: details("TBS") });
      expect((await searchLiveTv("yankees"))[0].ChannelName).toBe("TBS");
      serve(ok([]), ok([]), { g5: details("TBS East") });
      getConfig.mockResolvedValueOnce({ server: "http://other", apiKey: "k", userId: "u", deviceId: "d" });
      expect((await searchLiveTv("yankees"))[0].ChannelName).toBe("TBS East");
      getConfig.mockResolvedValueOnce({ server: "http://jf", apiKey: "k2", userId: "u2", deviceId: "d" });
      await searchLiveTv("yankees");
      expect(urls().filter((url) => url.includes("/LiveTv/Programs/g5"))).toEqual([
        "http://jf/LiveTv/Programs/g5?userId=u",
        "http://other/LiveTv/Programs/g5?userId=u",
        "http://jf/LiveTv/Programs/g5?userId=u2",
      ]);
    });

    it("answers without the index while it is being built, and never matches a term under three characters", async () => {
      serve(ok([channel("ch")]), ok([]));
      await expect(searchLiveTv("yankees")).resolves.toEqual([channel("ch")]);
      liveTvSearchIndex.mockReturnValue([indexed("g1", "yankees", later(2))]);
      expect((await searchLiveTv("ya")).map((item) => item.Id)).toEqual(["ch"]);
    });
  });

  it("asks /Items for channels and programmes matching the term, and the airing set for descriptions", async () => {
    serve(ok([channel("ch")]), ok([]));
    await expect(searchLiveTv(" witness ")).resolves.toEqual([channel("ch")]);
    const [items, programs] = urls();
    expect(items).toContain("http://jf/Items?");
    expect(items).toContain("includeItemTypes=TvChannel%2CLiveTvProgram");
    expect(items).toContain("searchTerm=witness");
    expect(programs).toContain("http://jf/LiveTv/Programs?");
    expect(programs).toContain("isAiring=true");
    expect(programs).toContain("fields=ChannelInfo%2COverview%2CPrimaryImageAspectRatio");
  });

  it("adds the programme airing now whose description carries the term, as a card that tunes its channel", async () => {
    serve(ok([]), ok([airing("p1", "tbs", "The New York Yankees visit the Tampa Bay Rays."), airing("p2", "espn", "Dodgers at Giants.")]));
    const result = await searchLiveTv("Yankees");
    expect(result.map((item) => item.Id)).toEqual(["p1"]);
    expect(result[0]).toMatchObject({ Type: "Program", ChannelId: "tbs" });
  });

  it("keeps a programme the server already matched by name once, ahead of the description hits", async () => {
    const byName = { ...airing("p1", "tbs", "Yankees and Rays."), StartDate: new Date(Date.now() - 60 * 60_000).toISOString() };
    serve(ok([channel("mlb"), byName]), ok([airing("p1", "tbs", "Yankees and Rays."), airing("p3", "trutv", "Yankees pregame.")]));
    expect((await searchLiveTv("yankees")).map((item) => item.Id)).toEqual(["mlb", "p1", "p3"]);
  });

  it("leaves the airing set out of a two-letter term and ignores channels inside it", async () => {
    serve(ok([channel("ch")]), ok([airing("p1", "tbs", "Yankees."), { ...channel("tbs"), Overview: "Yankees" }]));
    await expect(searchLiveTv("ya")).resolves.toEqual([channel("ch")]);
  });

  it("reads the airing set once for a whole typed query", async () => {
    serve(ok([]), ok([airing("p1", "tbs", "Yankees.")]));
    await searchLiveTv("yan");
    await searchLiveTv("yank");
    await searchLiveTv("yankees");
    expect(urls().filter((url) => url.includes("/LiveTv/Programs"))).toHaveLength(1);
    expect(urls().filter((url) => url.includes("/Items?"))).toHaveLength(3);
  });

  it("keeps one source's results when the other is refused or fails", async () => {
    serve(ok([channel("ch")]), { ok: false, status: 403 });
    await expect(searchLiveTv("yankees")).resolves.toEqual([channel("ch")]);
    serve({ ok: false, status: 500 }, ok([airing("p1", "tbs", "Yankees.")]));
    expect((await searchLiveTv("yankees")).map((item) => item.Id)).toEqual(["p1"]);
    // Offline with the airing set still remembered: the description hits stay.
    serve(new Error("offline"), new Error("offline"));
    expect((await searchLiveTv("yankees")).map((item) => item.Id)).toEqual(["p1"]);
    clearRequestCache();
    await expect(searchLiveTv("yankees")).resolves.toEqual([]);
  });

  describe("guide sources", () => {
    const GUIDE = "http://host:8000/pluto-guide.xml.gz";
    const listing = (channelId: string, startOffsetMin: number, overview: string) => ({
      Id: `epg:${channelId}:${startOffsetMin}`,
      Name: "MLB Baseball",
      ChannelId: channelId,
      StartDate: new Date(Date.now() + startOffsetMin * 60_000).toISOString(),
      EndDate: new Date(Date.now() + (startOffsetMin + 120) * 60_000).toISOString(),
      Overview: overview,
    });
    beforeEach(() => {
      fetchTunerData.mockResolvedValue({ ...NO_TUNER, tvgById: { tbs: "tbs.us" }, tvgNameById: { tbs: "TBS", trutv: "truTV" }, tvgUrls: [GUIDE] });
    });

    it("finds programmes on now and later in a guide source, through tomorrow, for the tuner's channels", async () => {
      serve(ok([]), ok([]));
      searchExternalPrograms.mockResolvedValue([listing("trutv", 600, "Yankees at Rays, game two."), listing("tbs", -30, "The New York Yankees visit the Tampa Bay Rays.")]);
      const result = await searchLiveTv("Yankees");
      expect(result.map((item) => item.Id)).toEqual(["epg:tbs:-30", "epg:trutv:600"]);
      expect(result[1]).toMatchObject({ Type: "Program", ChannelId: "trutv", ChannelName: "truTV" });
      const [urls, channels, windowMs, query, limit] = searchExternalPrograms.mock.calls[0];
      expect(urls).toEqual([GUIDE]);
      expect(channels).toEqual(
        expect.arrayContaining([
          { channelId: "tbs", tvgId: "tbs.us", tvgName: "TBS", name: "TBS" },
          { channelId: "trutv", tvgId: undefined, tvgName: "truTV", name: "truTV" },
        ]),
      );
      const today = new Date();
      expect(windowMs.from).toBeLessThanOrEqual(Date.now());
      expect(windowMs.to).toBe(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2).getTime());
      expect([query, limit]).toEqual(["Yankees", 30]);
    });

    it("asks the viewer's own guides too, less those switched off, and never for a two-letter term", async () => {
      getLiveTvPreferences.mockReturnValue({ guideUrls: ["http://mine/epg.xml"], guideSourcesOff: [GUIDE] });
      serve(ok([]), ok([]));
      await searchLiveTv("ya");
      expect(searchExternalPrograms).not.toHaveBeenCalled();
      await searchLiveTv("yankees");
      expect(searchExternalPrograms.mock.calls[0][0]).toEqual(["http://mine/epg.xml"]);
      getLiveTvPreferences.mockReturnValue({ guideUrls: [], guideSourcesOff: [] });
    });

    it("keeps the server's matches when the guide sources cannot be read", async () => {
      serve(ok([channel("ch")]), ok([]));
      searchExternalPrograms.mockRejectedValue(new Error("guide down"));
      await expect(searchLiveTv("yankees")).resolves.toEqual([channel("ch")]);
    });
  });

  it("answers empty for a blank term without asking the server", async () => {
    await expect(searchLiveTv("  ")).resolves.toEqual([]);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });
});
