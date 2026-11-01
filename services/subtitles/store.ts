/**
 * Subtitles found for a video and kept on this device, for an account the server lets save nothing.
 * One folder per server and item: under Documents on iOS, under Caches on tvOS, which has no
 * writable Documents. A WebVTT per find and an index naming each.
 */
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { logger } from "@/utils/logger";
import type { SubtitleSourceId } from "./types";

const DIRECTORY = "subtitles";

function root(): Directory {
  return Platform.isTV ? Paths.cache : Paths.document;
}
const INDEX = "index.json";
const VERSION = 1;

/**
 * Stream indexes the engine addresses device subtitles by. Jellyfin numbers a file's streams from
 * 0 in the tens at most, so entries from here up collide with none of them.
 */
export const DEVICE_SUBTITLE_INDEX_BASE = 100000;

export interface DeviceSubtitle {
  /** Position in the index: its stream index is DEVICE_SUBTITLE_INDEX_BASE plus this. */
  ordinal: number;
  language: string;
  name: string;
  source: SubtitleSourceId;
  sourceId: string;
  forced: boolean;
  hearingImpaired: boolean;
  savedAt: number;
  /** file:// URI of the WebVTT. */
  uri: string;
}

/** A removed entry keeps its slot, so the ordinals after it keep their stream index and stored timing. */
type IndexEntry = Omit<DeviceSubtitle, "uri" | "ordinal"> & { removed?: true };

interface IndexDocument {
  version: number;
  entries: IndexEntry[];
}

function folderName(server: string, itemId: string): string {
  return `${server}_${itemId}`.replace(/[^A-Za-z0-9]/g, "_");
}

function itemDirectory(server: string, itemId: string): Directory {
  return new Directory(root(), DIRECTORY, folderName(server, itemId));
}

function vttFile(directory: Directory, ordinal: number): File {
  return new File(directory, `sub.${ordinal}.vtt`);
}

function readIndex(directory: Directory): IndexDocument {
  try {
    const file = new File(directory, INDEX);
    if (!file.exists) return { version: VERSION, entries: [] };
    const parsed = JSON.parse(file.textSync()) as IndexDocument;
    return parsed?.version === VERSION && Array.isArray(parsed.entries) ? parsed : { version: VERSION, entries: [] };
  } catch {
    return { version: VERSION, entries: [] };
  }
}

/** Every subtitle kept for an item, oldest first, each with the file it lives in. */
export function deviceSubtitles(server: string, itemId: string): DeviceSubtitle[] {
  if (!server || !itemId) return [];
  try {
    const directory = itemDirectory(server, itemId);
    if (!directory.exists) return [];
    return readIndex(directory)
      .entries.map((entry, ordinal) => ({ ...entry, ordinal, uri: vttFile(directory, ordinal).uri }))
      .filter((entry) => !entry.removed && new File(entry.uri).exists)
      .map(({ removed: _removed, ...entry }) => entry);
  } catch (error) {
    logger.warn("Device subtitles read failed", error, { service: "Subtitles", itemId });
    return [];
  }
}

export interface SaveDeviceSubtitleInput {
  server: string;
  itemId: string;
  language: string;
  name: string;
  source: SubtitleSourceId;
  sourceId: string;
  forced: boolean;
  hearingImpaired: boolean;
  vtt: string;
}

/** Keeps one WebVTT for an item; the same source and id saved again replaces the earlier copy. */
export function saveDeviceSubtitle(input: SaveDeviceSubtitleInput, now: number = Date.now()): DeviceSubtitle | null {
  try {
    const directory = itemDirectory(input.server, input.itemId);
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    const index = readIndex(directory);
    let ordinal = index.entries.findIndex((entry) => entry.source === input.source && entry.sourceId === input.sourceId);
    const entry: IndexEntry = {
      language: input.language,
      name: input.name,
      source: input.source,
      sourceId: input.sourceId,
      forced: input.forced,
      hearingImpaired: input.hearingImpaired,
      savedAt: now,
    };
    if (ordinal < 0) {
      ordinal = index.entries.length;
      index.entries.push(entry);
    } else {
      index.entries[ordinal] = entry;
    }
    const file = vttFile(directory, ordinal);
    if (file.exists) file.delete();
    file.write(input.vtt);
    new File(directory, INDEX).write(JSON.stringify(index));
    return { ...entry, ordinal, uri: file.uri };
  } catch (error) {
    logger.warn("Device subtitle save failed", error, { service: "Subtitles", itemId: input.itemId });
    return null;
  }
}

/** Removes a kept subtitle: its file goes, its slot stays marked so no other entry takes its stream index. */
export function removeDeviceSubtitle(server: string, itemId: string, ordinal: number): boolean {
  try {
    const directory = itemDirectory(server, itemId);
    if (!directory.exists) return false;
    const index = readIndex(directory);
    const entry = index.entries[ordinal];
    if (!entry || entry.removed) return false;
    index.entries[ordinal] = { ...entry, removed: true };
    const file = vttFile(directory, ordinal);
    if (file.exists) file.delete();
    new File(directory, INDEX).write(JSON.stringify(index));
    return true;
  } catch (error) {
    logger.warn("Device subtitle remove failed", error, { service: "Subtitles", itemId, ordinal });
    return false;
  }
}

/** The stream index a device subtitle is published under. */
export function deviceSubtitleIndex(ordinal: number): number {
  return DEVICE_SUBTITLE_INDEX_BASE + ordinal;
}
