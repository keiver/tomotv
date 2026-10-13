/**
 * The device listening to a song (native/ios/LyricsListener): every word the system transcriber
 * hears, with its time. Runs on iOS, tvOS and macOS 26 and later; everywhere else it answers null.
 */
import { File, Paths } from "expo-file-system";
import { NativeModules } from "react-native";
import { localMediaUri } from "@/services/downloads/localSource";
import { sizeOf } from "@/services/downloads/paths";
import { deviceLanguage, locale } from "@/services/i18n";
import { getRemoteVideoStreamUrl } from "@/services/jellyfin/streamUrls";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import type { HeardWord } from "./align";

const { LyricsListener } = NativeModules;

/** A set or a mix is not a song to follow line by line. */
const MAX_SECONDS = 10 * 60;
const MAX_BYTES = 80 * 1024 * 1024;
/** Containers Core Audio opens. Ogg, Opus and WMA are the engine's, which this does not use. */
const READABLE = ["mp3", "m4a", "m4b", "aac", "mp4", "flac", "wav", "aiff", "aif", "caf", "alac"];

let available: Promise<boolean> | null = null;

export function listenerAvailable(): Promise<boolean> {
  available ??= LyricsListener?.capability
    ? (LyricsListener.capability() as Promise<{ available?: boolean }>).then(
        (capability) => capability?.available === true,
        () => false,
      )
    : Promise.resolve(false);
  return available;
}

function container(item: JellyfinVideoItem): string {
  return (item.MediaSources?.[0]?.Container ?? item.Container ?? "").split(",")[0].toLowerCase();
}

/** Whether this song is one the device would listen to at all. */
export function listenable(item: JellyfinVideoItem): boolean {
  const seconds = (item.RunTimeTicks ?? 0) / 10_000_000;
  return seconds > 0 && seconds <= MAX_SECONDS && sizeOf(item) <= MAX_BYTES && READABLE.includes(container(item));
}

/**
 * The words heard in the song, or null when the device, the language or the file rules it out.
 * A song that is not on disk is fetched to a temporary file first and removed after.
 */
export async function listen(item: JellyfinVideoItem, lyricsText: string | null): Promise<HeardWord[] | null> {
  if (!listenable(item) || !(await listenerAvailable())) return null;
  const local = localMediaUri(item.Id);
  let temporary: File | null = null;
  try {
    let fileUri = local;
    if (!fileUri) {
      const url = getRemoteVideoStreamUrl(item.Id, item);
      if (!url) return null;
      temporary = new File(Paths.cache, `listen-${item.Id}.${container(item)}`);
      if (temporary.exists) temporary.delete();
      fileUri = (await File.downloadFileAsync(url, temporary, { idempotent: true })).uri;
    }
    const languages = [...new Set([locale(), deviceLanguage(), "en"])];
    const heard = (await LyricsListener.transcribe({ fileUri, lyrics: lyricsText ?? undefined, languages })) as { words?: [number, number, string][] } | null;
    if (!heard?.words) return null;
    return heard.words.map(([start, end, text]) => ({ start, end, text }));
  } catch (error) {
    logger.warn("Listening for lyrics failed", error, { service: "Lyrics", itemId: item.Id });
    return null;
  } finally {
    if (temporary?.exists) temporary.delete();
  }
}
