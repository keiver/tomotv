/** Live TV search: channels first, programmes on now, then later ones; ended programmes dropped; a failure answers empty. */
import { orderLiveTvResults, searchLiveTv } from "../jellyfin/search";
import { fetchWithTimeout } from "../jellyfin/http";

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

describe("searchLiveTv", () => {
  beforeEach(() => jest.clearAllMocks());

  it("asks /Items for channels and programmes matching the term", async () => {
    (fetchWithTimeout as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ Items: [channel("ch")] }) });
    await expect(searchLiveTv(" witness ")).resolves.toEqual([channel("ch")]);
    const [url] = (fetchWithTimeout as jest.Mock).mock.calls[0];
    expect(url).toContain("http://jf/Items?");
    expect(url).toContain("includeItemTypes=TvChannel%2CLiveTvProgram");
    expect(url).toContain("searchTerm=witness");
  });

  it("answers empty for a blank term, a refused request or a network failure", async () => {
    await expect(searchLiveTv("  ")).resolves.toEqual([]);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
    (fetchWithTimeout as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(searchLiveTv("news")).resolves.toEqual([]);
    (fetchWithTimeout as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    await expect(searchLiveTv("news")).resolves.toEqual([]);
  });
});
