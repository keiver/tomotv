/**
 * convert.ts
 *
 * A download the server re-encodes on the way down: the rung it targets, and the item facts
 * the manifest stores for the H.264/AAC MP4 that lands instead of the source.
 */

import { JELLYFIN_TIME, QUALITY_PRESETS } from "@/services/jellyfin/constants";
import { getQualitySettings } from "@/services/jellyfin/session";
import { isImageBasedSubtitleCodec } from "@/services/jellyfin/subtitles";
import type { JellyfinMediaStream, JellyfinVideoItem } from "@/types/jellyfin";

export const CONVERT_AUDIO_BITRATE = 128000;
/** Auto is a link rule with no cap, and a file has no link, so Auto lands on 1080p. */
const AUTO_RUNG_LABEL = "1080p";

export interface ConversionRung {
  label: string;
  bitrate: number;
  width: number;
  height: number;
}

/** The pinned quality preset, or the Auto rung when the setting carries no cap. */
export async function conversionRung(): Promise<ConversionRung> {
  const quality = await getQualitySettings();
  const preset = quality.width && quality.height ? quality : (QUALITY_PRESETS.find((candidate) => candidate.label === AUTO_RUNG_LABEL) ?? QUALITY_PRESETS[0]);
  return { label: preset.label, bitrate: preset.bitrate, width: preset.width ?? 0, height: preset.height ?? 0 };
}

/** The audio track the server encodes: its default, else its first. */
export function conversionAudioIndex(item: JellyfinVideoItem): number | undefined {
  const audio = (item.MediaStreams ?? []).filter((stream) => stream.Type === "Audio" && stream.Index !== undefined);
  return (audio.find((stream) => stream.IsDefault) ?? audio[0])?.Index;
}

/** Bytes the rung produces over the runtime. Unknown runtime gives 0, which admits itself. */
export function estimatedConvertedBytes(item: JellyfinVideoItem, rung: ConversionRung): number {
  const seconds = (item.RunTimeTicks ?? 0) / JELLYFIN_TIME.TICKS_PER_SECOND;
  return Math.round(((rung.bitrate + CONVERT_AUDIO_BITRATE) * seconds) / 8);
}

/** Source dimensions scaled into the rung the way MaxWidth/MaxHeight scale them, never up. */
function fitted(width: number | undefined, height: number | undefined, rung: ConversionRung): { Width: number; Height: number } {
  if (!width || !height) return { Width: rung.width, Height: rung.height };
  const scale = Math.min(rung.width / width, rung.height / height, 1);
  const even = (value: number) => Math.round((value * scale) / 2) * 2;
  return { Width: even(width), Height: even(height) };
}

/**
 * The item as the converted file is: mp4, one H.264 stream at the rung, one AAC track at the
 * source's channel count capped at two, text subtitles kept for the sidecars, image ones gone.
 * Fields the encode does not fix (profile, level, HDR metadata) are dropped, never invented.
 */
export function convertedItem(item: JellyfinVideoItem, rung: ConversionRung): JellyfinVideoItem {
  const streams = item.MediaStreams ?? [];
  const video = streams.find((stream) => stream.Type === "Video");
  const audioIndex = conversionAudioIndex(item);
  const audio = streams.find((stream) => stream.Type === "Audio" && stream.Index === audioIndex);

  const converted: JellyfinMediaStream[] = [];
  if (video) {
    converted.push({
      Index: video.Index,
      Type: "Video",
      Codec: "h264",
      ...fitted(video.Width, video.Height, rung),
      BitRate: rung.bitrate,
      BitDepth: 8,
      IsInterlaced: false,
      VideoRange: "SDR",
      VideoRangeType: "SDR",
      RealFrameRate: video.RealFrameRate,
      AverageFrameRate: video.AverageFrameRate,
      Language: video.Language,
      IsDefault: video.IsDefault,
    });
  }
  if (audio) {
    const channels = Math.min(audio.Channels ?? 2, 2);
    converted.push({
      Index: audio.Index,
      Type: "Audio",
      Codec: "aac",
      Channels: channels,
      ChannelLayout: channels === 1 ? "mono" : "stereo",
      SampleRate: audio.SampleRate,
      BitRate: CONVERT_AUDIO_BITRATE,
      Language: audio.Language,
      Title: audio.Title,
      IsDefault: true,
    });
  }
  for (const stream of streams) {
    if (stream.Type === "Subtitle" && stream.Index !== undefined && !isImageBasedSubtitleCodec(stream.Codec)) converted.push(stream);
  }

  const source = item.MediaSources?.[0];
  const bitrate = rung.bitrate + CONVERT_AUDIO_BITRATE;
  return {
    ...item,
    Container: "mp4",
    MediaStreams: converted,
    MediaSources: source ? [{ ...source, Container: "mp4", Size: undefined, Bitrate: bitrate, ...(source.MediaStreams ? { MediaStreams: converted } : {}) }] : item.MediaSources,
  };
}
