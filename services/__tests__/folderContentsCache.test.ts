import { clearFolderContentsCache, deleteFolderCache, FolderCacheEntry, getFolderCache, setFolderCache } from "@/services/folderContentsCache";
import { JellyfinItem } from "@/types/jellyfin";

const item = (id: string): JellyfinItem => ({ Id: id, Name: id, Type: "Folder" }) as JellyfinItem;

describe("folderContentsCache", () => {
  beforeEach(() => {
    clearFolderContentsCache();
  });

  it("returns undefined for a missing key", () => {
    expect(getFolderCache("nope")).toBeUndefined();
  });

  it("stores and retrieves an entry by key", () => {
    const entry: FolderCacheEntry = { items: [item("a")], total: 1, timestamp: 123 };
    setFolderCache("root", entry);
    expect(getFolderCache("root")).toBe(entry);
  });

  it("overwrites an existing key", () => {
    setFolderCache("k", { items: [item("a")], total: 1, timestamp: 1 });
    setFolderCache("k", { items: [item("b")], total: 1, timestamp: 2 });
    expect(getFolderCache("k")?.items[0].Id).toBe("b");
  });

  it("deletes a single key without touching others", () => {
    setFolderCache("a", { items: [], timestamp: 1 });
    setFolderCache("b", { items: [], timestamp: 1 });
    deleteFolderCache("a");
    expect(getFolderCache("a")).toBeUndefined();
    expect(getFolderCache("b")).toBeDefined();
  });

  it("clears every entry", () => {
    setFolderCache("a", { items: [], timestamp: 1 });
    setFolderCache("b", { items: [], timestamp: 1 });
    clearFolderContentsCache();
    expect(getFolderCache("a")).toBeUndefined();
    expect(getFolderCache("b")).toBeUndefined();
  });

  it("keeps entries isolated by key (no cross-key leakage)", () => {
    setFolderCache("root", { items: [item("lib")], timestamp: 1 });
    setFolderCache("folder-1", { items: [item("vid")], timestamp: 1 });
    expect(getFolderCache("root")?.items[0].Id).toBe("lib");
    expect(getFolderCache("folder-1")?.items[0].Id).toBe("vid");
  });
});
