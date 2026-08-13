/**
 * localRemux.ts
 *
 * Service for the on-device remux engine (native/ios/LocalRemuxer).
 *
 * The engine reads the original file straight from Jellyfin, rewraps the video
 * and one audio track into fMP4 HLS on the device, and serves it over loopback
 * HTTP. AVPlayer plays that with its native transport controls, so a file the
 * server would otherwise transcode plays at original quality with no server
 * transcode session at all.
 *
 * Codecs AVPlayer decodes natively (REMUXABLE_CODECS) are copied verbatim.
 * Codecs it cannot decode at all (TRANSCODABLE_VIDEO_CODECS) are decoded in
 * software and re-encoded to H.264 by VideoToolbox on the way through
 * (native/ios/LocalRemuxer/VideoTranscoder.swift), gated by resolution, bit
 * depth and interlacing below. Anything else still goes through the server.
 */

import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { REMUXABLE_CODECS } from "@/constants/codecs";
import { getVideoStreamUrl, getSubtitleUrl, isImageBasedSubtitleCodec, JELLYFIN_TIME } from "@/services/jellyfinApi";
import type { JellyfinMediaStream, JellyfinVideoItem } from "@/types/jellyfin";
import { probeEmit } from "@/services/playbackProbe";
import { logger } from "@/utils/logger";

const { LocalRemuxer } = NativeModules;
/** Same, but only on hardware that reports AV1 decode support at runtime. */
const AV1_CODECS = ["av1", "av01"];

/**
 * Video codecs AVPlayer cannot decode but the on-device engine can transcode
 * to H.264 (software decode + VideoToolbox encode). Every entry was verified
 * REGISTERED in the linked FFmpeg build via av_codec_iterate — not by symbol:
 * the archive contains object files for codecs that were never enabled
 * (msmpeg4v1-3 are in there as wmv1/wmv2 dependencies but
 * avcodec_find_decoder returns NULL for them, so DivX 3 stays on the server
 * path). Substring matching covers family variants (h263p/i, wmv1/2/3,
 * vp6/vp6f/vp6a, rv10-40, mpeg1video). Theora, DV and Cinepak are not in the
 * build and are deliberately absent.
 */
const TRANSCODABLE_VIDEO_CODECS = ["vp8", "vp9", "vp7", "mpeg1video", "mpeg1", "mpeg2video", "mpeg2", "mpeg4", "wmv", "vc1", "h263", "flv1", "rv10", "rv20", "rv30", "rv40", "vp6", "svq3"];

/**
 * On-device transcode is only attempted below this pixel count. The Apple TV
 * measured 7.63x realtime at 2048x858 (1.76 Mpx); 4K extrapolates to ~1.6x,
 * too close to the stall line, and 8K failed outright. 2_100_000 admits
 * 1920x1080 and the measured file, excludes 4K.
 */
const TRANSCODE_MAX_PIXELS = 2_100_000;

/**
 * Audio codecs the engine can carry. AAC, ALAC, AC-3, E-AC-3 and well-formed
 * FLAC are copied verbatim; everything else here, MP3 included, is decoded and
 * re-encoded to FLAC on device (native/ios/LocalRemuxer/AudioTranscoder.swift),
 * which is what lets DTS and TrueHD files play locally at all, since AVPlayer
 * cannot decode either.
 *
 * Anything not listed has no decoder in the linked FFmpeg build and stays on
 * the server path. `npm run probe:codecs` prints what the build actually
 * registers; do not infer it from symbols, since the static archives carry
 * object files for codecs that were never enabled.
 */
const REMUXABLE_AUDIO_CODECS = [
  // copied through untouched
  "aac",
  "mp4a",
  "alac",
  // Copied too, and the only formats that leave the device still compressed:
  // Apple TV can bitstream AC-3 and E-AC-3 to a receiver, and Atmos rides inside
  // E-AC-3 as JOC side data, so copying is what preserves it.
  "ac3",
  "ac-3",
  "eac3",
  "ec-3",
  // decoded and re-encoded on device. MP3 is here rather than copied: Apple HLS
  // allows MP3 audio only in MPEG-TS segments, and AVPlayer refuses fMP4 with an
  // .mp3 sample entry outright ("Cannot Open").
  "mp3",
  "dts",
  "dca",
  "truehd",
  "mlp",
  "opus",
  "vorbis",
  "flac",
  "pcm",
  // companions of the transcodable video codecs, decoders verified registered
  // via av_codec_iterate: MPEG-2 content carries MP2, WMV carries WMA
  // (v1/v2/Pro/Lossless all match "wma"), RealMedia carries Cook, 3GP carries
  // AMR ("amr" matches amrnb/amrwb). RealAudio sipr/atrac have no decoder in
  // the build and correctly stay excluded.
  "mp2",
  "wma",
  "cook",
  "amr",
];

/**
 * One stream as the engine sees it, either on the way in or out of an encoder.
 * Every field past `codec` is optional because the native side omits what the
 * codec parameters do not carry rather than inventing a zero.
 */
export interface EngineStreamPlan {
  codec: string;
  /** "Dolby Digital Plus + Dolby Atmos" for a JOC stream. */
  profile?: string;
  bitRate?: number;
  channels?: number;
  layout?: string;
  sampleRate?: number;
  bitDepth?: number;
  sampleFormat?: string;
  width?: number;
  height?: number;
}

/** What the engine decided for one input stream. */
export interface EngineTrackPlan {
  streamIndex: number;
  /** "primary" or the alternate rendition prefix ("a0", "a1"…). Audio only. */
  rendition?: string;
  action: "copy" | "encode";
  /** FFmpeg's name for the encoder that opened; absent on a copy. */
  encoder?: string;
  source: EngineStreamPlan;
  output?: EngineStreamPlan;
}

/** Emitted once per session, as soon as the engine has decided. */
export interface EnginePlan {
  token: string;
  video: EngineTrackPlan;
  audio: EngineTrackPlan[];
}

function describeStream(stream: EngineStreamPlan): string {
  return [stream.codec, stream.layout, stream.bitDepth ? `${stream.bitDepth}-bit` : null, stream.profile ? `(${stream.profile})` : null].filter(Boolean).join(" ");
}

function describeTrack(track: EngineTrackPlan): string {
  const source = describeStream(track.source);
  if (track.action === "copy" || !track.output) return `${source} -> copy`;
  return `${source} -> ${track.encoder ?? "encode"} ${describeStream(track.output)}`;
}

/**
 * Subscribed once for the runtime's lifetime, never torn down. Per-session
 * subscribe/unsubscribe would be worse: the native side replays the last plan
 * to a fresh listener (so a Metro reload mid-playback still sees it), and a
 * listener attached at the start of a NEW session would be handed the previous
 * session's plan before the new one exists.
 */
let planSubscription: { remove: () => void } | null = null;

function watchEnginePlan(): void {
  if (planSubscription || !isLocalRemuxAvailable()) return;
  const emitter = new NativeEventEmitter(LocalRemuxer);
  planSubscription = emitter.addListener("onEnginePlan", (plan: EnginePlan) => {
    // The engine's own account of what it did, which is the only one that
    // reaches a physical Apple TV: NSLog does not, and probing the output
    // stream infers rather than reports.
    logger.info("Local remux engine plan", {
      service: "LocalRemux",
      video: describeTrack(plan.video),
      audio: plan.audio.map(describeTrack),
    });
    probeEmit("enginePlan", { video: plan.video, audio: plan.audio });
  });
}

/** Cached capability probe; AV1 decode is hardware-dependent (never on Apple TV). */
let av1Supported: boolean | null = null;

export function isLocalRemuxAvailable(): boolean {
  return Platform.OS === "ios" && !!LocalRemuxer?.startRemux;
}

async function supportsAV1(): Promise<boolean> {
  if (av1Supported !== null) return av1Supported;
  if (!isLocalRemuxAvailable()) {
    av1Supported = false;
    return false;
  }
  try {
    av1Supported = (await LocalRemuxer.isAV1HardwareDecodeSupported()) === true;
  } catch {
    av1Supported = false;
  }
  return av1Supported;
}

/**
 * Whether this item can play through the local remux engine — either
 * stream-copied (H.264/HEVC, gated AV1) or transcoded on device
 * (TRANSCODABLE_VIDEO_CODECS under the resolution/bit-depth/interlace gates).
 * Burn-in files keep the server path: it has to render subtitles into the
 * picture.
 *
 * These gates are a fast heuristic over Jellyfin metadata; the native layer
 * re-checks the decoder's actual pixel format and field order at session
 * start, and a failure there falls back to the server transcode. A wrong gate
 * costs seconds, never a dead playback.
 */
/**
 * Every declined file logs its reason: a decline sends playback to the server
 * HLS lane, and an unexplained lane switch is exactly what made the 2026-08-10
 * subtitle-desync session undiagnosable after the fact.
 */
function declineRemux(reason: string, detail?: Record<string, unknown>): false {
  logger.debug("Local remux declined", { service: "LocalRemux", reason, ...detail });
  return false;
}

/**
 * Image-based subtitles no longer decline. The engine decodes them to timed
 * bitmaps the app draws itself, so a Blu-ray remux whose only disqualification
 * was that its subtitles are pictures now reaches the engine with its video
 * copied and its lossless audio intact, instead of being re-encoded end to end
 * by the server purely to paint text into the frames.
 */
export async function canRemuxLocally(videoItem: JellyfinVideoItem | null): Promise<boolean> {
  if (!isLocalRemuxAvailable()) {
    // On iOS/tvOS the module should always exist; its absence means a broken
    // build, so this one decline is a warning rather than a debug line.
    logger.warn("Local remux declined: native module unavailable", { service: "LocalRemux" });
    return false;
  }
  if (!videoItem?.MediaStreams) return declineRemux("no media streams");

  const videoStream = videoItem.MediaStreams.find((stream) => stream.Type === "Video");
  if (!videoStream?.Codec) return declineRemux("no video codec in metadata");
  const codec = videoStream.Codec.toLowerCase();

  // Audio is either copied or re-encoded to AAC on device; only codecs the
  // linked FFmpeg has no decoder for stay on the server path. Multi-track
  // files are fine: each extra track becomes its own HLS audio rendition, so
  // switching still works and still costs the server nothing.
  //
  // Prefix match, not substring: family variants still match ("pcm_s16le",
  // "wmav2", "mp4a.40.2"), but unrelated codecs that merely CONTAIN an entry
  // ("atrac3" contains "ac3") no longer slip through.
  const audioTracks = videoItem.MediaStreams.filter((stream) => stream.Type === "Audio");
  const everyTrackCarriable = audioTracks.every((track) => {
    const audioCodec = track.Codec?.toLowerCase();
    return !audioCodec || REMUXABLE_AUDIO_CODECS.some((known) => audioCodec.startsWith(known));
  });
  if (!everyTrackCarriable) {
    return declineRemux("audio codec not carriable", { codecs: audioTracks.map((track) => track.Codec ?? "unknown").join(", ") });
  }

  if (!videoItem.RunTimeTicks || videoItem.RunTimeTicks <= 0) return declineRemux("no runtime in metadata");

  // Prefix match everywhere, same reason as the audio list: family variants
  // match ("hvc1", "wmv3", "vp6f"), codecs that merely CONTAIN an entry do not
  // ("msmpeg4v3" contains "mpeg4" but has no registered decoder).
  if (REMUXABLE_CODECS.some((known) => codec.startsWith(known))) return true;
  if (AV1_CODECS.some((known) => codec.startsWith(known))) return (await supportsAV1()) || declineRemux("no AV1 hardware decode", { codec });

  // Exotic codecs: decoded and re-encoded to H.264 on device. Three gates,
  // each driven by a hard constraint, not taste:
  // - pixel count: measured Apple TV throughput headroom (TRANSCODE_MAX_PIXELS)
  // - bit depth: h264_videotoolbox accepts 8-bit yuv420p/nv12 only, and no
  //   libswscale is linked to convert
  // - interlacing: no deinterlacer in the build; the server path has one
  if (TRANSCODABLE_VIDEO_CODECS.some((known) => codec.startsWith(known))) {
    const width = videoStream.Width ?? 0;
    const height = videoStream.Height ?? 0;
    if (width <= 0 || height <= 0 || width * height > TRANSCODE_MAX_PIXELS) return declineRemux("resolution over transcode gate", { codec, width, height });
    if ((videoStream.BitDepth ?? 8) > 8) return declineRemux("bit depth over 8-bit", { codec, bitDepth: videoStream.BitDepth });
    if (videoStream.IsInterlaced === true) return declineRemux("interlaced source", { codec });
    return true;
  }

  return declineRemux("video codec unsupported", { codec });
}

/** One subtitle rendition exactly as the engine will advertise it. */
export type SubtitleRendition = {
  /** Source stream index. The engine keys its decoder, its `sub<N>.m3u8` and its `pgs<N>.json` on this. */
  index: number;
  /** Display label. Carries no identity, but is unique within the group — see subtitleLabels(). */
  name: string;
  language: string;
  /** Jellyfin's WebVTT for a text track; empty for an image track, which the engine decodes itself. */
  vttUrl: string;
  isDefault: boolean;
  isForced: boolean;
  isImage: boolean;
};

/**
 * Display labels for a file's subtitle renditions, in playlist order.
 *
 * Labels carry no identity — the rendition's ORDINAL does — but they still
 * cannot repeat. react-native-video decides which track is selected by
 * comparing display names (RCTVideoUtils.getTextTrackInfo), so two tracks
 * sharing a label are both reported selected and the pick becomes unreadable.
 *
 * Jellyfin's DisplayTitle cannot be relied on to differ. A Blu-ray remux with
 * 13 PGS tracks that carry neither a name nor a language yields the identical
 * "Undefined - PGSSUB" for all 13. A track with no identity of its own is
 * therefore labelled by position, which is both distinct and something a
 * viewer can act on; "Undefined" reads as a bug.
 */
function subtitleLabels(streams: JellyfinMediaStream[]): string[] {
  const labels = streams.map((stream, position) => {
    const language = stream.Language?.trim() ?? "";
    const named = Boolean(stream.Title?.trim()) || (language !== "" && language !== "und");
    if (!named) return `Track ${position + 1}`;
    return stream.DisplayTitle?.trim() || stream.Title?.trim() || language;
  });

  // Anything still repeated after that — two tracks genuinely both called
  // "English", which real discs do ship — is disambiguated by position.
  const occurrences = new Map<string, number>();
  for (const label of labels) occurrences.set(label, (occurrences.get(label) ?? 0) + 1);
  return labels.map((label, position) => ((occurrences.get(label) ?? 0) > 1 ? `${label} (${position + 1})` : label));
}

/**
 * The subtitle renditions the engine will publish, in master playlist order.
 *
 * The ORDER is load-bearing. The app resolves the viewer's pick by the
 * rendition's position in AVFoundation's legible group and maps it straight
 * back to `index` here, so the two sides must build this list identically.
 * That is the whole reason this is one exported function rather than the same
 * expression written in two files: it used to be, they were keyed on the
 * display label, and every untagged track on a disc collapsed onto the last
 * one because a Map built from duplicate keys keeps only the final value.
 *
 * Text subtitles ride as renditions served straight from Jellyfin. Image ones
 * (PGS, DVD/VobSub, DVB, XSUB) ride as renditions too, but Jellyfin has no
 * WebVTT to give for a bitmap: the engine decodes them out of the source file,
 * the rendition resolves to a cue-less playlist so AVKit lists the track and
 * draws none of it, and the app paints the bitmaps.
 */
export function subtitleRenditions(videoItem: JellyfinVideoItem): SubtitleRendition[] {
  const shipped = (videoItem.MediaStreams ?? [])
    .filter((stream) => stream.Type === "Subtitle" && stream.Index !== undefined)
    .map((stream) => {
      const isImage = isImageBasedSubtitleCodec(stream.Codec);
      return { stream, isImage, vttUrl: isImage ? "" : getSubtitleUrl(videoItem.Id, stream.Index as number, "vtt") };
    })
    .filter((entry) => entry.isImage || entry.vttUrl.length > 0);

  const labels = subtitleLabels(shipped.map((entry) => entry.stream));

  // RFC 8216 §4.3.4.1: a rendition group MUST NOT carry more than one member
  // with DEFAULT=YES, and Matroska is happy to flag several subtitle tracks as
  // default at once. AVFoundation rejects a malformed group by refusing the
  // whole master playlist (-12642), which loses the file, not just its
  // subtitles. First default wins. Remuxer.masterPlaylist() holds the same line
  // because the invariant belongs to the playlist, not to this caller.
  const firstDefault = shipped.findIndex((entry) => entry.stream.IsDefault === true);

  return shipped.map((entry, position) => ({
    index: entry.stream.Index as number,
    name: labels[position],
    language: entry.stream.Language || "und",
    vttUrl: entry.vttUrl,
    isDefault: position === firstDefault,
    // Forced tracks used to be burned into the picture. They are renditions
    // now, so the flag has to reach the master playlist.
    isForced: entry.stream.IsForced === true,
    isImage: entry.isImage,
  }));
}

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

/**
 * Resolve the viewer's pick in AVKit's own subtitle picker to a source stream.
 *
 * Identity is the ordinal: react-native-video numbers a track by its position
 * in AVFoundation's legible group (RCTVideoUtils.getTextTrackInfo), and the
 * engine publishes renditions in the order of `renditions`. No string is
 * matched, because display labels are not unique — a disc's untagged PGS tracks
 * all come back from Jellyfin with the same one.
 *
 * That mapping is only sound while the group and the published list are the
 * same members in the same order, which AVFoundation does not document. So both
 * ways it can break are checked, and either one REFUSES rather than resolving:
 *
 * - More than one track reports selected. react-native-video decides selection
 *   by comparing display names, so colliding labels mark several at once and
 *   the pick genuinely cannot be read.
 * - The counts disagree, which is what would happen if the group filtered
 *   anything out (a forced rendition, say) and shifted every ordinal after it.
 *
 * Drawing nothing and saying why is recoverable. Drawing the wrong subtitles
 * silently is what this whole path exists to stop.
 */
export function resolveSubtitlePick(renditions: SubtitleRendition[], textTracks: ReportedTextTrack[]): SubtitlePick {
  const selected = textTracks.filter((track) => track.selected === true);
  const nothing: SubtitlePick = { imageStreamIndex: null, rendition: null, ordinal: null };

  // Subtitles are simply off. Not a problem, and not worth a reason.
  if (selected.length === 0) return nothing;

  if (selected.length > 1) {
    return { ...nothing, reason: `${selected.length} tracks report selected at once, so the pick cannot be read; two renditions are sharing a display name` };
  }
  if (textTracks.length !== renditions.length) {
    return { ...nothing, reason: `player reports ${textTracks.length} subtitle tracks but the engine published ${renditions.length}, so ordinals do not line up` };
  }

  const ordinal = selected[0].index;
  const rendition = renditions[ordinal];
  if (!rendition) return { ...nothing, reason: `no published rendition at ordinal ${ordinal}` };

  // A text track resolves fine; it just has no bitmaps, because AVKit draws it.
  return { imageStreamIndex: rendition.isImage ? rendition.index : null, rendition, ordinal };
}

/**
 * Start a remux session and return the loopback HLS URL for the player.
 * Throws when the native module is unavailable or the session cannot start;
 * callers fall back to the server transcode path.
 */
export async function startLocalRemux(videoItem: JellyfinVideoItem, preferredAudioStreamIndex?: number): Promise<string> {
  if (!isLocalRemuxAvailable()) {
    throw new Error("Local remux native module not available on this platform");
  }

  // Same untouched original file the direct-play path uses; FFmpeg reads it
  // with byte ranges, so seeking never re-downloads from the start.
  const inputUrl = getVideoStreamUrl(videoItem.Id, videoItem);
  const durationSeconds = (videoItem.RunTimeTicks ?? 0) / JELLYFIN_TIME.TICKS_PER_SECOND;

  // Ordering is the only channel to the native side: position 0 is marked
  // DEFAULT=YES in the master playlist, so putting a track first IS the
  // selection, and a user-selected track (audio switch restart) outranks
  // Jellyfin's default. How position 0 is served is the native side's call:
  // a lone track is muxed with the video; several tracks each get their own
  // audio-only rendition (stable picker labels — see Remuxer.masterPlaylist()).
  const audioTracks = (videoItem.MediaStreams ?? [])
    .filter((stream) => stream.Type === "Audio" && stream.Index !== undefined)
    .map((stream) => ({
      index: stream.Index as number,
      name: stream.DisplayTitle || stream.Language || `Audio ${stream.Index}`,
      language: stream.Language || "und",
      isDefault: stream.IsDefault === true,
    }))
    .sort((a, b) => Number(b.index === preferredAudioStreamIndex) - Number(a.index === preferredAudioStreamIndex) || Number(b.isDefault) - Number(a.isDefault));
  // Built by the shared helper so the app's ordinal lookup sees exactly this
  // list, in exactly this order.
  const subtitles = subtitleRenditions(videoItem);

  // HLS VIDEO-RANGE for the master playlist. Apple's spec requires it and
  // AVFoundation hard-rejects PQ (HDR10/DoVi-with-PQ) content in a variant
  // that doesn't declare it (-12927). Jellyfin's VideoRangeType is the source:
  // HDR10/HDR10+/DOVI are PQ-transfer, HLG is HLG, everything else SDR.
  const videoStreamMeta = (videoItem.MediaStreams ?? []).find((stream) => stream.Type === "Video");
  const rangeType = (videoStreamMeta?.VideoRangeType || videoStreamMeta?.VideoRange || "SDR").toUpperCase();
  const videoRange = rangeType.includes("HLG") ? "HLG" : rangeType.includes("HDR") || rangeType.includes("DOVI") || rangeType.includes("PQ") ? "PQ" : "SDR";

  // CODECS accompanies a non-SDR VIDEO-RANGE only: AVFoundation refuses to
  // select an HDR variant whose codec support it cannot verify, while SDR
  // variants have provably never needed the attribute here. Only HEVC carries
  // HDR through the remux path (Main 10 = profile_idc 2), so the string is the
  // Apple-documented hvc1 form with the stream's level.
  //
  // The audio token has to match what AudioTranscoder actually emits, and a
  // mismatched CODECS is exactly what AVPlayer refuses. This mirrors the rule in
  // AudioTranscoder.needsTranscode: AAC, ALAC, AC-3 and E-AC-3 copy, well-formed
  // FLAC copies, everything else is re-encoded to FLAC. Keep the two in step: the
  // master playlist is served before FFmpeg has opened the input, so the engine
  // cannot report the real answer back in time.
  //
  // RFC 6381 names for the Dolby codecs are "ac-3" and "ec-3". Atmos is NOT a
  // separate token: E-AC-3 with JOC is still ec-3, and Apple signals the object
  // audio in CHANNELS ("16/JOC") rather than in CODECS, which is what their own
  // example stream does.
  const primaryAudioCodec = (videoItem.MediaStreams ?? []).find((stream) => stream.Type === "Audio")?.Codec?.toLowerCase() ?? "";
  const audioCodecTag =
    primaryAudioCodec.startsWith("aac") || primaryAudioCodec.startsWith("mp4a")
      ? "mp4a.40.2"
      : primaryAudioCodec.startsWith("alac")
        ? "alac"
        : primaryAudioCodec.startsWith("eac3") || primaryAudioCodec.startsWith("ec-3")
          ? "ec-3"
          : primaryAudioCodec.startsWith("ac3") || primaryAudioCodec.startsWith("ac-3")
            ? "ac-3"
            : "fLaC";
  const codecs = videoRange === "SDR" ? "" : `hvc1.2.4.L${videoStreamMeta?.Level && videoStreamMeta.Level > 0 ? videoStreamMeta.Level : 123}.B0,${audioCodecTag}`;

  // Before the call: the engine reports its plan from the pipeline thread,
  // which can beat this promise's resolution.
  watchEnginePlan();

  const url: string = await LocalRemuxer.startRemux({
    inputUrl,
    audioTracks,
    durationSeconds,
    subtitles,
    videoRange,
    codecs,
  });

  // The token is the path segment of the master URL (…/<token>/master.m3u8).
  // The CALLER owns it and must hand it back to stopLocalRemux; see
  // localRemuxToken() and the note on stopLocalRemux for why this cannot be
  // module state.

  logger.info("Local remux session started", {
    service: "LocalRemux",
    itemId: videoItem.Id,
    durationSeconds: Math.round(durationSeconds),
    audioTrackCount: audioTracks.length,
    subtitleCount: subtitles.length,
  });

  return url;
}

/** Session token from the master URL startLocalRemux resolved, or null. */
export function localRemuxToken(masterUrl: string | null | undefined): string | null {
  return masterUrl?.split("/").at(-2) ?? null;
}

/**
 * One drawable bitmap, positioned in the subtitle canvas's own coordinate
 * space. That space is NOT always the video's: T43's PGS stream declares
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
 * These formats are event-based, not range-based — each display set supersedes
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

/** Base URL of a session's loopback directory, e.g. `http://127.0.0.1:PORT/token/`. */
function sessionBaseUrl(masterUrl: string | null | undefined): string | null {
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
    const response = await fetch(`${base}pgs${streamIndex}.json`);
    if (!response.ok) return null;
    const track = (await response.json()) as ImageSubtitleTrack;
    if (!Array.isArray(track?.events)) return null;
    // An engine build without these reports nothing rather than lying: no
    // progress and never complete keeps the caller polling, which is the old
    // behaviour rather than a silent stop.
    return { ...track, demuxedUpTo: typeof track.demuxedUpTo === "number" ? track.demuxedUpTo : 0, complete: track.complete === true };
  } catch (error) {
    logger.debug("Image subtitle manifest fetch failed", { service: "LocalRemux", streamIndex, error: String(error) });
    return null;
  }
}

/**
 * The images on screen at `time`: the last display set at or before it.
 *
 * No end times are involved, because the format does not carry any. An erase
 * set resolves to an empty array, which is the format saying "nothing here" —
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

/**
 * Tear down one session, by the token its own start returned.
 *
 * The token used to live in a module-level variable, which defeated the very
 * guard it was documented to provide. Two player screens overlap during a
 * transition (React mounts the incoming screen before the outgoing one
 * unmounts), so the second start overwrote the variable and the FIRST player's
 * unmount then tore down the SECOND player's session. Ownership has to belong
 * to the caller, one token per player instance.
 */
export async function stopLocalRemux(token: string | null): Promise<void> {
  if (!isLocalRemuxAvailable() || !token) return;
  try {
    await LocalRemuxer.stopRemux(token);
  } catch (error) {
    logger.warn("Failed to stop local remux session", error, { service: "LocalRemux", token });
  }
}
