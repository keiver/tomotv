/** invalidateItemRemoved evicts every cached family that can list a deleted item, and only that user's. */

jest.mock("@/services/folderContentsCache", () => ({ patchFolderCacheItem: jest.fn() }));
jest.mock("@/services/jellyfin/events", () => ({ notifyItemRemoved: jest.fn(), notifyResumeChange: jest.fn(), notifyRecordingsChange: jest.fn() }));

import { invalidateItemRemoved } from "@/services/jellyfin/cacheKeys";
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
  "latest:u:v",
  "recursive:u:f",
  "recursivesized:u:f",
  "recursivephotos:u:f",
  "items:u:f",
  "playlistAll:u:p",
  "viewLeaves:u:v:none",
  "folderpreview:u:f",
  "viewcount:u:v",
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
    invalidateItemRemoved("u", "abc");
    expect(await isCached("viewLeaves:other:v:none")).toBe(true);
  });
});
