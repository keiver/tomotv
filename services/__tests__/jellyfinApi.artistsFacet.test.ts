/**
 * `/Artists` must be allowed to disappear.
 *
 * It carries `deprecated: true` in the published API spec, and unlike the legacy
 * user-scoped routes it has no replacement: artist rows are stored OUTSIDE the item
 * tree (no ParentId, no TopParentId, `Path` under `%MetadataPath%/artists/`), so
 * `/Items`, which walks the hierarchy, structurally cannot return them. Measured
 * against 10.11.11: `/Artists` 57, every `/Items IncludeItemTypes=MusicArtist` shape 0.
 *
 * So the app keeps calling it, which is also what makes it work on older servers. The
 * safety net is that its removal must DEGRADE (no artist facets) rather than break the
 * feature around it. These tests pin that, because it is one `.catch()` away from
 * becoming a hard failure in a refactor.
 */
import { fetchLibraryArtists, refreshConfig, searchVideos } from "../jellyfinApi";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/libraryManager", () => ({ libraryManager: { clearCache: jest.fn() } }));

describe("/Artists removal degrades instead of breaking", () => {
  const mockSecureStore = require("expo-secure-store");

  /** Every endpoint answers normally except /Artists, which 404s as a server that dropped it would. */
  function serverWithoutArtists() {
    global.fetch = jest.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/Artists") return { ok: false, status: 404, json: async () => ({}) };
      if (url.pathname === "/Genres") return { ok: true, json: async () => ({ Items: [{ Name: "Comedy" }] }) };
      return { ok: true, json: async () => ({ Items: [], TotalRecordCount: 0, StartIndex: 0 }) };
    }) as unknown as typeof fetch;
  }

  beforeEach(async () => {
    jest.resetModules();
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
    serverWithoutArtists();
  });

  it("search still resolves when the server has no /Artists", async () => {
    // The facet pass fans out genres AND artists; a 404 on one must not reject the search.
    await expect(searchVideos("comedy")).resolves.toBeDefined();
  });

  it("still queries /Artists, so servers that have it keep their facets", async () => {
    await searchVideos("comedy").catch(() => undefined);

    const paths = (global.fetch as jest.Mock).mock.calls.map((call) => new URL(call[0] as string).pathname);
    expect(paths).toContain("/Artists");
  });

  it("surfaces the failure to a caller that asks for artists directly, so the Filters panel can hide the section", async () => {
    // app/filters.tsx takes this through Promise.allSettled and renders no Artists section
    // on a rejection. Asserting the rejection keeps that contract explicit.
    await expect(fetchLibraryArtists("library-1")).rejects.toThrow();
  });
});
