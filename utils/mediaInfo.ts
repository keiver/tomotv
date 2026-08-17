/**
 * Pure formatters for the Video Info panel. Runtime formatting lives in
 * services/jellyfin/media.ts (formatDuration); these cover the rest of the
 * technical readout. All return "" for absent input so callers can join and
 * filter without null checks.
 */
import { JellyfinMediaStream } from "@/types/jellyfin";

/** "1.72 GB" / "830 MB" from a byte count. */
export function formatFileSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** "16.3 Mbps" / "628 kbps" from bits per second. */
export function formatBitrate(bps: number | undefined): string {
  if (!bps || bps <= 0) return "";
  const mbps = bps / 1_000_000;
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

/** Joins the truthy parts with the panel's separator. */
export function joinMeta(parts: (string | undefined | null | false)[]): string {
  return parts.filter(Boolean).join(" · ");
}

/**
 * One technical detail line per stream, type-aware. The headline is the
 * server-built DisplayTitle; this is the row beneath it.
 * Video:   "HEVC · Main 10 · 3840×1600 · 23.976 fps · HDR10 · 10-bit"
 * Audio:   "TRUEHD · 7.1 · 48 kHz · 24-bit · 3.2 Mbps"
 * Subtitle:"PGSSUB · eng · Forced"
 */
export function streamDetailLine(stream: JellyfinMediaStream): string {
  const codec = stream.Codec ? stream.Codec.toUpperCase() : "";
  if (stream.Type === "Video") {
    const fps = stream.RealFrameRate ?? stream.AverageFrameRate;
    return joinMeta([
      codec,
      stream.Profile,
      stream.Width && stream.Height ? `${stream.Width}×${stream.Height}` : "",
      fps ? `${Math.round(fps * 1000) / 1000} fps` : "",
      stream.VideoRangeType && stream.VideoRangeType !== "SDR" && stream.VideoRangeType !== "Unknown" ? stream.VideoRangeType : "",
      stream.BitDepth ? `${stream.BitDepth}-bit` : "",
      formatBitrate(stream.BitRate),
    ]);
  }
  if (stream.Type === "Audio") {
    return joinMeta([
      codec,
      stream.ChannelLayout || (stream.Channels ? `${stream.Channels}ch` : ""),
      stream.SampleRate ? `${stream.SampleRate / 1000} kHz` : "",
      stream.BitDepth ? `${stream.BitDepth}-bit` : "",
      formatBitrate(stream.BitRate),
      stream.Language,
    ]);
  }
  return joinMeta([codec, stream.Language, stream.IsForced && "Forced", stream.IsExternal && "External"]);
}
