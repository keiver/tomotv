/**
 * How the Downloads screen organises itself. The arithmetic matters more than the shape: a
 * folder row that misreports its size or claims to be finished while part of it is not is a
 * user deleting the wrong several gigabytes.
 */
import { groupDownloads, totalDownloadedBytes } from "@/services/downloads/grouping";
import type { DownloadEntry, DownloadState } from "@/services/downloads/manifest";

const MB = 1024 ** 2;

function entry(id: string, overrides: Partial<DownloadEntry> = {}): DownloadEntry {
  return {
    itemId: id,
    fileUri: `file:///doc/downloads/${id}/media.flac`,
    artworkUri: null,
    bytesWritten: 100 * MB,
    totalBytes: 100 * MB,
    state: "ready" as DownloadState,
    addedAt: 1,
    item: { Id: id, Name: `Item ${id}` } as never,
    ...overrides,
  };
}

function inAlbum(id: string, overrides: Partial<DownloadEntry> = {}) {
  return entry(id, { group: { id: "album-1", name: "Veckatimest" }, ...overrides });
}

describe("groupDownloads", () => {
  it("leaves an untagged download as a row of its own", () => {
    const rows = groupDownloads([entry("a")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("item");
  });

  it("collapses a tagged set into one folder row", () => {
    const rows = groupDownloads([inAlbum("a"), inAlbum("b"), inAlbum("c")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("group");
    if (rows[0].kind !== "group") throw new Error("expected a group");
    expect(rows[0].group.name).toBe("Veckatimest");
    expect(rows[0].group.entries).toHaveLength(3);
  });

  it("keeps a one-item folder as a folder, because that is what was asked for", () => {
    const rows = groupDownloads([inAlbum("a")]);
    expect(rows[0].kind).toBe("group");
  });

  it("sums the set's size", () => {
    const rows = groupDownloads([inAlbum("a", { totalBytes: 300 * MB, bytesWritten: 300 * MB }), inAlbum("b")]);
    if (rows[0].kind !== "group") throw new Error("expected a group");
    expect(rows[0].group.bytes).toBe(400 * MB);
    expect(rows[0].group.totalBytes).toBe(400 * MB);
  });

  it("counts bytes written, not declared, for anything still in flight", () => {
    const rows = groupDownloads([inAlbum("a", { state: "downloading", bytesWritten: 20 * MB, totalBytes: 100 * MB })]);
    if (rows[0].kind !== "group") throw new Error("expected a group");
    expect(rows[0].group.bytes).toBe(20 * MB);
  });

  it("has no total to state when one member never declared a size", () => {
    const rows = groupDownloads([inAlbum("a"), inAlbum("b", { totalBytes: -1 })]);
    if (rows[0].kind !== "group") throw new Error("expected a group");
    expect(rows[0].group.totalBytes).toBeNull();
  });

  it.each([
    [["ready", "ready"], "ready"],
    [["ready", "paused"], "paused"],
    [["ready", "queued"], "queued"],
    [["ready", "downloading"], "downloading"],
    [["downloading", "failed"], "failed"],
  ])("reports %s as %s, worst first", (states, expected) => {
    const rows = groupDownloads(states.map((state, index) => inAlbum(`m${index}`, { state: state as DownloadState })));
    if (rows[0].kind !== "group") throw new Error("expected a group");
    expect(rows[0].group.state).toBe(expected);
  });

  it("never calls a set ready while part of it is still moving", () => {
    const rows = groupDownloads([inAlbum("a"), inAlbum("b", { state: "downloading" })]);
    if (rows[0].kind !== "group") throw new Error("expected a group");
    expect(rows[0].group.state).not.toBe("ready");
  });

  it("orders a folder by its most recent member, not its first", () => {
    const rows = groupDownloads([entry("solo", { addedAt: 50 }), inAlbum("a", { addedAt: 10 }), inAlbum("b", { addedAt: 90 })]);
    expect(rows[0].kind).toBe("group");
    expect(rows[1].kind).toBe("item");
  });

  it("keeps two folders apart", () => {
    const rows = groupDownloads([inAlbum("a"), entry("b", { group: { id: "album-2", name: "Two Weeks" } })]);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === "group")).toBe(true);
  });
});

describe("totalDownloadedBytes", () => {
  it("adds finished sizes and in-flight progress together", () => {
    expect(totalDownloadedBytes([entry("a"), entry("b", { state: "downloading", bytesWritten: 30 * MB, totalBytes: 500 * MB })])).toBe(130 * MB);
  });

  it("never counts an undeclared size as negative", () => {
    expect(totalDownloadedBytes([entry("a", { state: "ready", totalBytes: -1 })])).toBe(0);
  });
});
