/** Live TV search: the server's name matches plus the airing set matched by description; channels first, ended programmes dropped; a failed source keeps the other. */
import { matchesProgramText, orderLiveTvResults, searchLiveTv, warmLiveTvSearch } from "../jellyfin/search";
import { fetchWithTimeout } from "../jellyfin/http";
import { clearRequestCache } from "../requestCache";

jest.mock("../jellyfin/http", () => ({ fetchWithTimeout: jest.fn() }));
jest.mock("../jellyfin/session", () => ({
  getConfig: jest.fn(async () => ({ server: "http://jf", apiKey: "k", userId: "u", deviceId: "d" })),
  getAuthHeader: jest.fn(() => "auth"),
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("../jellyfin/tunerGroups", () => ({ fetchTunerData: jest.fn(), guideChannelRequests: jest.requireActual("../jellyfin/tunerGroups").guideChannelRequests }));
jest.mock("../jellyfin/liveTv", () => ({ ...jest.requireActual("../jellyfin/liveTv"), fetchChannelOrder: jest.fn(async () => []) }));
const { fetchChannelOrder } = jest.requireMock("../jellyfin/liveTv") as { fetchChannelOrder: jest.Mock };
jest.mock("@/services/externalGuide", () => ({ activeGuideUrls: jest.requireActual("@/services/externalGuide").activeGuideUrls, searchExternalPrograms: jest.fn() }));
jest.mock("@/services/liveTvPreferences", () => ({
  ...jest.requireActual("@/services/liveTvPreferences"),
  getLiveTvPreferences: jest.fn(() => ({ guideUrls: [], guideSourcesOff: [], hidden: [], renames: [] })),
}));
jest.mock("../jellyfin/liveTvSearchIndex", () => ({ ...jest.requireActual("../jellyfin/liveTvSearchIndex"), liveTvSearchIndex: jest.fn(() => null), liveTvSearchIndexVersion: jest.fn(() => 0) }));
const { liveTvSearchIndex, liveTvSearchIndexVersion } = jest.requireMock("../jellyfin/liveTvSearchIndex") as { liveTvSearchIndex: jest.Mock; liveTvSearchIndexVersion: jest.Mock };

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
    liveTvSearchIndexVersion.mockReturnValue(0);
  });

  it("leaves out a hidden channel and its programmes, and shows a renamed channel under its name", async () => {
    getLiveTvPreferences.mockReturnValue({ guideUrls: [], guideSourcesOff: [], hidden: [{ name: "c1" }], renames: [{ name: "c2", displayName: "Second" }] });
    fetchChannelOrder.mockResolvedValue([channel("c1"), channel("c2")]);
    serve(ok([channel("c1"), channel("c2")]), ok([airing("on-c1", "c1", "the yankees play"), airing("on-c2", "c2", "the yankees play")]));
    const results = await searchLiveTv("yankees");
    expect(results.map((item) => [item.Id, item.Name])).toEqual([
      ["c2", "Second"],
      ["on-c2", "MLB Baseball"],
    ]);
    // The lineup is read first, so a programme's channel id can be told hidden.
    expect(fetchChannelOrder).toHaveBeenCalled();
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

    it("reads a shown card's details again once a rebuilt index lands, so a moved airing shows its new times", async () => {
      const [first, moved] = [later(4), later(5)];
      const details = (startMs: number) => ({
        ok: true,
        json: async () => ({
          Id: "g6",
          Name: "MLB Baseball",
          Type: "Program",
          ChannelId: "tbs",
          ChannelName: "TBS",
          StartDate: new Date(startMs).toISOString(),
          EndDate: new Date(startMs + 3 * 3_600_000).toISOString(),
        }),
      });
      liveTvSearchIndex.mockReturnValue([indexed("g6", "mlb baseball yankees", first)]);
      serve(ok([]), ok([]), { g6: details(first) });
      expect((await searchLiveTv("yankees"))[0].StartDate).toBe(new Date(first).toISOString());

      liveTvSearchIndex.mockReturnValue([indexed("g6", "mlb baseball yankees", moved)]);
      liveTvSearchIndexVersion.mockReturnValue(1);
      serve(ok([]), ok([]), { g6: details(moved) });
      expect((await searchLiveTv("yankees"))[0].StartDate).toBe(new Date(moved).toISOString());
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
      getLiveTvPreferences.mockReturnValue({ guideUrls: ["http://mine/epg.xml"], guideSourcesOff: [GUIDE], hidden: [], renames: [] });
      serve(ok([]), ok([]));
      await searchLiveTv("ya");
      expect(searchExternalPrograms).not.toHaveBeenCalled();
      await searchLiveTv("yankees");
      expect(searchExternalPrograms.mock.calls[0][0]).toEqual(["http://mine/epg.xml"]);
      getLiveTvPreferences.mockReturnValue({ guideUrls: [], guideSourcesOff: [], hidden: [], renames: [] });
    });

    it("asks the viewer's guides for Jellyfin's channels by name when no tuner playlist names them", async () => {
      fetchTunerData.mockResolvedValue(NO_TUNER);
      getLiveTvPreferences.mockReturnValue({ guideUrls: ["http://mine/epg.xml"], guideSourcesOff: [], hidden: [], renames: [] });
      fetchChannelOrder.mockResolvedValueOnce([{ Id: "c9", Name: "Sports One", Type: "TvChannel", Path: "" }]);
      serve(ok([]), ok([]));
      searchExternalPrograms.mockResolvedValue([listing("c9", 30, "Yankees at Rays.")]);
      const result = await searchLiveTv("yankees");
      getLiveTvPreferences.mockReturnValue({ guideUrls: [], guideSourcesOff: [], hidden: [], renames: [] });
      expect(searchExternalPrograms.mock.calls[0][1]).toEqual([{ channelId: "c9", tvgId: undefined, tvgName: undefined, name: "Sports One" }]);
      expect(result[0]).toMatchObject({ ChannelId: "c9", ChannelName: "Sports One" });
    });

    it("gives a playlist channel its Jellyfin name too, for when its tvg-id and tvg-name match nothing in the guide", async () => {
      fetchTunerData.mockResolvedValue({ ...NO_TUNER, tvgById: { c7: "nomatch.us" }, tvgUrls: [GUIDE] });
      fetchChannelOrder.mockResolvedValueOnce([{ Id: "c7", Name: "Sports Two", Type: "TvChannel", Path: "" }]);
      serve(ok([]), ok([]));
      searchExternalPrograms.mockResolvedValue([]);
      await searchLiveTv("yankees");
      expect(searchExternalPrograms.mock.calls[0][1]).toEqual([{ channelId: "c7", tvgId: "nomatch.us", tvgName: undefined, name: "Sports Two" }]);
    });

    it("still asks the viewer's own guides by Jellyfin name when the tuner read is refused", async () => {
      fetchTunerData.mockRejectedValueOnce(new Error("403"));
      getLiveTvPreferences.mockReturnValue({ guideUrls: ["http://mine/epg.xml"], guideSourcesOff: [], hidden: [], renames: [] });
      fetchChannelOrder.mockResolvedValueOnce([{ Id: "c9", Name: "Sports One", Type: "TvChannel", Path: "" }]);
      serve(ok([]), ok([]));
      searchExternalPrograms.mockResolvedValue([listing("c9", 30, "Yankees at Rays.")]);
      const result = await searchLiveTv("yankees");
      getLiveTvPreferences.mockReturnValue({ guideUrls: [], guideSourcesOff: [], hidden: [], renames: [] });
      expect(searchExternalPrograms.mock.calls[0][0]).toEqual(["http://mine/epg.xml"]);
      expect(result[0]).toMatchObject({ ChannelId: "c9", ChannelName: "Sports One" });
    });

    it("keeps the server's matches when the guide sources cannot be read", async () => {
      serve(ok([channel("ch")]), ok([]));
      searchExternalPrograms.mockRejectedValue(new Error("guide down"));
      await expect(searchLiveTv("yankees")).resolves.toEqual([channel("ch")]);
    });

    it("answers with the name matches at once and merges a late guide programme in order, never appended", async () => {
      const nameMatch = {
        ...airing("p-name", "tbs", "Yankees at Rays.", "Yankees Tonight"),
        StartDate: new Date(Date.now() + 5 * 3_600_000).toISOString(),
        EndDate: new Date(Date.now() + 7 * 3_600_000).toISOString(),
      };
      serve(ok([channel("mlb"), nameMatch]), ok([]));
      let finishGuide!: (items: unknown[]) => void;
      searchExternalPrograms.mockImplementationOnce(() => new Promise((resolve) => (finishGuide = resolve)));
      const updates: string[][] = [];
      const result = searchLiveTv("yankees", (items) => updates.push(items.map(({ Id }) => Id)));
      for (let i = 0; i < 20 && updates.length === 0; i++) await new Promise((resolve) => setImmediate(resolve));
      expect(updates[updates.length - 1]).toEqual(["mlb", "p-name"]);
      finishGuide([listing("tbs", 60, "Yankees pregame.")]);
      expect((await result).map(({ Id }) => Id)).toEqual(["mlb", "epg:tbs:60", "p-name"]);
    });
  });

  describe("chained terms", () => {
    const named = (id: string, name: string) => ({ ...channel(id), Name: name });
    /** Answers the name search by the term it asks. */
    const serveNames = (byTerm: Record<string, unknown[]>, airingSet: unknown[] = []) =>
      (fetchWithTimeout as jest.Mock).mockImplementation(async (url: string) => {
        if (url.includes("/LiveTv/Programs/")) return { ok: false, status: 404 };
        return url.includes("/LiveTv/Programs") ? ok(airingSet) : ok(byTerm[new URL(url).searchParams.get("searchTerm") ?? ""] ?? []);
      });

    it("asks the server for each term and joins the names, each once", async () => {
      serveNames({
        pluto: [named("c1", "Pluto TV Animation"), named("c2", "Pluto TV News")],
        animation: [named("c3", "Comedy Central Animation"), named("c1", "Pluto TV Animation")],
      });
      const result = await searchLiveTv("pluto + animation");
      expect(result.map((item) => item.Id)).toEqual(["c1", "c3", "c2"]);
      const asked = urls()
        .filter((url) => url.includes("/Items?"))
        .map((url) => new URL(url).searchParams.get("searchTerm"));
      expect(asked.sort()).toEqual(["animation", "pluto"]);
    });

    it("keeps a term's channel when the other term names nothing", async () => {
      serveNames({ veguitas: [named("c1", "Veguitas TV")] });
      expect((await searchLiveTv("veguitas + live")).map((item) => item.Id)).toEqual(["c1"]);
    });

    it("gives every term a place under the cap when one term fills it alone", async () => {
      serveNames({ pluto: Array.from({ length: 40 }, (_, i) => named(`p${i}`, `Pluto ${i}`)), veguitas: [named("v1", "Veguitas TV")] });
      const result = (await searchLiveTv("pluto + veguitas")).map((item) => item.Id);
      expect(result).toHaveLength(30);
      expect(result.slice(0, 2)).toEqual(["p0", "v1"]);
    });

    it("finds the programmes either term's description names, and asks the guide sources for each term", async () => {
      fetchTunerData.mockResolvedValue({ ...NO_TUNER, tvgNameById: { tbs: "TBS" }, tvgUrls: ["http://host:8000/guide.xml.gz"] });
      serveNames({}, [
        airing("p1", "tbs", "Veguitas y sus amigos. Animation for the family.", "Matutino"),
        airing("p2", "espn", "Animation hour.", "Cortos"),
        airing("p3", "fox", "Late news.", "Noticias"),
      ]);
      const result = await searchLiveTv("veguitas + animation");
      expect(result.map((item) => item.Id)).toEqual(["p1", "p2"]);
      expect(searchExternalPrograms.mock.calls.map((call) => call[3]).sort()).toEqual(["animation", "veguitas"]);
    });

    it("finds the indexed programmes either term names", async () => {
      const startMs = Date.now() + 3_600_000;
      liveTvSearchIndex.mockReturnValue([
        { id: "g1", name: "Matutino", channelId: "tbs", startMs, endMs: startMs + 3_600_000, text: "matutino veguitas y sus amigos animation" },
        { id: "g2", name: "Cortos", channelId: "tbs", startMs, endMs: startMs + 3_600_000, text: "cortos animation hour" },
        { id: "g3", name: "Noticias", channelId: "tbs", startMs, endMs: startMs + 3_600_000, text: "noticias late news" },
      ]);
      serveNames({});
      expect((await searchLiveTv("veguitas + animation")).map((item) => item.Id)).toEqual(["g1", "g2"]);
    });

    it("reports a partial only once every term has answered, holding each term's cards", async () => {
      serveNames({ pluto: [named("c1", "Pluto TV")], veguitas: [named("c2", "Veguitas TV")] });
      const updates: string[][] = [];
      const result = await searchLiveTv("pluto + veguitas", (items) => updates.push(items.map(({ Id }) => Id)));
      expect(updates.length).toBeGreaterThan(0);
      for (const update of updates) expect(update).toEqual(["c1", "c2"]);
      expect(result.map((item) => item.Id)).toEqual(["c1", "c2"]);
    });

    it("asks an unfinished chain as its one term", async () => {
      serveNames({ yankees: [named("c1", "Yankees TV")] });
      expect((await searchLiveTv("yankees +")).map((item) => item.Id)).toEqual(["c1"]);
    });
  });

  it("answers empty for a blank term without asking the server", async () => {
    await expect(searchLiveTv("  ")).resolves.toEqual([]);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("warms the airing set and opens no guide source", async () => {
    getLiveTvPreferences.mockReturnValue({ guideUrls: ["http://mine/epg.xml"], guideSourcesOff: [], hidden: [], renames: [] });
    serve(ok([]), ok([]));
    await warmLiveTvSearch();
    expect(urls().some((url) => url.includes("/LiveTv/Programs"))).toBe(true);
    expect(searchExternalPrograms).not.toHaveBeenCalled();
    getLiveTvPreferences.mockReturnValue({ guideUrls: [], guideSourcesOff: [], hidden: [], renames: [] });
  });
});
