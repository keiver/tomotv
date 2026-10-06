/**
 * convert.ts
 *
 * A download the server re-encodes on the way down: the rung it targets, and the item facts
 * the manifest stores for the H.264/AAC MP4 that lands instead of the source.
 */

import { JELLYFIN_TIME, QUALITY_PRESETS } from "@/services/jellyfin/constants";
import { isDvdSubCodec, isImageBasedSubtitleCodec, isPgsCodec } from "@/services/jellyfin/subtitles";
import type { JellyfinMediaStream, JellyfinVideoItem } from "@/types/jellyfin";

export const CONVERT_AUDIO_BITRATE = 128000;
/** The sizes a download offers under Original, largest first. */
const DOWNLOAD_RUNG_LABELS = ["1080p", "720p", "480p"];

export interface ConversionRung {
  label: string;
  bitrate: number;
  width: number;
  height: number;
}

const toRung = (preset: (typeof QUALITY_PRESETS)[number]): ConversionRung => ({ label: preset.label, bitrate: preset.bitrate, width: preset.width ?? 0, height: preset.height ?? 0 });
/** Built on use, not at import: the manager imports this module, and nothing here should run then. */
const ladder = (): ConversionRung[] =>
  DOWNLOAD_RUNG_LABELS.map((label) => QUALITY_PRESETS.find((preset) => preset.label === label))
    .filter((preset) => preset !== undefined)
    .map(toRung);

/**
 * The rungs worth offering for one item: ones its video fills across or down (a letterboxed
 * 1920x1040 film is 1080p) and, when `mustShrink`, under its video bitrate, which is the test
 * Jellyfin's CanStreamCopyVideo applies before it re-encodes. Without `mustShrink` (the original
 * cannot be kept anyway) the lowest rung always stands.
 */
export function downloadRungs(item: JellyfinVideoItem, mustShrink = true): ConversionRung[] {
  const video = (item.MediaStreams ?? []).find((stream) => stream.Type === "Video");
  const width = video?.Width ?? 0;
  const height = video?.Height ?? 0;
  const bitrate = video?.BitRate ?? item.MediaSources?.[0]?.Bitrate ?? 0;
  const rungs = ladder();
  const fitting = rungs.filter((rung) => (rung.width <= width || rung.height <= height) && (!mustShrink || bitrate === 0 || rung.bitrate < bitrate));
  if (mustShrink) return video ? fitting : [];
  return fitting.length > 0 ? fitting : [rungs[rungs.length - 1]];
}

/** The audio track the server encodes: the one picked at download time when it exists, else the default, else the first. */
export function conversionAudioIndex(item: JellyfinVideoItem, picked?: number): number | undefined {
  const audio = (item.MediaStreams ?? []).filter((stream) => stream.Type === "Audio" && stream.Index !== undefined);
  return (audio.find((stream) => stream.Index === picked) ?? audio.find((stream) => stream.IsDefault) ?? audio[0])?.Index;
}

/**
 * The shown track, when it is a bitmap Jellyfin burns into the picture: PGS, DVD or DVB, each measured.
 * A text track rides as a sidecar instead; XSUB and teletext Jellyfin files as text and cannot burn.
 */
export function subtitleToBurn(item: JellyfinVideoItem, shown: number | undefined): number | undefined {
  const stream = (item.MediaStreams ?? []).find((candidate) => candidate.Type === "Subtitle" && candidate.Index === shown);
  const codec = (stream?.Codec ?? "").toLowerCase();
  return isPgsCodec(codec) || isDvdSubCodec(codec) || codec === "dvbsub" || codec === "dvb_subtitle" ? shown : undefined;
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
 * source's channel count capped at two, text subtitles kept for the sidecars, bitmap ones gone (the
 * shown one may be burned into the picture).
 * Fields the encode does not fix (profile, level, HDR metadata) are dropped, never invented.
 */
export function convertedItem(item: JellyfinVideoItem, rung: ConversionRung, pickedAudio?: number): JellyfinVideoItem {
  const streams = item.MediaStreams ?? [];
  const video = streams.find((stream) => stream.Type === "Video");
  const audioIndex = conversionAudioIndex(item, pickedAudio);
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
