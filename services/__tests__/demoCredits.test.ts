import { BUNDLED_DEMO_CREDITS, DEMO_CREDITS_URL, fetchDemoCredits, groupCredits, newerManifest, parseDemoCredits, type DemoCredit } from "../demoCredits";

const mockFetchWithTimeout = jest.fn();
jest.mock("@/services/jellyfin/http", () => ({ fetchWithTimeout: (...args: unknown[]) => mockFetchWithTimeout(...args) }));
jest.mock("@/utils/logger", () => ({ logger: { warn: jest.fn() } }));

const credit = (library: string, title: string, more: Partial<DemoCredit> = {}): DemoCredit => ({
  library,
  title,
  by: "Someone",
  year: 2000,
  licence: "CC0",
  licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  source: `https://example.org/${title}`,
  ...more,
});

describe("parseDemoCredits", () => {
  it("keeps a manifest with the full shape and fills a missing year with null", () => {
    const parsed = parseDemoCredits({ generated: "2026-10-24T00:00:00Z", items: [credit("Space", "A clip"), { ...credit("Books", "Short Fiction"), year: undefined }] });
    expect(parsed?.items.map((item) => item.year)).toEqual([2000, null]);
  });

  it("rejects a manifest missing a field, a licence or the generated stamp", () => {
    expect(parseDemoCredits(null)).toBeNull();
    expect(parseDemoCredits({ items: [credit("Space", "A clip")] })).toBeNull();
    expect(parseDemoCredits({ generated: "now", items: [credit("Space", "A clip", { licence: "" })] })).toBeNull();
    expect(parseDemoCredits({ generated: "now", items: [{ title: "No source" }] })).toBeNull();
  });
});

describe("newerManifest", () => {
  const current = { generated: "2026-10-24T10:00:00Z", items: [credit("Space", "Old")] };

  it("takes the fetched manifest only when it was generated later", () => {
    const later = { generated: "2026-10-25T10:00:00Z", items: [credit("Space", "New")] };
    const earlier = { generated: "2026-10-23T10:00:00Z", items: [credit("Space", "Older")] };
    expect(newerManifest(current, later)).toBe(later);
    expect(newerManifest(current, earlier)).toBe(current);
    expect(newerManifest(current, { ...current })).toBe(current);
    expect(newerManifest(current, null)).toBe(current);
  });
});

describe("groupCredits", () => {
  it("groups by library in the demo's order, unknown libraries last, items in their given order", () => {
    const groups = groupCredits([credit("Live TV", "Sintel"), credit("Books", "Dracula"), credit("Extras", "Thing"), credit("Space", "Aurora"), credit("Books", "Jane Eyre")]);
    expect(groups.map((group) => group.library)).toEqual(["Space", "Books", "Live TV", "Extras"]);
    expect(groups[1].items.map((item) => item.title)).toEqual(["Dracula", "Jane Eyre"]);
  });
});

describe("fetchDemoCredits", () => {
  beforeEach(() => mockFetchWithTimeout.mockReset());

  it("asks the demo server for credits.json and returns the parsed manifest", async () => {
    const manifest = { generated: "2026-10-25T00:00:00Z", items: [credit("Music", "Trova de La Habana, 1918-1923")] };
    mockFetchWithTimeout.mockResolvedValue({ ok: true, json: async () => manifest });
    expect(await fetchDemoCredits()).toEqual(manifest);
    expect(mockFetchWithTimeout.mock.calls[0][0]).toBe(DEMO_CREDITS_URL);
    expect(DEMO_CREDITS_URL).toBe("https://tomotv.cubita.studio/credits.json");
  });

  it("returns null on a failed response, a malformed body or a thrown fetch", async () => {
    mockFetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 503 });
    expect(await fetchDemoCredits()).toBeNull();
    mockFetchWithTimeout.mockResolvedValueOnce({ ok: true, json: async () => ({ items: "nope" }) });
    expect(await fetchDemoCredits()).toBeNull();
    mockFetchWithTimeout.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchDemoCredits()).toBeNull();
  });
});

describe("the bundled manifest", () => {
  it("has the full shape and lists every demo library", () => {
    expect(parseDemoCredits(BUNDLED_DEMO_CREDITS)).not.toBeNull();
    expect(groupCredits(BUNDLED_DEMO_CREDITS.items).map((group) => group.library)).toEqual(["Space", "Music", "Books", "Photos", "Shows", "Live TV"]);
  });
});
