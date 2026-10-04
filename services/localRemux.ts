/**
 * localRemux.ts
 *
 * Tomo's side of the on-device engine (@keiver/tomo-engine, packages/tomo-engine): the Jellyfin
 * item becomes an engine session config here, and every generic engine export is re-exported so
 * the app has one import path.
 *
 * The engine reads the original file straight from Jellyfin, rewraps the video
 * and one audio track into fMP4 HLS on the device, and serves it over loopback
 * HTTP. AVPlayer plays that with its native transport controls, so a file the
 * server would otherwise transcode plays at original quality with no server
 * transcode session at all.
 *
 * Codecs AVPlayer decodes natively (REMUXABLE_CODECS) are copied verbatim.
 * Codecs it cannot decode at all (TRANSCODABLE_VIDEO_CODECS) are decoded in
 * software and re-encoded by VideoToolbox on the way through
 * (packages/tomo-engine/ios/LocalRemuxer/VideoTranscoder.swift): H.264 for 8-bit sources,
 * HEVC Main 10 for 10-bit ones, deinterlacing on the way through when the
 * source is interlaced. Nothing is gated on size: the engine times its own
 * segments and the player hands a session that runs below realtime to the
 * server before AVPlayer is bound (engineVerdicts.ts remembers the file).
 * Codecs the linked build cannot decode go to the server.
 */
import {
  AV1_CODECS,
  REMUXABLE_CODECS,
  TRANSCODABLE_VIDEO_CODECS,
  configureEngine,
  dolbyVisionSupplementalCodecs as engineDolbyVisionSupplementalCodecs,
  isAudioTrackCarriable,
  isLocalRemuxAvailable,
  manifestName,
  publishedRenditionNames,
  requestPosterFrame as requestEnginePosterFrame,
  startSession,
  videoCodecTag as engineVideoCodecTag,
  videoDecodeSupport,
  type EngineStopRequest,
  type SubtitleRendition,
  type VideoStreamInfo,
} from "@keiver/tomo-engine";

import { JELLYFIN_TIME } from "@/services/jellyfin/constants";
import { audioCatalogue, playbackMediaStreams, sourcePosition, type AudioCatalogueTrack } from "@/services/jellyfin/audioTracks";
import { generatePlaySessionId, getCachedConfig } from "@/services/jellyfin/session";
import { getSubtitleUrl, isDvdSubCodec, isImageBasedSubtitleCodec, isPgsCodec } from "@/services/jellyfin/subtitles";
import { deviceDecodes, isLiveSource, serverVideoTranscodingAllowed, sourceVideoRange } from "@/services/jellyfin/media";
import { rememberedVerdict } from "@/services/engineVerdicts";
import { localMediaUri, localSubtitleUri, playsFromDisk } from "@/services/downloads/localSource";
import { getAudioRenditionUrl, getRemoteVideoStreamUrl, getTierPlaylistUrl, getVideoStreamUrl } from "@/services/jellyfin/streamUrls";
import { rememberedBitrate } from "@/services/jellyfin/bitrateTest";
import type { JellyfinMediaStream, JellyfinVideoItem } from "@/types/jellyfin";
import { noteDeviceDecode, probeEmit } from "@/services/playbackProbe";
import { logger } from "@/utils/logger";

export {
  POSTER_FRAME_ATTEMPTS,
  POSTER_FRAME_OPEN_RETRY_CAP_MS,
  POSTER_FRAME_RETRY_MS,
  READ_BOUND_SHARE,
  belowRealtime,
  benchmarkTranscode,
  cancelPosterFrame,
  chapterFrameUrl,
  clearFramePool,
  clearPosterFrameCache,
  engineCodecAllowlists,
  engineInputMissing,
  engineProgress,
  engineStarving,
  fetchImageSubtitleTrack,
  imageSubtitleUrl,
  imagesAt,
  isLocalRemuxAvailable,
  liveSubtitleRenditions,
  localRemuxToken,
  nativeEmits,
  posterFrameGeneration,
  posterFrameIfCached,
  posterFrameRevision,
  posterFrameWorkInFlight,
  readBound,
  reportPlayerBuffer,
  resolveSubtitlePick,
  sessionBaseUrl,
  setLiveSessionPriority,
  setLiveWindow,
  startFrameProvider,
  startPlaylistShim,
  stopFrameProvider,
  stopLocalRemux,
  stopPlaylistShim,
  subscribeEngineFailure,
  subscribeEngineLink,
  subscribeEngineStage,
  subscribeEngineThroughput,
  subscribeEngineTier,
  subscribeSubtitleRequests,
  tierDeclaredFor,
  videoDecodeSupport,
} from "@keiver/tomo-engine";
export type {
  EngineFailure,
  EngineLinkReport,
  EnginePlan,
  EngineProgress,
  EngineStage,
  EngineStreamPlan,
  EngineTierReport,
  EngineTrackPlan,
  ImageSubtitleEvent,
  ImageSubtitleImage,
  ImageSubtitleTrack,
  ReportedTextTrack,
  SubtitlePick,
  SubtitleRendition,
  SubtitleRequest,
  ThroughputSample,
  TranscodeBenchmark,
} from "@keiver/tomo-engine";

configureEngine({ log: logger, onProbe: probeEmit, onDeviceDecode: noteDeviceDecode });

/**
 * Live segment target. AVPlayer starts a live playlist three target durations in (tvOS sim,
 * 2026-09-11): 2s puts the first frame ~12s after the press on a transcoded channel, 6s ~21s.
 */
const LIVE_SEGMENT_SECONDS = 2;

/**
 * Producer read-ahead depth, in 6s segments: 20 = a 120s cushion. Sized from the
 * player survey (hls.js caps at 600s, ExoPlayer holds 50s in RAM, mpv's network
 * presets run 512MiB; ours is disk-backed and pruned) so a stalling remote feed
 * is absorbed instead of starving AVPlayer. The engine's own default stays 5;
 * this knob rides the session config, so tuning is a reload, not a rebuild.
 */
const REMUX_READ_AHEAD_SEGMENTS = 20;

// Slipstream (memories/CLAUDE-slipstream.md): one loopback master carrying the
// device's stream copy and this server-fed ladder, AVPlayer switching natively
// between them. Every eligible item declares the ladder; the engine's measured
// link decides which rungs the master lists and which one leads.
// Apple-shaped H.264 SDR rungs, ascending; each rides the audio-lo group, so a
// rung's CODECS names its video and that group's AAC.
interface TierRung {
  bitrate: number;
  width: number;
  height: number;
  codecs: string;
}
export type SlipstreamOptions = { serverVideoOnly?: boolean };
/** Stereo AAC bitrate for the audio-lo group when the link is below the smallest copy-audio rung. */
export const SURVIVAL_AUDIO_BITRATE = 96_000;
/** The 64px picture a server audio rendition arrives beside (measured: 16 to 18 KB of a 6s segment). */
export const AUDIO_CARRIER_BITRATE = 24_000;
/** Every rung rides the stereo audio-lo group; surround comes from the copy. */
const RUNG_AUDIO_BANDWIDTH = SURVIVAL_AUDIO_BITRATE + AUDIO_CARRIER_BITRATE;

const SLIPSTREAM_LADDER: TierRung[] = [
  // The bottom rung is sized for the START, not the steady state: AVPlayer buffers around 24s of
  // media before the first frame, so a 0.6 Mb/s link spends 14s on a 336 kb/s rung's worth of it
  // (measured: 38s to first frame). At 140 kb/s that buffer is a third of the bytes.
  { bitrate: 140_000, width: 256, height: 144, codecs: "avc1.64000C" },
  // 144p exists for links under ~0.7 Mb/s, where 240p plus its audio does not fit the wire.
  { bitrate: 240_000, width: 256, height: 144, codecs: "avc1.64000C" },
  { bitrate: 400_000, width: 426, height: 240, codecs: "avc1.640015" },
  { bitrate: 800_000, width: 640, height: 360, codecs: "avc1.64001E" },
  { bitrate: 1_500_000, width: 854, height: 480, codecs: "avc1.64001F" },
  { bitrate: 4_000_000, width: 1280, height: 720, codecs: "avc1.640020" },
  { bitrate: 6_000_000, width: 1920, height: 1080, codecs: "avc1.640028" },
];

export function slipstreamEligible(videoItem: JellyfinVideoItem): boolean {
  const streams = playbackMediaStreams(videoItem);
  return streams.some((stream) => stream.Type === "Video") && streams.some((stream) => stream.Type === "Audio");
}

function positiveBandwidth(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
}

export function sourceBandwidthForItem(videoItem: JellyfinVideoItem): number {
  const source = videoItem.MediaSources?.[0];
  const declared = positiveBandwidth(source?.Bitrate);
  if (declared > 0) return declared;
  const duration = (videoItem.RunTimeTicks ?? 0) / JELLYFIN_TIME.TICKS_PER_SECOND;
  const size = source?.Size ?? 0;
  if (Number.isFinite(duration) && duration > 0 && Number.isFinite(size) && size > 0) {
    const calculated = positiveBandwidth((size * 8) / duration);
    if (calculated > 0) return calculated;
  }
  const streams = playbackMediaStreams(videoItem).filter((stream) => stream.IsExternal !== true);
  const audiovisual = streams.filter((stream) => stream.Type === "Video" || stream.Type === "Audio");
  if (audiovisual.length === 0 || audiovisual.some((stream) => positiveBandwidth(stream.BitRate) === 0)) return 0;
  return positiveBandwidth(streams.reduce((total, stream) => total + positiveBandwidth(stream.BitRate), 0));
}

function primaryBandwidths(videoItem: JellyfinVideoItem, audioBandwidth: number): { sourceBandwidth: number; primaryVideoBandwidth: number; bandwidth: number } {
  const streams = playbackMediaStreams(videoItem);
  const video = streams.find((stream) => stream.Type === "Video");
  const sourceBandwidth = sourceBandwidthForItem(videoItem);
  let primaryVideoBandwidth = positiveBandwidth(video?.BitRate);
  if (video && primaryVideoBandwidth === 0 && sourceBandwidth > 0) {
    const otherStreams = streams.filter((stream) => stream !== video && stream.IsExternal !== true);
    const otherBandwidth = otherStreams.reduce((total, stream) => total + positiveBandwidth(stream.BitRate), 0);
    primaryVideoBandwidth = otherBandwidth < sourceBandwidth ? sourceBandwidth - otherBandwidth : sourceBandwidth;
  }
  const bandwidth = video && primaryVideoBandwidth === 0 ? 0 : primaryVideoBandwidth + audioBandwidth;
  return { sourceBandwidth, primaryVideoBandwidth, bandwidth };
}

function audioOutput(stream: JellyfinMediaStream): { usesServerAudio: boolean; codecs: string; bandwidth: number } {
  // A sidecar audio file is not in the container the engine reads.
  if (stream.IsExternal === true || !isAudioTrackCarriable(stream.Codec)) return { usesServerAudio: true, codecs: "mp4a.40.2", bandwidth: RUNG_AUDIO_BANDWIDTH };
  const codec = (stream.Codec ?? "").toLowerCase();
  const lossless = Math.round((stream.Channels ?? 2) * (stream.SampleRate ?? 48000) * (stream.BitDepth ?? 16) * 0.6);
  const encodedBandwidth = Math.max(lossless, 192_000, (stream.Channels ?? 2) * 64_000);
  const sourceBandwidth = stream.BitRate && stream.BitRate > 0 ? stream.BitRate : undefined;
  if (codec.startsWith("aac") || codec.startsWith("mp4a")) {
    const profile = stream.Profile?.toUpperCase();
    const codecs = codec.startsWith("mp4a.") ? codec : profile === "HE-AACV2" || profile === "HE-AAC V2" ? "mp4a.40.29" : profile === "HE-AAC" ? "mp4a.40.5" : "mp4a.40.2";
    return { usesServerAudio: false, codecs, bandwidth: sourceBandwidth ?? 256_000 };
  }
  if (codec.startsWith("eac3") || codec.startsWith("ec-3")) return { usesServerAudio: false, codecs: "ec-3", bandwidth: sourceBandwidth ?? 768_000 };
  if (codec.startsWith("ac3") || codec.startsWith("ac-3")) return { usesServerAudio: false, codecs: "ac-3", bandwidth: sourceBandwidth ?? 640_000 };
  if (codec.startsWith("alac")) return { usesServerAudio: false, codecs: "alac", bandwidth: sourceBandwidth ?? lossless };
  if (codec.startsWith("flac")) return { usesServerAudio: false, codecs: "fLaC,mp4a.40.2", bandwidth: Math.max(sourceBandwidth ?? 0, encodedBandwidth) };
  return { usesServerAudio: false, codecs: codec ? "fLaC,mp4a.40.2" : "", bandwidth: encodedBandwidth };
}

/**
 * A live track is always carried: the engine discovers the real codec off the stream and copies or
 * re-encodes it there, so a label it would not carry (a tuner's unprobed "MPEG") declares no CODECS.
 */
function liveAudioOutput(stream: JellyfinMediaStream): { usesServerAudio: boolean; codecs: string; bandwidth: number } {
  const carried = audioOutput(stream);
  return { usesServerAudio: false, codecs: carried.usesServerAudio ? "" : carried.codecs, bandwidth: carried.bandwidth };
}

export function slipstreamInputBandwidth(videoItem: JellyfinVideoItem): number {
  const sourceBandwidth = sourceBandwidthForItem(videoItem);
  if (sourceBandwidth > 0) return sourceBandwidth;
  const tracks = audioCatalogue(videoItem);
  return primaryBandwidths(videoItem, Math.max(0, ...tracks.map((track) => audioOutput(track.stream).bandwidth))).bandwidth;
}

/**
 * The ladder rungs offered for this item: every rung whose total (video + the
 * audio group) meaningfully undercuts the primary (the 0.85 rule).
 * Ascending. Empty when the file is not gateway-eligible or nothing undercuts
 * (audio-heavy tiny files), where AVPlayer would rightly refuse the rung.
 */
export function offeredTierRungs(videoItem: JellyfinVideoItem, preferredAudioStreamIndex?: number, options: SlipstreamOptions = {}): TierRung[] {
  if (!serverVideoTranscodingAllowed(videoItem)) return [];
  const serverVideoOnly = options.serverVideoOnly === true && !isLiveSource(videoItem) && !playsFromDisk(videoItem.Id) && playbackMediaStreams(videoItem).some((stream) => stream.Type === "Video");
  if (!slipstreamEligible(videoItem)) return serverVideoOnly ? [...SLIPSTREAM_LADDER] : [];
  const tracks = audioCatalogue(videoItem, preferredAudioStreamIndex);
  const audioBandwidth = Math.max(0, ...tracks.map((track) => audioOutput(track.stream).bandwidth));
  const { bandwidth: primaryBandwidth } = primaryBandwidths(videoItem, audioBandwidth);
  const rungs = SLIPSTREAM_LADDER.filter((rung) => primaryBandwidth <= 0 || rung.bitrate + RUNG_AUDIO_BANDWIDTH < primaryBandwidth * 0.85);
  return serverVideoOnly && rungs.length === 0 ? [...SLIPSTREAM_LADDER] : rungs;
}

/**
 * The survival cap for a gateway session: the TOP offered rung's declared
 * bandwidth. Capping there lets AVPlayer's ABR use every server rung but not
 * the source-rate primary, which a below-source link cannot produce; the
 * gateway controller raises the cap when the link recovers. null = no rung
 * offered. Also the pin-cap reference for the fixed-quality path.
 */
export function slipstreamTierBandwidth(videoItem: JellyfinVideoItem, preferredAudioStreamIndex?: number, options: SlipstreamOptions = {}): number | null {
  const rungs = offeredTierRungs(videoItem, preferredAudioStreamIndex, options);
  if (rungs.length === 0) return null;
  // The cap is the top rung's video plus the audio group it rides.
  const top = rungs[rungs.length - 1];
  return top.bitrate + (audioCatalogue(videoItem).length > 0 ? RUNG_AUDIO_BANDWIDTH : 0);
}

/**
 * The declared BANDWIDTH of each offered rung, ascending: the preferredPeakBitRate steps the
 * buffer-driven ladder climbs through. Capping at caps[k] holds AVPlayer on rung k; an empty result
 * means no ladder (uncapped, the engine primary). Each cap matches the master's rung BANDWIDTH.
 */
export function offeredTierBandwidths(videoItem: JellyfinVideoItem, preferredAudioStreamIndex?: number, options: SlipstreamOptions = {}): number[] {
  const audioBandwidth = audioCatalogue(videoItem).length > 0 ? RUNG_AUDIO_BANDWIDTH : 0;
  return offeredTierRungs(videoItem, preferredAudioStreamIndex, options).map((rung) => rung.bitrate + audioBandwidth);
}

/** Copy the video where this device's AVPlayer opens it as it stands; re-encode it otherwise. */
async function copiesVideo(videoStream: JellyfinMediaStream | undefined): Promise<boolean> {
  const codec = videoStream?.Codec?.toLowerCase() ?? "";
  if (!codec) return false;
  if (!REMUXABLE_CODECS.some((known) => codec.startsWith(known)) && !AV1_CODECS.some((known) => codec.startsWith(known))) return false;
  return deviceDecodes(codec, videoStream?.BitDepth, await videoDecodeSupport(), videoStream?.Height);
}

/** 8K UHD. A cropped 8K picture keeps the width, so either side marks it. */
const EIGHT_K = { width: 7680, height: 4320 };

/** 8K video this device does not copy plays as one server transcode: each gateway supplier decodes the source again. */
export async function needsSingleServerTranscode(videoItem: JellyfinVideoItem | null | undefined): Promise<boolean> {
  if (!videoItem || isLiveSource(videoItem) || playsFromDisk(videoItem.Id)) return false;
  const videoStream = playbackMediaStreams(videoItem).find((stream) => stream.Type === "Video");
  if (!videoStream) return false;
  const eightK = (videoStream.Width ?? 0) >= EIGHT_K.width || (videoStream.Height ?? 0) >= EIGHT_K.height;
  return eightK && !(await copiesVideo(videoStream));
}

/**
 * Whether this item can play through the local remux engine: either
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
 * Image-based subtitles do not decline: the engine decodes them to timed bitmaps the app
 * draws itself, so a Blu-ray remux keeps its video copied and its lossless audio intact.
 *
 * `record` is false for a prediction (info panel, download planner): its declines belong to
 * no playback session, and the probe would file them under whichever one is retained.
 */
export async function canRemuxLocally(videoItem: JellyfinVideoItem | null, { record = true }: { record?: boolean } = {}): Promise<boolean> {
  // Every decline logs its reason: an unexplained lane switch is what made the 2026-08-10
  // subtitle-desync session undiagnosable. The probe line is the one a bug report needs.
  const declineRemux = (reason: string, detail?: Record<string, unknown>): false => {
    logger.debug("Local remux declined", { service: "LocalRemux", reason, ...detail });
    if (record) probeEmit("decline", { reason, ...detail });
    return false;
  };
  if (!isLocalRemuxAvailable()) {
    // On iOS/tvOS the module should always exist; its absence means a broken
    // build, so this one decline is a warning rather than a debug line.
    logger.warn("Local remux declined: native module unavailable", { service: "LocalRemux" });
    return false;
  }
  // A live channel's metadata is a label, not a probe: a tuner's lineup string for a channel the server
  // never probed. The engine reads every stream off the demuxer itself (RemuxSession+Pipeline, isLive), so
  // its own open decides what it plays, and a channel it cannot take fails at startup to the server rung.
  if (isLiveSource(videoItem) && videoItem?.liveStreamUrl) return true;
  if (!videoItem) return declineRemux("no media streams");
  const mediaStreams = playbackMediaStreams(videoItem);
  if (mediaStreams.length === 0) return declineRemux("no media streams");

  // An audio-only item has no video stream to judge, and the engine runs a
  // video-less session for it (Remuxer.runPipeline, `hasVideo`). Its audio
  // still has to be carriable, so the checks below this point all apply.
  const videoStream = mediaStreams.find((stream) => stream.Type === "Video");
  const audioOnly = !videoStream && mediaStreams.some((stream) => stream.Type === "Audio");
  if (!audioOnly && !videoStream?.Codec) return declineRemux("no video codec in metadata");
  const codec = videoStream?.Codec?.toLowerCase() ?? "";

  let audioTracks: AudioCatalogueTrack[];
  try {
    audioTracks = audioCatalogue(videoItem);
  } catch (error) {
    return declineRemux("invalid audio catalogue", { error: String(error) });
  }
  const needsServerAudio = audioTracks.some((track) => !isAudioTrackCarriable(track.stream.Codec));
  if (needsServerAudio && (audioOnly || playsFromDisk(videoItem.Id))) {
    return declineRemux("audio track requires an unavailable server supplier");
  }

  // A live stream has no runtime; the engine's live mode needs none.
  if (!isLiveSource(videoItem) && (!videoItem.RunTimeTicks || videoItem.RunTimeTicks <= 0)) return declineRemux("no runtime in metadata");

  if (audioOnly) return true;

  if (await needsSingleServerTranscode(videoItem)) return declineRemux("8K video this device does not copy", { width: videoStream?.Width, height: videoStream?.Height });

  // Prefix match everywhere, same reason as the audio list: family variants
  // match ("hvc1", "wmv3", "vp6f"), codecs that merely CONTAIN an entry do not
  // ("msmpeg4v3" contains "mpeg4", and the two are unrelated formats decoded by
  // different decoders, listed separately on purpose).
  // Copied where this device decodes them, re-encoded on device where it does not
  // (an Apple TV HD and 10-bit HEVC); either way the engine takes the file.
  if (REMUXABLE_CODECS.some((known) => codec.startsWith(known))) return true;
  if (AV1_CODECS.some((known) => codec.startsWith(known))) return true;

  // Exotic codecs, decoded and re-encoded on device below 8K at any depth or field
  // order. Whether this device keeps up is measured by the session itself
  // (reportThroughput), never guessed from the metadata.
  if (TRANSCODABLE_VIDEO_CODECS.some((known) => codec.startsWith(known))) return true;

  return declineRemux("video codec unsupported", { codec });
}

/** Predicted engine treatment for an item, from metadata alone. */
export type PlaybackLane = "copy" | "deviceTranscode" | "server";

/**
 * Which lane playback would take, without opening a session: the same gates the
 * engine applies (canRemuxLocally), the copy line AVPlayer's native decoders
 * draw, and the tier rule startLocalRemux runs. `smallFeedFirst` is true when
 * the remembered link sits below the source and a tier would declare, so the
 * session opens on the smaller server-fed rung. Audio-only items report
 * "copy": there is no video to re-encode.
 */
export async function predictPlaybackLane(videoItem: JellyfinVideoItem | null): Promise<{ lane: PlaybackLane; smallFeedFirst: boolean }> {
  const lane = await (async (): Promise<PlaybackLane> => {
    // A verdict describes streaming this file. A held file has no link to lose to, and the
    // server lane is exactly what a download exists to do without.
    if (videoItem && !playsFromDisk(videoItem.Id) && !isLiveSource(videoItem) && (await rememberedVerdict(videoItem))) return "server";
    if (!(await canRemuxLocally(videoItem, { record: false }))) return "server";
    const videoStream = videoItem ? playbackMediaStreams(videoItem).find((stream) => stream.Type === "Video") : undefined;
    if (!videoStream) return "copy";
    return (await copiesVideo(videoStream)) ? "copy" : "deviceTranscode";
  })();
  if (lane === "server" || videoItem == null) return { lane, smallFeedFirst: false };
  // Item-page hint only: whether the stored link reading suggests this play opens on the smaller
  // server feed. Best-effort from the remembered bitrate; the runtime always offers the ladder and
  // lets AVPlayer decide. A held file reads off disk; a live channel has no server tier.
  const sourceBps = sourceBandwidthForItem(videoItem);
  const measuredBps = sourceBps > 0 && !playsFromDisk(videoItem.Id) ? await rememberedBitrate() : null;
  return { lane, smallFeedFirst: !isLiveSource(videoItem) && measuredBps != null && measuredBps < sourceBps && slipstreamTierBandwidth(videoItem) != null };
}

/** Jellyfin's video stream metadata as the engine's CODECS builder reads it. */
function videoStreamInfo(stream: JellyfinMediaStream | undefined): VideoStreamInfo | undefined {
  if (!stream) return undefined;
  return {
    codec: stream.Codec,
    profile: stream.Profile,
    level: stream.Level,
    bitDepth: stream.BitDepth,
    dolbyVision: {
      profile: stream.DvProfile,
      level: stream.DvLevel,
      rpuPresent: stream.RpuPresentFlag === 1,
      elPresent: stream.ElPresentFlag === 1,
      blSignalCompatibilityId: stream.DvBlSignalCompatibilityId,
    },
  };
}

/** RFC 6381 tag for the video the engine will actually serve, or "" when it cannot be stated as fact. */
export function videoCodecTag(videoStream: JellyfinMediaStream | undefined, willCopyVideo: boolean): string {
  return engineVideoCodecTag(videoStreamInfo(videoStream), willCopyVideo);
}

/** SUPPLEMENTAL-CODECS for a Dolby Vision source the engine copies, or "". */
export function dolbyVisionSupplementalCodecs(stream: JellyfinMediaStream | undefined, willCopyVideo: boolean): string {
  return engineDolbyVisionSupplementalCodecs(videoStreamInfo(stream), willCopyVideo);
}

/**
 * Display labels for a file's subtitle renditions, in playlist order.
 *
 * Labels carry no identity (the rendition's ORDINAL does) but they still
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
    return manifestName(stream.DisplayTitle?.trim() || stream.Title?.trim() || language) || `Track ${position + 1}`;
  });

  // Anything still repeated after that (two tracks genuinely both called
  // "English", which real discs do ship) is disambiguated by position.
  const occurrences = new Map<string, number>();
  for (const label of labels) occurrences.set(label, (occurrences.get(label) ?? 0) + 1);
  return publishedRenditionNames(
    labels.map((label, position) => ({
      name: (occurrences.get(label) ?? 0) > 1 ? `${label} (${position + 1})` : label,
      index: streams[position].Index as number,
    })),
  );
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
 * A text track inside the container is decoded by the engine and cut on the
 * session grid (TextSubtitleDecoder). Asking Jellyfin for it instead made the
 * server run ffmpeg over the whole file before AVPlayer reported ready, which
 * measured 5.7 to 11.8 seconds in front of the picture. A SIDECAR is not in the
 * container, so it stays Jellyfin's to serve, and it costs no extraction.
 *
 * Image tracks (PGS, DVD/VobSub, DVB, XSUB) ride as renditions too, but there
 * is no WebVTT to give for a bitmap: the engine decodes them out of the source
 * file, the rendition resolves to a cue-less playlist so AVKit lists the track
 * and draws none of it, and the app paints the bitmaps.
 */
/** The renditions a session ships: every track for a file, the image tracks alone for a live channel. */
export function sessionSubtitleRenditions(videoItem: JellyfinVideoItem): SubtitleRendition[] {
  return buildSubtitleRenditions(videoItem, isLiveSource(videoItem));
}

function externalImageSubtitleUrl(videoItem: JellyfinVideoItem, stream: JellyfinMediaStream): string {
  if (stream.IsExternal !== true || !isImageBasedSubtitleCodec(stream.Codec) || playsFromDisk(videoItem.Id)) return "";
  const deliveryUrl = (stream as JellyfinMediaStream & { DeliveryUrl?: string }).DeliveryUrl;
  if (!deliveryUrl) return "";
  const config = getCachedConfig();
  try {
    const url = new URL(deliveryUrl, config.server || undefined);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const authenticatedOrigin = config.server ? new URL(config.server).origin : null;
    const hasApiKey = [...url.searchParams.keys()].some((key) => key.toLowerCase() === "apikey" || key.toLowerCase() === "api_key");
    if (url.origin === authenticatedOrigin && config.apiKey && !hasApiKey) url.searchParams.set("ApiKey", config.apiKey);
    return url.toString();
  } catch {
    return "";
  }
}

export function subtitleRenditions(videoItem: JellyfinVideoItem): SubtitleRendition[] {
  return buildSubtitleRenditions(videoItem, false);
}

function isRemoteSubtitleUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function buildSubtitleRenditions(videoItem: JellyfinVideoItem, imageOnly: boolean): SubtitleRendition[] {
  const streamIndexes = new Set<number>();
  const mediaStreams = playbackMediaStreams(videoItem);
  // A track that cannot be served is left out: the film plays without it.
  const dropped = (reason: string, index: number | undefined) => {
    logger.warn("Subtitle track left out of the session", { service: "LocalRemux", itemId: videoItem.Id, streamIndex: index, reason });
    return [];
  };
  const shipped = mediaStreams
    .filter((stream) => stream.Type === "Subtitle" && (!imageOnly || isImageBasedSubtitleCodec(stream.Codec)))
    .flatMap((stream) => {
      const index = stream.Index;
      if (index === undefined || !Number.isInteger(index) || index < 0 || index > 2_147_483_647) return dropped("no valid stream index", index);
      if (streamIndexes.has(index)) return dropped("duplicate stream index", index);
      streamIndexes.add(index);
      const isImage = isImageBasedSubtitleCodec(stream.Codec);
      // A track saved with the download is a PATH, not a URL: the engine serves its bytes over
      // the loopback. A file:// URI inside an http playlist is a scheme AVFoundation will not
      // follow, and handing it one loses the whole asset, not just the subtitle.
      const localVtt = isImage ? "" : (localSubtitleUri(videoItem.Id, index) ?? "");
      const isEngineText = !isImage && !localVtt && stream.IsExternal !== true;
      const vttUrl = isImage || isEngineText || localVtt ? "" : getSubtitleUrl(videoItem.Id, index, "vtt");
      const serverSupUrl = isImage && stream.IsExternal === true ? externalImageSubtitleUrl(videoItem, stream) : "";
      if (isImage && stream.IsExternal === true && !serverSupUrl) return dropped("no bitmap subtitle supplier", index);
      if (!isImage && !isEngineText && !localVtt && !isRemoteSubtitleUrl(vttUrl)) return dropped("no text subtitle supplier", index);
      return [
        {
          stream,
          index,
          isImage,
          isEngineText,
          localVtt,
          vttUrl,
          serverSupUrl,
          source: imageOnly ? null : sourcePosition(mediaStreams, stream),
        },
      ];
    });

  const labels = subtitleLabels(shipped.map((entry) => entry.stream));

  // RFC 8216 §4.3.4.1: a rendition group MUST NOT carry more than one member
  // with DEFAULT=YES, and Matroska is happy to flag several subtitle tracks as
  // default at once. AVFoundation rejects a malformed group by refusing the
  // whole master playlist (-12642), which loses the file, not just its
  // subtitles. First default wins. Remuxer.masterPlaylist() holds the same line
  // because the invariant belongs to the playlist, not to this caller.
  const firstDefault = shipped.findIndex((entry) => entry.stream.IsDefault === true);

  return shipped.map((entry, position) => ({
    index: entry.index,
    name: labels[position],
    language: entry.stream.Language || "und",
    vttUrl: entry.vttUrl,
    localVtt: entry.localVtt,
    isDefault: position === firstDefault,
    // Forced tracks used to be burned into the picture. They are renditions
    // now, and the flag reaches the playlist as AUTOSELECT=YES so the track
    // presents itself without being asked for. Never as FORCED=YES: AVKit
    // withholds one of those from the picker and does not apply it either.
    isForced: entry.stream.IsForced === true,
    isImage: entry.isImage,
    isExternal: entry.stream.IsExternal === true,
    isEngineText: entry.isEngineText,
    ...(entry.isImage && entry.stream.IsExternal === true ? { serverSupUrl: entry.serverSupUrl } : {}),
    ...(entry.source ? { source: entry.source } : {}),
  }));
}

/**
 * The DELETE that ends each server transcode a rung or audio rendition started: Jellyfin keys the
 * job by the PlaySessionId riding the URL beside the ApiKey, and DELETE /Videos/ActiveEncodings is
 * the public route. The engine fires these as the session stops.
 */
export function tierStopRequests(urls: string[]): EngineStopRequest[] {
  return urls.flatMap((value) => {
    if (!value) return [];
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return [];
    }
    const apiKey = url.searchParams.get("ApiKey");
    const playSessionId = url.searchParams.get("PlaySessionId");
    if (!apiKey || !playSessionId) return [];
    return [{ url: `${url.protocol}//${url.host}/Videos/ActiveEncodings?deviceId=tomo-slipstream&playSessionId=${playSessionId}&ApiKey=${apiKey}`, method: "DELETE" }];
  });
}

/**
 * Start a remux session and return the loopback HLS URL for the player.
 * Throws when the native module is unavailable or the session cannot start;
 * callers fall back to the server transcode path.
 */
export async function startLocalRemux(
  videoItem: JellyfinVideoItem,
  preferredAudioStreamIndex?: number,
  startOffsetSeconds?: number,
  // prewarm: a live ring neighbour no player reads yet, kept out of the plan and probe the playing session owns.
  options: { prewarm?: boolean; liveWindowSeconds?: number; serverVideoOnly?: boolean; livePriority?: "preview" | "ring" } = {},
): Promise<string> {
  if (!isLocalRemuxAvailable()) {
    throw new Error("Local remux native module not available on this platform");
  }

  // Same untouched original file the direct-play path uses; FFmpeg reads it
  // with byte ranges, so seeking never re-downloads from the start. A live
  // channel reads the tuner stream the server opened for it; a recording still
  // being written is live too, read from the static stream the server keeps
  // growing (ProgressiveFileStream).
  const live = isLiveSource(videoItem);
  const mediaStreams = playbackMediaStreams(videoItem);
  const serverVideoOnly = options.serverVideoOnly === true;
  if (serverVideoOnly && (live || playsFromDisk(videoItem.Id) || !mediaStreams.some((stream) => stream.Type === "Video"))) {
    throw new Error("Server-video gateway requires network VOD video");
  }
  if (serverVideoOnly && !serverVideoTranscodingAllowed(videoItem)) {
    throw new Error("Server video transcoding is not permitted for this source");
  }
  const inputUrl = videoItem.liveStreamUrl ?? getVideoStreamUrl(videoItem.Id, videoItem);
  const durationSeconds = live ? 0 : (videoItem.RunTimeTicks ?? 0) / JELLYFIN_TIME.TICKS_PER_SECOND;

  const orderedAudio = audioCatalogue(videoItem, preferredAudioStreamIndex);
  const audioTracks = orderedAudio.map((track) => ({
    index: track.index,
    identity: track.identity,
    name: track.name,
    language: track.stream.Language || "und",
    isDefault: track.stream.IsDefault === true,
    ...(!live && track.source ? { source: track.source } : {}),
    ...(serverVideoOnly ? { usesServerAudio: true, codecs: "mp4a.40.2", bandwidth: RUNG_AUDIO_BANDWIDTH } : live ? liveAudioOutput(track.stream) : audioOutput(track.stream)),
  }));
  if (audioTracks.some((track) => track.usesServerAudio) && (playsFromDisk(videoItem.Id) || !mediaStreams.some((stream) => stream.Type === "Video"))) {
    throw new Error("Audio track requires an unavailable server supplier");
  }
  // Built by the shared helper so the app's ordinal lookup sees exactly this
  // list, in exactly this order. Live carries its image tracks, drawn by the app.
  const subtitles = sessionSubtitleRenditions(videoItem);

  // HLS VIDEO-RANGE for the master playlist. Apple's spec requires it and
  // AVFoundation hard-rejects PQ (HDR10/DoVi-with-PQ) content in a variant
  // that doesn't declare it (-12927). Jellyfin's VideoRangeType is the source:
  // HDR10/HDR10+/DOVI are PQ-transfer, HLG is HLG, everything else SDR.
  // Empty on an audio-only session, where VIDEO-RANGE has nothing to describe
  // and the engine leaves the attribute off entirely (Remuxer.masterPlaylist).
  const videoStreamMeta = mediaStreams.find((stream) => stream.Type === "Video");
  const videoRange = sourceVideoRange({ ...videoItem, MediaStreams: mediaStreams });

  const audioCodecTags = [...new Set(audioTracks.flatMap((track) => track.codecs.split(",")).filter(Boolean))];
  // The engine copies the video this device decodes and re-encodes everything else, which
  // is exactly the line between a CODECS tag we can state and one we would be inventing.
  const willCopyVideo = !serverVideoOnly && (await copiesVideo(videoStreamMeta));
  // A device that cannot decode Main 10 gets 8-bit H.264 from the encoder (VideoTranscoder
  // picks hevc_videotoolbox only where it can), so the variant declares SDR and no HDR tag.
  const flattensToSdr = !serverVideoOnly && !willCopyVideo && !(await videoDecodeSupport()).hevcMain10;
  const declaredRange = flattensToSdr ? (videoRange ? "SDR" : "") : videoRange;

  // A non-SDR variant MUST carry CODECS whatever else happens: AVFoundation
  // refuses to select a PQ or HLG variant whose codec support it cannot verify,
  // and with no selectable variant the entire master playlist fails. So HDR
  // keeps its long-standing fallback even for a profile we have not measured.
  const measuredVideoTag = videoCodecTag(videoStreamMeta, willCopyVideo);
  const hdrFallbackTag = `hvc1.2.4.L${videoStreamMeta?.Level && videoStreamMeta.Level > 0 ? videoStreamMeta.Level : 123}.B0`;
  const videoTag = serverVideoOnly ? "" : measuredVideoTag || (declaredRange === "SDR" || declaredRange === "" ? "" : hdrFallbackTag);
  const codecs = videoTag ? [videoTag, ...audioCodecTags].join(",") : videoStreamMeta ? "" : audioCodecTags.join(",");
  // Additive by construction: CODECS is untouched, so a player that does not
  // read this attribute gets the HDR10 base layer it already plays.
  const supplementalCodecs = videoTag ? dolbyVisionSupplementalCodecs(videoStreamMeta, willCopyVideo) : "";

  // The variant line AVFoundation validates the whole master against. Logged because a
  // downgraded or rejected session shows up here and nowhere else.
  logger.info("Variant declaration", {
    service: "LocalRemux",
    videoRange: declaredRange,
    codecs,
    supplementalCodecs: supplementalCodecs || "(none)",
    audioTracks: audioTracks.length,
  });

  // Variant metrics, all of them describing the source we are about to copy.
  // Apple requires RESOLUTION (9.2), FRAME-RATE (9.15), BANDWIDTH (9.13) and
  // AVERAGE-BANDWIDTH (9.14) on every variant, and BANDWIDTH used to be a
  // hardcoded 20 Mbps here, which was a fiction.
  const width = videoStreamMeta?.Width ?? 0;
  const height = videoStreamMeta?.Height ?? 0;
  const frameRate = videoStreamMeta?.RealFrameRate ?? videoStreamMeta?.AverageFrameRate ?? 0;

  const { primaryVideoBandwidth, bandwidth, sourceBandwidth } = primaryBandwidths(videoItem, Math.max(0, ...audioTracks.map((track) => track.bandwidth)));

  // Slipstream ladder: always offered for a streamable source with audio. The engine orders the
  // master by the link it measures and AVPlayer's own ABR moves between the variants. A held
  // file reads off disk (no server URL belongs in its playlist); a live channel has no server tier.
  // BANDWIDTH covers the variant plus its audio rendition (RFC 8216 4.3.4.2); CODECS names the group.
  const rungs = !live && !playsFromDisk(videoItem.Id) && (audioTracks.length > 0 || serverVideoOnly) ? offeredTierRungs(videoItem, preferredAudioStreamIndex, { serverVideoOnly }) : [];
  const streamsByIndex = new Map(mediaStreams.map((stream) => [stream.Index, stream]));
  // One server audio group: audio-lo, 96 kb/s stereo AAC, on every rung.
  const tierAudioPlan = { bandwidth: SURVIVAL_AUDIO_BITRATE, tag: "mp4a.40.2" };
  // One TierConfig per offered rung, ascending.
  const tiersConfig = rungs.map((rung) => ({
    playlistUrl: getTierPlaylistUrl(videoItem.Id, videoItem, rung, generatePlaySessionId()),
    bandwidth: rung.bitrate + (audioTracks.length > 0 ? RUNG_AUDIO_BANDWIDTH : 0),
    codecs: audioTracks.length > 0 ? `${rung.codecs},${tierAudioPlan.tag}` : rung.codecs,
    width: rung.width,
    height: rung.height,
  }));
  const audioTracksConfig = audioTracks.map((track) => {
    if (rungs.length === 0 && !track.usesServerAudio) return track;
    const serverAudioUrl = getAudioRenditionUrl(videoItem.Id, videoItem, track.index, generatePlaySessionId(), SURVIVAL_AUDIO_BITRATE);
    if (track.usesServerAudio && !serverAudioUrl) throw new Error(`No server audio URL for ${track.identity}`);
    return {
      ...track,
      serverAudioUrl,
      serverAudioChannels: Math.max(1, Math.min(streamsByIndex.get(track.index)?.Channels || 2, 2)),
    };
  });

  // A link that needs the rungs cannot carry the source read the engine decodes text cues from,
  // so each engine text track also names the server's WebVTT.
  // An image track has the same problem and the same answer: the server hands PGS and DVD tracks
  // over raw (Stream.pgssub, Stream.mks) and the device still decodes and draws them. DVB and XSUB
  // have no measured raw route, and neither does a sidecar file, which the container never held.
  const rawImageFormat = (stream: JellyfinMediaStream | undefined) => (!stream || stream.IsExternal === true ? null : isPgsCodec(stream.Codec) ? "pgssub" : isDvdSubCodec(stream.Codec) ? "mks" : null);
  const subtitlesConfig =
    rungs.length > 0
      ? subtitles.map((sub) => {
          if (sub.isEngineText) return { ...sub, serverVttUrl: getSubtitleUrl(videoItem.Id, sub.index, "vtt") };
          const format = sub.isImage ? rawImageFormat(streamsByIndex.get(sub.index)) : null;
          return format ? { ...sub, serverSupUrl: getSubtitleUrl(videoItem.Id, sub.index, format) } : sub;
        })
      : subtitles;

  const tierOffered = tiersConfig.length > 0;
  const stopRequests = tierStopRequests([...tiersConfig.map((tier) => tier.playlistUrl), ...audioTracksConfig.map((track) => ("serverAudioUrl" in track ? track.serverAudioUrl : ""))]);
  if (!options.prewarm) probeEmit("variant", { videoRange: declaredRange, codecs, supplementalCodecs: supplementalCodecs || "(none)", audioTracks: audioTracks.length, tierOffered });

  const url = await startSession(
    {
      inputUrl,
      itemId: videoItem.Id,
      audioTracks: audioTracksConfig,
      durationSeconds,
      subtitles: subtitlesConfig,
      videoRange: declaredRange,
      codecs,
      primaryVideoCodecs: videoTag,
      primaryVideoBandwidth,
      sourceBandwidth,
      serverVideoOnly,
      supplementalCodecs,
      width,
      height,
      frameRate,
      bandwidth,
      readAheadSegments: REMUX_READ_AHEAD_SEGMENTS,
      // EXT-X-START resume: AVPlayer opens at the offset; its first segment
      // request drives the producer's seek-restart there (no position-zero
      // production, no post-load auto-seek).
      startOffsetSeconds: !live && startOffsetSeconds != null && startOffsetSeconds > 0 ? startOffsetSeconds : 0,
      tiers: tiersConfig,
      isLive: live,
      liveSegmentSeconds: LIVE_SEGMENT_SECONDS,
      ...(live && options.liveWindowSeconds ? { liveWindowSeconds: options.liveWindowSeconds } : {}),
      ...(live && videoItem.liveHttpHeaders ? { httpHeaders: videoItem.liveHttpHeaders } : {}),
      // Read straight from its origin, never through a server open: the engine checks a manifest answers. A raw TS
      // origin is not probed, since a probe costs a second provider connection.
      ...(live && videoItem.liveStreamUrl && !videoItem.LiveStreamId && !videoItem.liveOriginKey ? { probeOrigin: true } : {}),
      ...(live && videoItem.liveOriginKey ? { liveOriginKey: videoItem.liveOriginKey } : {}),
      ...(live && videoItem.liveFallbackUrl ? { fallbackInputUrl: videoItem.liveFallbackUrl } : {}),
      // A neighbour or a card preview yields its origin connection to the channel playing (the engine's connection budget).
      ...(live && (options.livePriority || options.prewarm) ? { livePriority: options.livePriority ?? "ring" } : {}),
      ...(stopRequests.length > 0 ? { stopRequests } : {}),
    },
    // The CALLER owns the token on the returned URL and hands it back to stopLocalRemux.
    { attributePlan: !options.prewarm, tierDeclared: tierOffered },
  );

  logger.info("Local remux session started", {
    service: "LocalRemux",
    itemId: videoItem.Id,
    live,
    durationSeconds: Math.round(durationSeconds),
    audioTrackCount: audioTracks.length,
    subtitleCount: subtitles.length,
    prewarm: options.prewarm === true,
  });

  return url;
}

/** Where Jellyfin's own screen grabber takes a poster: a tenth of the way in, or 10 s when the runtime is unknown. */
export function posterFrameSeconds(item: Pick<JellyfinVideoItem, "RunTimeTicks">): number {
  const runtime = (item.RunTimeTicks || 0) / JELLYFIN_TIME.TICKS_PER_SECOND;
  return runtime > 0 ? runtime / 10 : 10;
}

/** A keyframe for a card the server left without a poster, read from the held file or the original stream. */
export async function requestPosterFrame(item: Pick<JellyfinVideoItem, "Id" | "RunTimeTicks">): Promise<string | null> {
  return requestEnginePosterFrame({ id: item.Id, inputUrl: () => localMediaUri(item.Id) ?? getRemoteVideoStreamUrl(item.Id), seconds: posterFrameSeconds(item) });
}
