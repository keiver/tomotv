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
  /** Answers by endpoint: the name search at /Items, the airing set at /LiveTv/Programs. */
  const serve = (names: unknown, airingSet: unknown) =>
    (fetchWithTimeout as jest.Mock).mockImplementation(async (url: string) => {
      const answer = url.includes("/LiveTv/Programs") ? airingSet : names;
      if (answer instanceof Error) throw answer;
      return answer;
    });
  const urls = () => (fetchWithTimeout as jest.Mock).mock.calls.map(([url]) => url as string);

  beforeEach(() => {
    jest.clearAllMocks();
    clearRequestCache();
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

  it("answers empty for a blank term without asking the server", async () => {
    await expect(searchLiveTv("  ")).resolves.toEqual([]);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });
});
