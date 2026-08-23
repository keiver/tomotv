/**
 * grouping.ts
 *
 * How the Downloads screen organises what is on the device: folders downloaded whole collapse
 * into one row, single downloads stand on their own.
 *
 * Pure, and separate from the screen, because the interesting part is arithmetic — an album's
 * total size, how far along it is, whether any of it failed — and a row that misreports that
 * is a user deleting the wrong 4GB.
 */

import type { DownloadEntry, DownloadState } from "./manifest";

export interface DownloadGroup {
  id: string;
  name: string;
  entries: DownloadEntry[];
  /** Bytes on disk when ready, bytes written so far otherwise. */
  bytes: number;
  /** Sum of the declared sizes, or null when any member never declared one. */
  totalBytes: number | null;
  /**
   * The set's state, worst first: anything failed shows failed, anything still moving shows
   * downloading, and only a set where every member is complete reads as ready.
   */
  state: DownloadState;
}

/** A group of one is not a folder; single downloads render as plain rows. */
export type DownloadListRow = { kind: "item"; entry: DownloadEntry } | { kind: "group"; group: DownloadGroup };

/** Worst-first, so a group never claims to be finished while part of it is not. */
const STATE_RANK: Record<DownloadState, number> = { failed: 0, downloading: 1, queued: 2, paused: 3, ready: 4 };

function groupState(entries: DownloadEntry[]): DownloadState {
  return entries.reduce<DownloadState>((worst, entry) => (STATE_RANK[entry.state] < STATE_RANK[worst] ? entry.state : worst), "ready");
}

function bytesOf(entry: DownloadEntry): number {
  return entry.state === "ready" ? Math.max(entry.totalBytes, 0) : Math.max(entry.bytesWritten, 0);
}

/**
 * Newest first, by the most recent thing in each row: a folder whose last track arrived a
 * minute ago belongs above a single item from yesterday, whichever was started first.
 */
export function groupDownloads(entries: DownloadEntry[]): DownloadListRow[] {
  const groups = new Map<string, DownloadEntry[]>();
  const loose: DownloadEntry[] = [];

  for (const entry of entries) {
    if (!entry.group) {
      loose.push(entry);
      continue;
    }
    const existing = groups.get(entry.group.id);
    if (existing) existing.push(entry);
    else groups.set(entry.group.id, [entry]);
  }

  const rows: { row: DownloadListRow; addedAt: number }[] = loose.map((entry) => ({ row: { kind: "item", entry }, addedAt: entry.addedAt }));

  for (const [id, members] of groups) {
    // A folder that only ever yielded one item is a folder the user asked for; keeping it as
    // a group means deleting it still deletes the thing they chose.
    const ordered = [...members].sort((a, b) => a.addedAt - b.addedAt);
    const sized = ordered.every((entry) => entry.totalBytes > 0);
    rows.push({
      row: {
        kind: "group",
        group: {
          id,
          name: ordered[0].group?.name ?? "Downloads",
          entries: ordered,
          bytes: ordered.reduce((sum, entry) => sum + bytesOf(entry), 0),
          totalBytes: sized ? ordered.reduce((sum, entry) => sum + entry.totalBytes, 0) : null,
          state: groupState(ordered),
        },
      },
      addedAt: Math.max(...ordered.map((entry) => entry.addedAt)),
    });
  }

  return rows.sort((a, b) => b.addedAt - a.addedAt).map((row) => row.row);
}

/** Bytes the whole downloads set occupies, for the storage bar. */
export function totalDownloadedBytes(entries: DownloadEntry[]): number {
  return entries.reduce((sum, entry) => sum + bytesOf(entry), 0);
}

/** Where a highlighted download sits in the list: the folder to open, and the row to mark. */
export interface DownloadLocation {
  /** Folder to expand, or null for a row that stands on its own. */
  groupId: string | null;
  /** The row wearing the selection: a whole folder, or one item. */
  rowId: string;
}

/**
 * Find the row an id names: a folder, a loose download, or one member inside a folder.
 * Returns null while the id is not on the device yet, which is the normal state for the
 * moments after a folder is queued.
 */
export function locateDownload(rows: DownloadListRow[], id: string): DownloadLocation | null {
  for (const row of rows) {
    if (row.kind === "item") {
      if (row.entry.itemId === id) return { groupId: null, rowId: id };
      continue;
    }
    if (row.group.id === id) return { groupId: id, rowId: id };
    if (row.group.entries.some((entry) => entry.itemId === id)) return { groupId: row.group.id, rowId: id };
  }
  return null;
}

/**
 * How many rows sit above a located one, counting the members an open folder adds. The screen
 * draws a Shuffle row at the top of an open folder, so that row is passed in rather than assumed.
 */
export function rowsAbove(rows: DownloadListRow[], location: DownloadLocation, shuffleRow: boolean): number {
  let above = 0;
  for (const row of rows) {
    if (row.kind === "item") {
      if (row.entry.itemId === location.rowId) return above;
      above += 1;
      continue;
    }
    if (row.group.id === location.rowId) return above;
    above += 1;
    if (row.group.id !== location.groupId) continue;
    if (shuffleRow) above += 1;
    const member = row.group.entries.findIndex((entry) => entry.itemId === location.rowId);
    if (member >= 0) return above + member;
    above += row.group.entries.length;
  }
  return 0;
}
