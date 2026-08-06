/**
 * Tests for user-data filters (favorite / played / unplayed) on a LIBRARY VIEW ROOT.
 *
 * Verified against Jellyfin 10.11.1 on a photos library: a recursive query rooted at the view root
 * returns every leaf but with EMPTY user data (0 of 65 reported IsFavorite while 6 of them were
 * favorites), and the same query plus Filters=IsFavorite returns nothing — so the grid rendered
 * "No items match the current filters" over a library full of favorites. The identical query with
 * no ParentId returns those favorites, which is the shape the client-side resolution leans on.
 */
import { fetchFilteredVideos, fetchFolderContents } from "../jellyfinApi";
import { clearFavoriteIdsCache } from "../favoritesCache";
import { clearPlayedCache, markPlayed } from "../playedCache";
import { EMPTY_FILTERS, LibraryFilters } from "@/types/jellyfin";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/libraryManager", () => ({
  libraryManager: { clearCache: jest.fn() },
}));

const VIEW_ROOT = "photos-library";
const ALBUM = "album-1";

/** Leaves as the view root reports them: real items, no user data at all. */
const LEAVES = [
  { Id: "photo-1", Name: "Alpha", Type: "Photo", ParentId: ALBUM, UserData: {} },
  { Id: "photo-2", Name: "Bravo", Type: "Photo", ParentId: ALBUM, UserData: {} },
  { Id: "photo-3", Name: "Charlie", Type: "Photo", ParentId: ALBUM, UserData: {} },
  { Id: "video-1", Name: "Delta", Type: "Video", ParentId: VIEW_ROOT, UserData: {} },
];

const FAVORITE_IDS = ["photo-2", "video-1"];
const PLAYED_IDS = ["photo-3"];

describe("user-data filters at a library view root", () => {
  const mockSecureStore = require("expo-secure-store");

  beforeEach(() => {
    clearFavoriteIdsCache();
    clearPlayedCache();

    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const mockConfig: Record<string, string> = {
        jellyfin_server_url: "http://192.168.1.100:8096",
        jellyfin_api_key: "test-api-key",
        jellyfin_user_id: "test-user-id",
        jellyfin_device_id: "test-device-id",
      };
      return Promise.resolve(mockConfig[key] || null);
    });

    // Route by URL shape so call ORDER never matters — the resolution fans out in parallel.
    global.fetch = jest.fn(async (input: string) => {
      const url = new URL(input);
      const ok = (body: unknown) => ({ ok: true, json: async () => body });

      if (url.pathname.endsWith("/Views")) {
        return ok({ Items: [{ Id: VIEW_ROOT, Name: "Photos", Type: "CollectionFolder" }] });
      }

      const parentId = url.searchParams.get("ParentId");
      const filters = url.searchParams.get("Filters");

      // Root-scoped id sets: the shape that works.
      if (!parentId && filters === "IsFavorite") {
        return ok({ Items: FAVORITE_IDS.map((Id) => ({ Id })), TotalRecordCount: FAVORITE_IDS.length });
      }
      if (!parentId && filters === "IsPlayed") {
        return ok({ Items: PLAYED_IDS.map((Id) => ({ Id })), TotalRecordCount: PLAYED_IDS.length });
      }

      // Membership under the view root. The server answers this one, minus user data.
      if (parentId === VIEW_ROOT && !filters) {
        return ok({ Items: LEAVES, TotalRecordCount: LEAVES.length });
      }

      // What the server actually did to the old query: filtered at a view root, nothing comes back.
      return ok({ Items: [], TotalRecordCount: 0 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const filters = (overrides: Partial<LibraryFilters>): LibraryFilters => ({ ...EMPTY_FILTERS, ...overrides });

  function requestedUrls(): URL[] {
    return (global.fetch as jest.Mock).mock.calls.map((call) => new URL(call[0] as string));
  }

  it("returns the favorites instead of an empty grid", async () => {
    const result = await fetchFolderContents(VIEW_ROOT, { filters: filters({ favorite: true }) });

    expect(result.items.map((item) => item.Id)).toEqual(["photo-2", "video-1"]);
    expect(result.total).toBe(2);
  });

  it("never sends the user-data filter to the view root — that query is the bug", async () => {
    await fetchFolderContents(VIEW_ROOT, { filters: filters({ favorite: true }) });

    const rootScoped = requestedUrls().filter((url) => url.searchParams.get("ParentId") === VIEW_ROOT);
    expect(rootScoped.length).toBeGreaterThan(0);
    rootScoped.forEach((url) => expect(url.searchParams.get("Filters")).toBeNull());
  });

  it("resolves played and unplayed off the same membership list", async () => {
    const played = await fetchFolderContents(VIEW_ROOT, { filters: filters({ played: true }) });
    expect(played.items.map((item) => item.Id)).toEqual(["photo-3"]);

    const unplayed = await fetchFolderContents(VIEW_ROOT, { filters: filters({ unplayed: true }) });
    expect(unplayed.items.map((item) => item.Id)).toEqual(["photo-1", "photo-2", "video-1"]);
  });

  it("honors a played flip made this session before the server set catches up", async () => {
    markPlayed("photo-1", true);

    const result = await fetchFolderContents(VIEW_ROOT, { filters: filters({ played: true }) });

    expect(result.items.map((item) => item.Id)).toEqual(["photo-1", "photo-3"]);
  });

  it("intersects combined filters rather than picking one", async () => {
    markPlayed("photo-2", true);

    const result = await fetchFolderContents(VIEW_ROOT, { filters: filters({ favorite: true, played: true }) });

    expect(result.items.map((item) => item.Id)).toEqual(["photo-2"]);
  });

  it("pages the complete matched set, so the total is exact", async () => {
    const page = await fetchFolderContents(VIEW_ROOT, { filters: filters({ unplayed: true }), limit: 2, startIndex: 0 });
    expect(page.items.map((item) => item.Id)).toEqual(["photo-1", "photo-2"]);
    expect(page.total).toBe(3);

    const next = await fetchFolderContents(VIEW_ROOT, { filters: filters({ unplayed: true }), limit: 2, startIndex: 2 });
    expect(next.items.map((item) => item.Id)).toEqual(["video-1"]);
    expect(next.total).toBe(3);
  });

  it("stamps the resolved state onto the cards, so hearts and checkmarks are not blank", async () => {
    // The view root hands back empty UserData. Unstamped, every card looked unfavorited and
    // unwatched, and the long-press sheet offered "Mark as Favorite" on an existing favorite.
    const result = await fetchFolderContents(VIEW_ROOT, { filters: filters({ favorite: true }) });

    expect(result.items.map((item) => [item.Id, item.UserData?.IsFavorite])).toEqual([
      ["photo-2", true],
      ["video-1", true],
    ]);
  });

  it("stamps played state even when only the favorite filter is on", async () => {
    markPlayed("video-1", true);

    const result = await fetchFolderContents(VIEW_ROOT, { filters: filters({ favorite: true }) });

    expect(result.items.map((item) => [item.Id, item.UserData?.Played])).toEqual([
      ["photo-2", false],
      ["video-1", true],
    ]);
  });

  it("hands the filtered set to the photo viewer and play queue, not the whole library", async () => {
    // fetchFilteredVideos is the complete-set source both use; at a view root it used to
    // come back empty, which sent the viewer to the unfiltered folder cache instead.
    const full = await fetchFilteredVideos(VIEW_ROOT, filters({ favorite: true }));

    expect(full.map((item) => item.Id)).toEqual(["photo-2", "video-1"]);
  });

  it("propagates a favorites-set failure instead of rendering a silently empty grid", async () => {
    // A swallowed miss here would show "No items match the current filters" over a transient
    // network error — the caller's error state (with retry) is the honest answer.
    const base = global.fetch as jest.Mock;
    global.fetch = jest.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.get("ParentId") && url.searchParams.get("Filters") === "IsFavorite") {
        return { ok: false, status: 500 };
      }
      return base(input);
    }) as unknown as typeof fetch;

    await expect(fetchFolderContents(VIEW_ROOT, { filters: filters({ favorite: true }) })).rejects.toThrow("favorite ids");
  });

  it("leaves an ordinary folder on the server-side path", async () => {
    await fetchFolderContents(ALBUM, { filters: filters({ favorite: true }) });

    const albumQuery = requestedUrls().find((url) => url.searchParams.get("ParentId") === ALBUM);
    expect(albumQuery?.searchParams.get("Filters")).toBe("IsFavorite");
  });

  it("leaves non-user-data filters on the server-side path even at a view root", async () => {
    await fetchFolderContents(VIEW_ROOT, { filters: filters({ years: [2024] }) });

    const rootQuery = requestedUrls().find((url) => url.searchParams.get("ParentId") === VIEW_ROOT);
    expect(rootQuery?.searchParams.get("Years")).toBe("2024");
  });
});
