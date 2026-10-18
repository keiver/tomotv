/** invalidateItemRemoved evicts every cached family that can list a deleted item, and only that user's; invalidateFolderListing evicts one folder's pages. */

jest.mock("@/services/folderContentsCache", () => ({ patchFolderCacheItem: jest.fn() }));
jest.mock("@/services/jellyfin/events", () => ({ notifyItemRemoved: jest.fn(), notifyResumeChange: jest.fn(), notifyRecordingsChange: jest.fn() }));

import { invalidateFolderListing, invalidateItemRemoved } from "@/services/jellyfin/cacheKeys";
import { cachedRequest, clearRequestCache } from "@/services/requestCache";

const TTL = 60_000;

// One key per family, shaped as its read function builds it.
const LISTING_KEYS = [
  "resume:u:x",
  "recentPlayed:u:x",
  "details:u:abc",
  "folder:u:f",
  "playlist:u:p",
  "filtered:u:f",
  "recursive:u:f",
  "recursivesized:u:f",
  "recursivephotos:u:f",
  "items:u:f",
  "playlistAll:u:p",
  "viewLeaves:u:v:none",
  "folderpreview:u:f",
  "viewcount:u:v",
  "search:u:film::0:60",
  "search:u:film:2026:60:60",
];

async function isCached(key: string): Promise<boolean> {
  const fetcher = jest.fn(async () => "fresh");
  await cachedRequest(key, fetcher, TTL);
  return fetcher.mock.calls.length === 0;
}

beforeEach(() => clearRequestCache());

describe("invalidateItemRemoved", () => {
  it("evicts every family that can list the item", async () => {
    for (const key of LISTING_KEYS) await cachedRequest(key, async () => "old", TTL);
    invalidateItemRemoved("u", "abc");
    for (const key of LISTING_KEYS) expect([key, await isCached(key)]).toEqual([key, false]);
  });

  it("leaves another user's reads alone", async () => {
    await cachedRequest("viewLeaves:other:v:none", async () => "old", TTL);
    await cachedRequest("search:other:film::0:60", async () => "old", TTL);
    invalidateItemRemoved("u", "abc");
    expect(await isCached("viewLeaves:other:v:none")).toBe(true);
    expect(await isCached("search:other:film::0:60")).toBe(true);
  });

  it("prevents an in-flight search from repopulating the cache after deletion", async () => {
    const key = "search:u:film::0:60";
    let finish!: (items: string[]) => void;
    const pending = cachedRequest(
      key,
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve;
        }),
      TTL,
    );
    invalidateItemRemoved("u", "abc");
    finish(["abc"]);
    await pending;
    expect(await cachedRequest(key, async () => [], TTL)).toEqual([]);
  });
});

describe("invalidateFolderListing", () => {
  const OWN = ["folder:u:f:0:60:none", "folder:u:f:60:60:fav", "playlist:u:f:0:60", "viewLeaves:u:f:none"];
  const OTHERS = ["folder:u:f2:0:60:none", "folder:other:f:0:60:none", "views:u", "details:u:f"];

  it("drops every page of that folder and nothing else", async () => {
    for (const key of [...OWN, ...OTHERS]) await cachedRequest(key, async () => "old", TTL);
    invalidateFolderListing("u", "f");
    for (const key of OWN) expect([key, await isCached(key)]).toEqual([key, false]);
    for (const key of OTHERS) expect([key, await isCached(key)]).toEqual([key, true]);
  });

  it("drops the libraries list for the root and leaves folders alone", async () => {
    await cachedRequest("views:u", async () => "old", TTL);
    await cachedRequest("folder:u:f:0:60:none", async () => "old", TTL);
    invalidateFolderListing("u", null);
    expect(await isCached("views:u")).toBe(false);
    expect(await isCached("folder:u:f:0:60:none")).toBe(true);
  });
});
