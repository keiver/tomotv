/**
 * Every user-facing list query must ask for real items only.
 *
 * Jellyfin holds `LocationType: "Virtual"` rows: items with no file behind them,
 * which can never play. A Season whose IndexNumber is null does not satisfy its
 * episodes' ParentIndexNumber, so the server mints a numbered, empty Season beside
 * it and the series lists both — a four-season show browses as eight folders, four
 * of which open into nothing. Missing and unaired episodes are the same kind of row
 * for any profile with "Display missing episodes" on, which is why this is pinned
 * on the queue and search paths too and not only on the browse.
 *
 * The parameter is `LocationTypes` (an allowlist), NOT `ExcludeLocationTypes`.
 * The latter is in the published spec but the server ignores it — see the note on
 * INCLUDED_LOCATION_TYPES in services/jellyfin/constants.ts for the measurement.
 */
import { INCLUDED_LOCATION_TYPES } from "../jellyfin/constants";
import { fetchFilteredVideos, fetchFolderContents, fetchRecursiveVideos, refreshConfig, searchVideos } from "../jellyfinApi";
import { EMPTY_FILTERS } from "@/types/jellyfin";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/libraryManager", () => ({
  libraryManager: { clearCache: jest.fn() },
}));

describe("virtual item exclusion", () => {
  const mockSecureStore = require("expo-secure-store");
  const emptyItemsResponse = { Items: [], TotalRecordCount: 0, StartIndex: 0 };

  beforeEach(async () => {
    jest.resetModules();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => emptyItemsResponse })) as unknown as typeof fetch;

    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const config: Record<string, string> = {
        jellyfin_server_url: "http://192.168.1.100:8096",
        jellyfin_api_key: "test-api-key",
        jellyfin_user_id: "test-user-id",
        jellyfin_device_id: "test-device-id",
      };
      return Promise.resolve(config[key] || null);
    });

    await refreshConfig();
  });

  /** Every /Items URL this test's call produced. */
  function itemQueries(): URL[] {
    return (global.fetch as jest.Mock).mock.calls.map((call) => new URL(call[0] as string)).filter((url) => url.pathname.endsWith("/Items"));
  }

  it("asks the folder browse for real items only", async () => {
    await fetchFolderContents("series-1");

    const [url] = itemQueries();
    expect(url.searchParams.get("LocationTypes")).toBe(INCLUDED_LOCATION_TYPES);
  });

  it("asks the filtered browse for real items only, where a missing episode reads as unplayed", async () => {
    await fetchFolderContents("series-1", { filters: { ...EMPTY_FILTERS, unplayed: true } });

    const [url] = itemQueries();
    expect(url.searchParams.get("LocationTypes")).toBe(INCLUDED_LOCATION_TYPES);
    expect(url.searchParams.get("Filters")).toBe("IsUnplayed");
  });

  it("asks the queue-building fetches for real items only", async () => {
    await fetchRecursiveVideos("library-1");
    await fetchFilteredVideos("library-1", { ...EMPTY_FILTERS, genres: ["Comedy"] });

    const urls = itemQueries();
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const url of urls) expect(url.searchParams.get("LocationTypes")).toBe(INCLUDED_LOCATION_TYPES);
  });

  it("asks search for real items only", async () => {
    await searchVideos("kimmy");

    const urls = itemQueries();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.searchParams.get("LocationTypes")).toBe(INCLUDED_LOCATION_TYPES);
  });

  it("allows the streamable kinds and nothing else", () => {
    // Measured against 10.11.11: the server honours LocationTypes and ignores
    // ExcludeLocationTypes. Remote is kept because it is genuinely streamable
    // (Live TV, channels); Virtual and the legacy Offline are what this keeps out.
    expect(INCLUDED_LOCATION_TYPES).toBe("FileSystem,Remote");
    expect(INCLUDED_LOCATION_TYPES).not.toContain("Virtual");
  });

  it("never sends ExcludeLocationTypes, which the server silently ignores", async () => {
    await fetchFolderContents("series-1");

    for (const url of itemQueries()) expect(url.searchParams.get("ExcludeLocationTypes")).toBeNull();
  });
});
