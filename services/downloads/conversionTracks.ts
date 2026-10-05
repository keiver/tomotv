import { preferredAudioIndexIn, readAudioPreference } from "@/services/audioPreference";
import { deviceLanguage } from "@/services/i18n";
import { getSubtitlePreferenceSync, subtitleShownFor } from "@/services/subtitlePreference";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { conversionAudioIndex, subtitleToBurn } from "./convert";

/**
 * What a conversion records, decided at download time: the one audio track, in the viewer's audio
 * language, and the subtitle burned into the picture when the one they would see has no file of its own.
 */
export async function conversionTracks(item: JellyfinVideoItem): Promise<{ audioIndex?: number; burnSubtitleIndex?: number }> {
  const streams = item.MediaStreams ?? [];
  const audioIndex = preferredAudioIndexIn(streams, await readAudioPreference());
  const recorded = streams.find((stream) => stream.Type === "Audio" && stream.Index === conversionAudioIndex(item, audioIndex));
  const shown = subtitleShownFor(streams, getSubtitlePreferenceSync(recorded?.Language), recorded?.Language, deviceLanguage());
  const burnSubtitleIndex = subtitleToBurn(item, shown);
  return { ...(audioIndex !== undefined ? { audioIndex } : {}), ...(burnSubtitleIndex !== undefined ? { burnSubtitleIndex } : {}) };
}
