/**
 * Pure formatters for the Video Info panel. Runtime formatting lives in
 * services/jellyfin/media.ts (formatDuration); these cover the rest of the
 * technical readout. All return "" for absent input so callers can join and
 * filter without null checks.
 */
import { JellyfinItem, JellyfinMediaStream } from "@/types/jellyfin";
import { formatIndexBadge, type SeasonEpisodeSource } from "./seasonEpisode";

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
 * The panel's wording for whatever index an item carries: "S01E05" for an episode,
 * "Disc 2 · Track 5" for a tagged song ("Track 5" when the file names no disc).
 *
 * Rendered from formatIndexBadge, the same call the cards badge from, so a card and
 * the panel can never disagree about what a number means. "" when there is no index.
 *
 * Imports one-way, mediaInfo → seasonEpisode: seasonEpisode reaching back for joinMeta
 * would make the pair circular.
 */
export function formatIndexLine(item: SeasonEpisodeSource): string {
  const badge = formatIndexBadge(item);
  if (badge === null) return "";
  if (badge.kind === "seasonEpisode") return badge.label;
  // Track 0 is a real tag, so the parts are built by presence, not truthiness.
  return joinMeta([badge.disc != null ? `Disc ${badge.disc}` : "", `Track ${badge.label}`]);
}

/** "4032×3024 · 12.2 MP" from a photo's pixel dimensions. */
export function formatPixelSize(width: number | undefined, height: number | undefined): string {
  if (!width || !height || width <= 0 || height <= 0) return "";
  const megapixels = (width * height) / 1_000_000;
  return joinMeta([`${width}×${height}`, megapixels >= 0.1 ? `${megapixels.toFixed(1)} MP` : ""]);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "19 Aug 2026" from a Jellyfin ISO timestamp. Read off the string rather than
 * through Intl: the panel is the only caller, and a fixed format cannot depend
 * on which locale data a given Hermes build ships.
 */
export function formatMediaDate(iso: string | undefined): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "";
  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];
  if (!name) return "";
  return `${Number(day)} ${name} ${year}`;
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

/** One labelled fact in the panel's Details table. */
export interface DetailRow {
  label: string;
  value: string;
}

/**
 * EXIF exposure settings, each rendered only if the file carries it.
 *
 * ExposureTime is seconds, so sub-second values are shown as the shutter
 * fraction photographers read. `Aperture` and `ShutterSpeed` are the raw EXIF
 * ApertureValue and ShutterSpeedValue, which are APEX — Jellyfin assigns them
 * straight off the rational (Emby.Photos/PhotoProvider.cs). f = sqrt(2^APEX)
 * and seconds = 1/2^APEX; printing either raw would put "4.6" where an f-stop
 * belongs.
 */
export function formatExposure(item: Pick<JellyfinItem, "ExposureTime" | "FocalLength" | "Aperture" | "ShutterSpeed" | "IsoSpeedRating">): string {
  const seconds = item.ExposureTime ?? (item.ShutterSpeed != null ? 1 / 2 ** item.ShutterSpeed : undefined);
  const shutter = seconds == null || seconds <= 0 ? "" : seconds >= 1 ? `${Math.round(seconds * 10) / 10}s` : `1/${Math.round(1 / seconds)}s`;
  const fNumber = item.Aperture != null && item.Aperture > 0 ? Math.sqrt(2 ** item.Aperture) : undefined;
  return joinMeta([item.FocalLength ? `${Math.round(item.FocalLength)}mm` : "", fNumber ? `ƒ/${Math.round(fNumber * 10) / 10}` : "", shutter, item.IsoSpeedRating ? `ISO ${item.IsoSpeedRating}` : ""]);
}

/** "37.7749°N, 122.4194°W · 18 m" from EXIF GPS. Altitude alone is not a location. */
export function formatCoordinates(latitude: number | undefined, longitude: number | undefined, altitude: number | undefined): string {
  if (latitude == null || longitude == null) return "";
  const pair = `${Math.abs(latitude).toFixed(4)}°${latitude >= 0 ? "N" : "S"}, ${Math.abs(longitude).toFixed(4)}°${longitude >= 0 ? "E" : "W"}`;
  return joinMeta([pair, altitude ? `${Math.round(altitude)} m` : ""]);
}

/**
 * The server sends `0001-01-01` for a folder that has never had media added,
 * and rendering it as a date puts "1 Jan 1" on screen.
 */
function realDate(iso: string | undefined): string {
  if (!iso || iso.startsWith("0001-01-01")) return "";
  return formatMediaDate(iso);
}

/** "12 photos" / "1 episode" — counts read as what they contain, not as a bare number. */
function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Every fact the server holds about an item that the panel does not already show
 * as artwork, overview, cast or a stream row — built from whatever is populated,
 * so each item kind contributes what it has and nothing renders an empty row.
 *
 * Photos and folders exist here specifically: neither carries media streams, so
 * without this table their panels are a picture and a title.
 *
 * `dimensionsShownElsewhere` drops the dimensions row when the panel already
 * states the resolution above — a photo's summary line, or a Video stream row
 * that gives it in more detail.
 */
export function buildDetailRows(item: JellyfinItem, options: { dimensionsShownElsewhere: boolean }): DetailRow[] {
  const childCount = item.RecursiveItemCount ?? item.ChildCount;
  const unplayed = item.UserData?.UnplayedItemCount;
  const playCount = item.UserData?.PlayCount ?? 0;
  const contentNoun = item.Type === "PhotoAlbum" ? "photo" : item.Type === "Series" || item.Type === "Season" ? "episode" : "item";
  // Only the track kind: on an Episode the same two fields are the season and the
  // episode, and the badge is what knows the difference. A Jellyfin Audio item holds
  // no total-track count (that lives on the parent album), so neither row says "of N".
  const index = formatIndexBadge(item);
  const track = index?.kind === "track" ? index : null;

  const rows: DetailRow[] = [
    { label: "Dimensions", value: options.dimensionsShownElsewhere ? "" : formatPixelSize(item.Width, item.Height) },
    { label: "Album", value: item.Album ?? "" },
    { label: "Artist", value: item.Artists?.join(", ") ?? item.AlbumArtist ?? "" },
    { label: "Disc", value: track?.disc != null ? String(track.disc) : "" },
    { label: "Track", value: track ? String(track.label) : "" },
    { label: "Studio", value: item.SeriesStudio ?? "" },
    { label: "Contains", value: childCount ? joinMeta([countLabel(childCount, contentNoun), unplayed ? `${unplayed} unplayed` : ""]) : "" },
    { label: "Camera", value: joinMeta([item.CameraMake, item.CameraModel]) },
    { label: "Exposure", value: formatExposure(item) },
    { label: "Software", value: item.Software ?? "" },
    { label: "Orientation", value: item.ImageOrientation ?? "" },
    { label: "Location", value: formatCoordinates(item.Latitude, item.Longitude, item.Altitude) },
    { label: "Original title", value: item.OriginalTitle && item.OriginalTitle !== item.Name ? item.OriginalTitle : "" },
    { label: "Filmed in", value: item.ProductionLocations?.join(" · ") ?? "" },
    { label: "Tags", value: item.Tags?.join(" · ") ?? "" },
    { label: "Released", value: realDate(item.PremiereDate) },
    { label: "Added", value: realDate(item.DateCreated) },
    { label: "Latest media", value: realDate(item.DateLastMediaAdded) },
    { label: "Last played", value: realDate(item.UserData?.LastPlayedDate) },
    { label: "Plays", value: playCount > 0 ? countLabel(playCount, "play") : "" },
    { label: "Lyrics", value: item.HasLyrics ? "Included" : "" },
  ];
  return rows.filter((row) => row.value !== "");
}
