import bundledJson from "@/constants/demo-credits.json";
import { BUNDLED_DEMO_CREDITS, creditLibraries, DEMO_CREDITS_URL, distinctLicences, fetchDemoCredits, licenceShortName, newerManifest, parseDemoCredits, type DemoCredit } from "../demoCredits";

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
  image: `https://example.org/${title}.jpg`,
  ...more,
});

describe("parseDemoCredits", () => {
  it("keeps a manifest with the full shape and fills a missing year or image with null", () => {
    const parsed = parseDemoCredits({
      generated: "2026-10-24T00:00:00Z",
      items: [credit("Space", "A clip"), { ...credit("Books", "Short Fiction"), year: undefined, image: undefined }, credit("Live TV", "Sintel", { image: null })],
    });
    expect(parsed?.items.map((item) => item.year)).toEqual([2000, null, 2000]);
    expect(parsed?.items.map((item) => item.image)).toEqual(["https://example.org/A clip.jpg", null, null]);
  });

  it("rejects a manifest missing a field, a licence, the generated stamp or with an empty image", () => {
    expect(parseDemoCredits(null)).toBeNull();
    expect(parseDemoCredits({ items: [credit("Space", "A clip")] })).toBeNull();
    expect(parseDemoCredits({ generated: "now", items: [credit("Space", "A clip", { licence: "" })] })).toBeNull();
    expect(parseDemoCredits({ generated: "now", items: [credit("Space", "A clip", { image: "" })] })).toBeNull();
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

describe("creditLibraries", () => {
  it("groups by library in the demo's order, unknown libraries last, items in their given order", () => {
    const libraries = creditLibraries([credit("Live TV", "Sintel"), credit("Books", "Dracula"), credit("Extras", "Thing"), credit("Space", "Aurora"), credit("Books", "Jane Eyre")]);
    expect(libraries.map((group) => group.library)).toEqual(["Space", "Books", "Live TV", "Extras"]);
    expect(libraries[1].items.map((item) => item.title)).toEqual(["Dracula", "Jane Eyre"]);
  });
});

describe("licenceShortName", () => {
  it("keeps the licence's first clause and drops a trailing 'text'", () => {
    expect(licenceShortName("CC BY 4.0")).toBe("CC BY 4.0");
    expect(licenceShortName("Public domain")).toBe("Public domain");
    expect(licenceShortName("CC0 1.0, public domain dedication")).toBe("CC0 1.0");
    expect(licenceShortName("Public domain text; this edition by Standard Ebooks released under CC0")).toBe("Public domain");
  });
});

describe("distinctLicences", () => {
  it("names each licence once with its page, in first-seen order", () => {
    const nasa = { licence: "Public domain", licenceUrl: "https://nasa.example/licence" };
    const cc = { licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/" };
    expect(distinctLicences([credit("Photos", "Earthrise", nasa), credit("Photos", "Carina", cc), credit("Space", "Pillars", nasa)])).toEqual([nasa, cc]);
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
  it("has the full shape, keeps every item and lists every demo library", () => {
    expect(BUNDLED_DEMO_CREDITS.items).toHaveLength(bundledJson.items.length);
    expect(BUNDLED_DEMO_CREDITS.items.length).toBeGreaterThan(0);
    expect(creditLibraries(BUNDLED_DEMO_CREDITS.items).map((group) => group.library)).toEqual(["Space", "Music", "Books", "Photos", "Shows", "Live TV"]);
  });
});
