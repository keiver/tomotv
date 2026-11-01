/**
 * The text subtitles a video already has, the ones a viewer can shift in time or replace: the
 * file's own and the server's sidecars, then the copies kept on this device.
 */
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { languageCode } from "./languages";
import { deviceSubtitleIndex, deviceSubtitles } from "./store";
import type { SubtitleHit, SubtitleSourceId } from "./types";

export interface CurrentSubtitle {
  /** The stream index the engine publishes the track under. */
  index: number;
  name: string;
  language: string;
  /** Set for a copy kept on this device: what a replacement removes. */
  device?: { ordinal: number; source: SubtitleSourceId; sourceId: string };
}

const IMAGE_CODECS = /pgs|dvd|vobsub|dvb|xsub/i;

export function currentTextSubtitles(item: Pick<JellyfinVideoItem, "Id" | "MediaStreams">, server: string): CurrentSubtitle[] {
  const own = (item.MediaStreams ?? [])
    .filter((stream) => stream.Type === "Subtitle" && stream.Index !== undefined && !IMAGE_CODECS.test(stream.Codec ?? ""))
    .map((stream) => ({
      index: stream.Index as number,
      name: stream.DisplayTitle?.trim() || stream.Title?.trim() || stream.Language || `Track ${stream.Index}`,
      language: stream.Language || "und",
    }));
  const kept = deviceSubtitles(server, item.Id).map((entry) => ({
    index: deviceSubtitleIndex(entry.ordinal),
    name: entry.name,
    language: entry.language || "und",
    device: { ordinal: entry.ordinal, source: entry.source, sourceId: entry.sourceId },
  }));
  return [...own, ...kept];
}

/** A hit is the copy that is on when it came from the same source under the same id. */
export function isCurrentPick(hit: SubtitleHit, current: CurrentSubtitle | null | undefined): boolean {
  return !!current?.device && current.device.source === hit.source && current.device.sourceId === hit.id;
}

/** What a pick replaces: the device copy that is on, when the pick speaks its language. */
export function replacementFor(hit: SubtitleHit, current: CurrentSubtitle | null | undefined): { ordinal: number } | undefined {
  if (!current?.device) return undefined;
  return languageCode(current.language) === languageCode(hit.language) ? { ordinal: current.device.ordinal } : undefined;
}
