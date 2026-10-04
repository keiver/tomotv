import { File } from "expo-file-system";

import { engineLog } from "./config";

/**
 * Where an embedded stream sits in its container: the nth of its Type, of how many, and its
 * FFmpeg codec name. A server's stream index is an identity, not a file position.
 */
export interface SourcePosition {
  ordinal: number;
  count: number;
  codec: string;
}

/** One subtitle rendition exactly as the engine will advertise it. */
export type SubtitleRendition = {
  /** Source stream index. The engine keys its decoder, its `sub<N>.m3u8` and its `pgs<N>.json` on this. */
  index: number;
  /** Display label. Carries no identity, but is unique within the group. */
  name: string;
  language: string;
  /** A remote WebVTT, for a sidecar track only: everything in the container is decoded on device. */
  vttUrl: string;
  /** Filesystem path of a track saved with a download; the engine serves those bytes itself. */
  localVtt: string;
  isDefault: boolean;
  isForced: boolean;
  isImage: boolean;
  isExternal?: boolean;
  /** An embedded text track the engine decodes and publishes as WebVTT segments. */
  isEngineText: boolean;
  /** A remote WebVTT of an engine text track, for windows the engine cannot read in time (rung sessions). */
  serverVttUrl?: string;
  /** A remote raw copy of a PGS or DVD track, decoded on device when the source is not being read (rung sessions). */
  serverSupUrl?: string;
  /** Where an embedded track sits in the container; absent for a sidecar and on a live source. */
  source?: SourcePosition;
};

/** A subtitle track as react-native-video reports it through onTextTracks. */
export type ReportedTextTrack = {
  /** The track's position in AVFoundation's legible group, not a stream index. */
  index: number;
  title?: string;
  selected?: boolean;
};

export type SubtitlePick = {
  /** Source stream index of the selected IMAGE track, or null. */
  imageStreamIndex: number | null;
  /** The rendition the ordinal resolved to, for logging. */
  rendition: SubtitleRendition | null;
  /** The ordinal the player reported, when exactly one track was selected. */
  ordinal: number | null;
  /** Why a selection was refused. Absent when there was simply nothing selected. */
  reason?: string;
};

/** A name as the master playlist can carry it: no double quotes, no control characters. */
export function manifestName(name: string): string {
  return name
    .replace(/"/g, "'")
    .replace(/\r\n|[\p{Cc}\p{Cf}]/gu, " ")
    .trim();
}

/** The NAME each rendition is published under, made unique by stream index where labels collide. */
export function publishedRenditionNames(tracks: { name: string; index: number }[]): string[] {
  const used = new Set<string>();
  return tracks.map((track) => {
    const base = manifestName(track.name) || `Track ${track.index}`;
    let name = base;
    let suffix = 1;
    while (used.has(name)) {
      name = `${base} (${track.index}${suffix === 1 ? "" : `-${suffix}`})`;
      suffix += 1;
    }
    used.add(name);
    return name;
  });
}

/**
 * Resolve the viewer's pick in AVKit's own subtitle picker to a source stream.
 *
 * Identity is the rendition's NAME. The engine writes it into the master playlist
 * (Remuxer.masterPlaylist) and AVFoundation hands it back as the option's display
 * title, verbatim (measured on device, published === reported), and the app's
 * labels guarantee no two renditions of a file share one.
 *
 * Identity is NOT the ordinal, which holds only while the legible group carries
 * exactly the members the engine published. iOS does not: the group comes back
 * with two extra options that have no display name, in languages the file does
 * not contain, on every file and never on tvOS. Keying on position refused the
 * lot, which is why a PGS track could be picked in the player and draw nothing.
 * The ordinal survives as a fallback for a group that does match ours member for
 * member, since AVFoundation reports no title at all for some renditions.
 *
 * Two things still refuse rather than resolve, because drawing the wrong
 * subtitles silently is what this whole path exists to stop:
 *
 * - More than one track reports selected. react-native-video decides selection
 *   by comparing display names, so colliding labels mark several at once and
 *   the pick genuinely cannot be read.
 * - An ordinal past the end of the published list.
 *
 * A selection that is simply none of ours draws nothing and says nothing: that
 * is the viewer choosing one of the player's own options, not a discrepancy.
 */
export function resolveSubtitlePick(renditions: SubtitleRendition[], textTracks: ReportedTextTrack[]): SubtitlePick {
  const selected = textTracks.filter((track) => track.selected === true);
  const nothing: SubtitlePick = { imageStreamIndex: null, rendition: null, ordinal: null };

  // Subtitles are simply off. Not a problem, and not worth a reason.
  if (selected.length === 0) return nothing;

  // Nothing published means nothing of ours to draw, whatever the player is
  // offering, and that is not a discrepancy worth reporting. AVFoundation
  // surfaces a legible option with an empty title and no language on a variant
  // that does not declare CLOSED-CAPTIONS=NONE; AVKit shows it as "CC" and it
  // draws nothing. Measured on a file with no subtitle streams at all, which
  // still reported one track.
  if (renditions.length === 0) return nothing;

  if (selected.length > 1) {
    return { ...nothing, reason: `${selected.length} tracks report selected at once, so the pick cannot be read; two renditions are sharing a display name` };
  }

  const ordinal = selected[0].index;
  const title = selected[0].title?.trim() ?? "";
  const names = publishedRenditionNames(renditions);
  const named = title ? renditions.find((_rendition, position) => names[position] === title) : undefined;
  // A text track resolves fine; it just has no bitmaps, because AVKit draws it.
  if (named) return { imageStreamIndex: named.isImage ? named.index : null, rendition: named, ordinal };

  // Same members, same count: position is unambiguous even with no title to go on.
  if (textTracks.length === renditions.length) {
    const rendition = renditions[ordinal];
    if (!rendition) return { ...nothing, reason: `no published rendition at ordinal ${ordinal}` };
    return { imageStreamIndex: rendition.isImage ? rendition.index : null, rendition, ordinal };
  }

  // Named something the engine never published, in a group that is not ours to
  // count: the viewer picked one of the player's own options.
  return nothing;
}

/**
 * One drawable bitmap, positioned in the subtitle canvas's own coordinate
 * space. That space is NOT always the video's: a PGS stream can declare
 * 1280x720 over a 720x480 picture, so the overlay scales from
 * `canvasWidth`/`canvasHeight`, never from the video's dimensions.
 */
export type ImageSubtitleImage = {
  x: number;
  y: number;
  width: number;
  height: number;
  file: string;
};

/**
 * One display set: everything on screen from `time` until the next event.
 *
 * These formats are event-based, not range-based: each display set supersedes
 * the previous one and a set carrying no images is an erase. `images: []` is
 * therefore "nothing on screen", not "missing data". Reading the manifest is
 * simply: take the last event at or before the playhead and draw it.
 *
 * `time` is absolute source seconds, which is what makes it survive the
 * engine's seek-restart timeline relabelling.
 */
export type ImageSubtitleEvent = {
  time: number;
  images: ImageSubtitleImage[];
};

export type ImageSubtitleTrack = {
  streamIndex: number;
  canvasWidth: number;
  canvasHeight: number;
  /**
   * How far the engine's read loop has actually reached, in source seconds.
   *
   * This, and not the last cue's time, is what says whether the manifest is
   * worth asking for again: a film can run ten minutes with no dialogue in it,
   * and the last cue lags the read head by that whole stretch.
   */
  demuxedUpTo: number;
  /** The engine reached the end of this stream; the event list is final. */
  complete: boolean;
  events: ImageSubtitleEvent[];
};

/** The manifest a download wrote next to its media, or null before it has any. */
async function readLocalManifest(url: string): Promise<string | null> {
  try {
    const file = new File(url);
    return file.exists ? await file.text() : null;
  } catch (error) {
    engineLog().debug("Local image subtitle manifest unreadable", { service: "LocalRemux", error: String(error) });
    return null;
  }
}

/** Base URL of a session's loopback directory, e.g. `http://127.0.0.1:PORT/token/`. */
export function sessionBaseUrl(masterUrl: string | null | undefined): string | null {
  if (!masterUrl) return null;
  const cut = masterUrl.lastIndexOf("/");
  return cut > 0 ? masterUrl.slice(0, cut + 1) : null;
}

/** Absolute URL for one of a track's cue images. */
export function imageSubtitleUrl(masterUrl: string | null | undefined, file: string): string | null {
  const base = sessionBaseUrl(masterUrl);
  return base ? `${base}${file}` : null;
}

/**
 * Absolute URL of the keyframe the engine makes for a chapter, under a session's or a frame
 * provider's base. The time rides in the name in milliseconds: the loopback server strips queries.
 */
export function chapterFrameUrl(baseUrl: string | null | undefined, seconds: number): string | null {
  if (!baseUrl) return null;
  return `${baseUrl}frame-${Math.max(0, Math.round(seconds * 1000))}.jpg`;
}

/**
 * Fetch the display-set manifest for an image subtitle track from the running
 * session.
 *
 * The engine harvests display sets as it demuxes, so this grows during playback
 * and is refetched rather than cached forever. Returns null when the session is
 * gone or the track carries nothing.
 */
export async function fetchImageSubtitleTrack(masterUrl: string | null | undefined, streamIndex: number): Promise<ImageSubtitleTrack | null> {
  const base = sessionBaseUrl(masterUrl);
  if (!base) return null;
  try {
    // A held file's sets were decoded at download and sit beside it; only a live session
    // serves them over loopback, and RN's fetch does not read file: URLs.
    const url = `${base}pgs${streamIndex}.json`;
    const body = url.startsWith("file://") ? await readLocalManifest(url) : await (await fetch(url)).text();
    if (!body) return null;
    const track = JSON.parse(body) as ImageSubtitleTrack;
    if (!Array.isArray(track?.events)) return null;
    // An engine build without these reports nothing rather than lying: no
    // progress and never complete keeps the caller polling, which is the old
    // behaviour rather than a silent stop.
    return { ...track, demuxedUpTo: typeof track.demuxedUpTo === "number" ? track.demuxedUpTo : 0, complete: track.complete === true };
  } catch (error) {
    engineLog().debug("Image subtitle manifest fetch failed", { service: "LocalRemux", streamIndex, error: String(error) });
    return null;
  }
}

/**
 * The images on screen at `time`: the last display set at or before it.
 *
 * No end times are involved, because the format does not carry any. An erase
 * set resolves to an empty array, which is the format saying "nothing here",
 * so a track re-enabled mid-playback paints correctly at once instead of
 * waiting for the next set to arrive.
 */
export function imagesAt(events: ImageSubtitleEvent[], time: number): ImageSubtitleImage[] {
  let low = 0;
  let high = events.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (events[mid].time <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found < 0 ? [] : events[found].images;
}
