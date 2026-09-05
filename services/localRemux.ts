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
 * software and re-encoded by VideoToolbox on the way through
 * (native/ios/LocalRemuxer/VideoTranscoder.swift): H.264 for 8-bit sources,
 * HEVC Main 10 for 10-bit ones, deinterlacing on the way through when the
 * source is interlaced. Nothing is gated on size: the engine times its own
 * segments and the player hands a session that runs below realtime to the
 * server before AVPlayer is bound (engineVerdicts.ts remembers the file).
 * Codecs the linked build cannot decode go to the server.
 */

import { File } from "expo-file-system";
import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { REMUXABLE_CODECS, type VideoDecodeSupport } from "@/constants/codecs";
import { generatePlaySessionId, getVideoStreamUrl, getSubtitleUrl, isImageBasedSubtitleCodec, JELLYFIN_TIME } from "@/services/jellyfinApi";
import { deviceDecodes } from "@/services/jellyfin/media";
import { rememberedVerdict } from "@/services/engineVerdicts";
import { localMediaUri, localSubtitleUri, playsFromDisk } from "@/services/downloads/localSource";
import { getAudioRenditionUrl, getRemoteVideoStreamUrl, getTierPlaylistUrl } from "@/services/jellyfin/streamUrls";
import { rememberedBitrate } from "@/services/jellyfin/bitrateTest";
import type { JellyfinMediaStream, JellyfinVideoItem } from "@/types/jellyfin";
import { probeEmit } from "@/services/playbackProbe";
import { logger } from "@/utils/logger";

const { LocalRemuxer } = NativeModules;
/** Same, but only on hardware that reports AV1 decode support at runtime. */
const AV1_CODECS = ["av1", "av01"];

/**
 * Video codecs AVPlayer cannot decode but the on-device engine can transcode
 * (software decode + VideoToolbox encode). Every entry is REGISTERED in the
 * linked build — confirmed with `npm run probe:codecs`, which walks
 * av_codec_iterate, never by symbol: the static archives carry object files for
 * codecs that were never enabled.
 *
 * These are the names FFPROBE reports, which is what Jellyfin puts in
 * MediaStream.Codec, not the decoder's own name. Three differ: the TSCC decoder
 * is called "camtasia", AVS3 decodes through "libuavs3d" and reports as "avs3",
 * and DivX 3 decodes through "msmpeg4" while ffprobe reports "msmpeg4v3".
 *
 * Substring matching covers family variants (h263p/i, wmv1/2/3, vp6/vp6f/vp6a,
 * rv10-40, mpeg1video, mjpeg/b).
 *
 * `rawvideo` is registered and deliberately excluded: uncompressed 1080p is
 * ~1.5 Gbps off the server, which no LAN makes sense of. The server's transcode
 * is the right answer for uncompressed sources.
 */
const TRANSCODABLE_VIDEO_CODECS = [
  // Modern and mainstream
  "vp8",
  "vp9",
  "vp7",
  "vp6",
  "vvc", // H.266. No Apple silicon decodes this in hardware; software + VT encode is the only way it plays at all.
  // Only reached when the hardware cannot decode AV1; where it can, the check
  // below copies the stream instead. libdav1d does the software decode.
  "av1",
  "av01",
  "mpeg1video",
  "mpeg1",
  "mpeg2video",
  "mpeg2",
  "mpeg4",
  "wmv",
  "vc1",
  "h263",
  "h261",
  "flv1",
  "rv10",
  "rv20",
  "rv30",
  "rv40",
  "rv60",
  "svq1",
  "svq3",
  // The four MPVKit's decoder allowlist switched off. Nothing exotic: DivX 3 is
  // the format half the internet was encoded in before H.264, and DV is every
  // camcorder tape ever captured.
  "msmpeg4v1",
  "msmpeg4v2",
  "msmpeg4v3",
  "theora",
  "dvvideo",
  "cinepak",
  // Chinese broadcast standards. avs3 rides libuavs3d; cavs (AVS1) is native.
  // Bare "avs" is NOT listed on purpose: prefix matching would swallow "avs2",
  // which needs libdavs2 and is not in this build.
  "avs3",
  "cavs",
  "apv",
  // Intermediate and lossless. These decode to 4:2:2, 4:4:4 or 10/12-bit, which
  // is why they need the libswscale conversion path rather than the three
  // formats VideoTranscoder wraps directly.
  "prores",
  "dnxhd",
  "cfhd",
  "mjpeg",
  "jpeg2000",
  "jpegls",
  "ffv1",
  "ffvhuff",
  "huffyuv",
  "utvideo",
  "magicyuv",
  "lagarith",
  "sheervideo",
  "v210",
  "v410",
  // Screen capture and QuickTime-era formats
  "indeo2",
  "indeo3",
  "indeo4",
  "indeo5",
  "snow",
  "tscc",
  "tscc2",
  "msvideo1",
  "msrle",
  "qtrle",
  "rpza",
  "smc",
  "truemotion1",
  "truemotion2",
  "vp3",
  "vp4",
  "vp5",
  "dxv",
  "hap",
  "txd",
  "mts2",
  "vmnc",
];

/**
 * Producer read-ahead depth, in 6s segments: 20 = a 120s cushion. Sized from the
 * player survey (hls.js caps at 600s, ExoPlayer holds 50s in RAM, mpv's network
 * presets run 512MiB; ours is disk-backed and pruned) so a stalling remote feed
 * is absorbed instead of starving AVPlayer. The engine's own default stays 5;
 * this knob rides the session config, so tuning is a reload, not a rebuild.
 */
const REMUX_READ_AHEAD_SEGMENTS = 20;

// Slipstream (memories/CLAUDE-slipstream.md): multi-variant loopback master
// with a server-assisted tier, AVPlayer switching natively. The gate is the
// MEASUREMENT — the tier declares only on a measured-slow link.
// Video-only variant: audio rides the shared group, so CODECS carries avc1 alone.
const SLIPSTREAM_TIER = { label: "480p", bitrate: 1_500_000, width: 854, height: 480, codecs: "avc1.64001F" };

/**
 * Whether startLocalRemux will configure a Slipstream tier for this item:
 * SDR video with at least one audio stream (the tier variant is video-only
 * and needs the audio group; mixing VIDEO-RANGE across switchable variants
 * breaks the authoring spec).
 */
export function slipstreamEligible(videoItem: JellyfinVideoItem): boolean {
  const videoStreamMeta = (videoItem.MediaStreams ?? []).find((stream) => stream.Type === "Video");
  if (!videoStreamMeta) return false;
  const rangeType = (videoStreamMeta.VideoRangeType || videoStreamMeta.VideoRange || "SDR").toUpperCase();
  const isSdr = !(rangeType.includes("HLG") || rangeType.includes("HDR") || rangeType.includes("DOVI") || rangeType.includes("PQ"));
  return isSdr && (videoItem.MediaStreams ?? []).some((stream) => stream.Type === "Audio");
}

/**
 * The tier's server-fed audio rendition, mirroring the ENGINE group's codec
 * family so a variant switch stays inside AVPlayer's switching envelope
 * (WWDC20 10158: AAC-family and lossless<->AAC only, channel count held).
 * Codecs AVPlayer decodes natively are stream-COPIED by the server — original
 * bits, zero loss on the survival rung; everything else (DTS, TrueHD...)
 * becomes server FLAC, lossless, same family as the engine's FLAC encode.
 */
function serverAudioPlan(stream: JellyfinMediaStream | undefined): { codec: "copy" | "flac"; bandwidth: number; tag: string } {
  const codec = (stream?.Codec ?? "").toLowerCase();
  const channels = stream?.Channels ?? 6;
  const flacEstimate = Math.round(channels * (stream?.SampleRate ?? 48000) * (stream?.BitDepth ?? 16) * 0.6);
  if (codec.startsWith("aac") || codec.startsWith("mp4a")) return { codec: "copy", bandwidth: stream?.BitRate ?? 256_000, tag: "mp4a.40.2" };
  if (codec.startsWith("alac")) return { codec: "copy", bandwidth: stream?.BitRate ?? flacEstimate, tag: "alac" };
  if (codec.startsWith("eac3") || codec.startsWith("ec-3")) return { codec: "copy", bandwidth: stream?.BitRate ?? 768_000, tag: "ec-3" };
  if (codec.startsWith("ac3") || codec.startsWith("ac-3")) return { codec: "copy", bandwidth: stream?.BitRate ?? 640_000, tag: "ac-3" };
  return { codec: "flac", bandwidth: flacEstimate, tag: "fLaC" };
}

/**
 * Carriable audio streams in master-playlist order: the preferred index first,
 * then the file's default flag. [0] is the track marked DEFAULT=YES.
 */
function orderedCarriableAudio(videoItem: JellyfinVideoItem, preferredAudioStreamIndex?: number): JellyfinMediaStream[] {
  return (videoItem.MediaStreams ?? [])
    .filter((stream) => stream.Type === "Audio" && stream.Index !== undefined && isAudioTrackCarriable(stream.Codec))
    .sort((a, b) => Number(b.Index === preferredAudioStreamIndex) - Number(a.Index === preferredAudioStreamIndex) || Number(b.IsDefault === true) - Number(a.IsDefault === true));
}

/**
 * Declared BANDWIDTH of the tier variant (video + its audio-lo rendition), or
 * null when the tier is not worth declaring: an audio-heavy small file can
 * push the rung above the primary, where AVPlayer rightly refuses it. The
 * rung must undercut the primary meaningfully to be a refuge. Also the pin
 * cap for gateway sessions: a fixed preset caps preferredPeakBitRate at
 * exactly this value, so the tier fits and the primary does not.
 */
export function slipstreamTierBandwidth(videoItem: JellyfinVideoItem, preferredAudioStreamIndex?: number): number | null {
  if (!slipstreamEligible(videoItem)) return null;
  const videoStreamMeta = (videoItem.MediaStreams ?? []).find((stream) => stream.Type === "Video");
  // The DEFAULT=YES rendition's cost — the same track the tier's CODECS names.
  const plan = serverAudioPlan(orderedCarriableAudio(videoItem, preferredAudioStreamIndex)[0]);
  const tierBandwidth = SLIPSTREAM_TIER.bitrate + plan.bandwidth;
  const primaryBandwidth = (videoStreamMeta?.BitRate ?? 0) + plan.bandwidth;
  if (primaryBandwidth > 0 && tierBandwidth >= primaryBandwidth * 0.85) return null;
  return tierBandwidth;
}

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
  // (v1/v2/Pro/Lossless all match "wma"), RealMedia carries Cook or Sipr, 3GP
  // carries AMR ("amr" matches amrnb/amrwb), and MiniDisc/PSP-era video carries
  // ATRAC ("atrac" matches atrac1/3/3al/3plus/3plusal/9).
  "mp2",
  "wma",
  "cook",
  "amr",
  "sipr",
  "ralf",
  "atrac",
  // QuickTime-era music, and the lossless formats a music library actually
  // contains. QDM2/QDMC ride old .mov files; WavPack, TAK, Shorten, OptimFROG
  // (osq) and Monkey's Audio are what a ripped collection is stored in.
  // Names here are ffprobe's, which differ from the decoder's for three of
  // these: Musepack decodes through mpc7/mpc8 and reports as "musepack7"/
  // "musepack8", MPEG-4 ALS decodes through "als" and reports as "mp4als", and
  // ATRAC3+ reports as "atrac3p". Prefix matching handles the families.
  "qdm2",
  "qdmc",
  "wavpack",
  "tak",
  "shorten",
  "osq",
  "musepack",
  "mp4als",
  "speex",
  "gsm",
  "nellymoser",
  "twinvq",
  // The rest of what the build registers. Audio has no format ceiling the way
  // video did: AudioTranscoder runs every decoder's output through
  // libswresample, so any registered decoder can ride the pipeline whatever its
  // sample format, rate or layout.
  //
  // "adpcm" is the one that matters in practice — it is the audio of the old
  // AVIs whose Xvid and MS-MPEG4 video the engine already transcodes, and it
  // covers the whole family (~60 decoders) including G.722 and G.726, which
  // ffprobe reports as "adpcm_g722" and "adpcm_g726" rather than under their
  // own names. APE and TTA are lossless music formats; Dolby E is broadcast.
  "adpcm",
  "ape",
  "tta",
  "mp1",
  "dolby_e",
  // Sonic is absent on purpose: its decoder is the build's only experimental
  // one, and nothing here sets strict_std_compliance, so it cannot open.
];

/**
 * Whether the engine can carry one audio track.
 *
 * Prefix match, not substring: family variants still match ("pcm_s16le",
 * "wmav2", "mp4a.40.2", "adpcm_ima_wav"), but unrelated codecs that merely
 * CONTAIN an entry ("atrac3" contains "ac3") do not slip through.
 *
 * Shared by the admission gate and the rendition builder on purpose. They used
 * to disagree: the gate demanded every track be carriable while the builder
 * handed the native side all of them, so the two had to be kept in step by
 * hand.
 */
function isAudioTrackCarriable(codec: string | undefined): boolean {
  const audioCodec = codec?.toLowerCase();
  return !audioCodec || REMUXABLE_AUDIO_CODECS.some((known) => audioCodec.startsWith(known));
}

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

/**
 * Emitted once per session, as soon as the engine has decided.
 *
 * `video` is absent for an audio-only session rather than filled with a
 * placeholder, so a reader can tell "no video track" from "a video track we
 * failed to describe".
 */
export interface EnginePlan {
  token: string;
  video?: EngineTrackPlan;
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

/** Most recently started session; the only one whose plan gets attributed. */
let activePlanToken: string | null = null;
/** Whether that session declared a server tier. Its engine is allowed to produce below realtime:
 *  the tier is what AVPlayer opens on while the source pull catches up. */
let activeTierDeclared = false;

/** Whether the session behind this token opened with a server tier to fall back on. */
export function tierDeclaredFor(token: string | null): boolean {
  return token != null && token === activePlanToken && activeTierDeclared;
}
/** A plan that arrived before its session's start promise resolved. */
let pendingPlan: EnginePlan | null = null;

function reportEnginePlan(plan: EnginePlan): void {
  // The engine's own account of what it did, which is the only one that
  // reaches a physical Apple TV: NSLog does not, and probing the output
  // stream infers rather than reports.
  logger.info("Local remux engine plan", {
    service: "LocalRemux",
    video: plan.video ? describeTrack(plan.video) : "none (audio-only)",
    audio: plan.audio.map(describeTrack),
  });
  probeEmit("enginePlan", { video: plan.video, audio: plan.audio });
}

function watchEnginePlan(): void {
  if (planSubscription || !isLocalRemuxAvailable()) return;
  const emitter = new NativeEventEmitter(LocalRemuxer);
  planSubscription = emitter.addListener("onEnginePlan", (plan: EnginePlan) => {
    // Match by token, not arrival order: the native side replays its cached
    // plan to a fresh listener, so the first event after a JS reload can be a
    // PREVIOUS session's plan and must not be logged against this item. A plan
    // that beats its own start promise parks here until the token is known.
    if (plan.token === activePlanToken) reportEnginePlan(plan);
    else pendingPlan = plan;
  });
}

/** What the session did with its Slipstream tier: the master's verdict once, then a drop if the server stops delivering. */
export interface EngineTierReport {
  token: string;
  state: "listed" | "declined" | "dropped";
  reason?: string;
  /** How long the opening segment took to fetch and rewrap. */
  probeSeconds?: number;
}

let tierSubscription: { remove: () => void } | null = null;

/** Whether the running binary declares an event. A Metro reload can carry JS that knows one the
 *  installed native build does not, and subscribing to it there breaks the module outright. */
function nativeEmits(event: string): boolean {
  const events = (LocalRemuxer as { events?: unknown } | undefined)?.events;
  return Array.isArray(events) && events.includes(event);
}

function watchEngineTier(): void {
  if (tierSubscription || !isLocalRemuxAvailable()) return;
  if (!nativeEmits("onEngineTier")) {
    logger.info("Engine build predates the tier report; playback is unaffected", { service: "LocalRemux" });
    return;
  }
  const emitter = new NativeEventEmitter(LocalRemuxer);
  tierSubscription = emitter.addListener("onEngineTier", (report: EngineTierReport) => {
    // Every report follows the master, which follows this session's start, so a foreign token
    // is a superseded session still winding down.
    if (report.token !== activePlanToken) return;
    logger.info("Slipstream tier", { service: "LocalRemux", state: report.state, reason: report.reason, probeSeconds: report.probeSeconds });
    probeEmit("tier", { state: report.state, ...(report.reason ? { reason: report.reason } : {}), ...(report.probeSeconds != null ? { probeSeconds: report.probeSeconds } : {}) });
  });
}

/** One completed segment as the engine timed it (Remuxer.reportThroughput). */
export type ThroughputSample = {
  token: string;
  generation: number;
  segment: number;
  /** Absent on a generation's first segment, which carries the input seek. */
  produceSeconds?: number;
  segmentSeconds: number;
  /** Segments produced ahead of the last one the player asked for. */
  cushion: number;
  /** The producer slept on its read-ahead cap while making this segment. */
  throttled: boolean;
  thermal: string;
};

type ThroughputListener = (sample: ThroughputSample) => void;
const throughputListeners = new Map<string, Set<ThroughputListener>>();
let throughputSubscription: { remove: () => void } | null = null;

function watchEngineThroughput(): void {
  if (throughputSubscription || !isLocalRemuxAvailable()) return;
  const emitter = new NativeEventEmitter(LocalRemuxer);
  throughputSubscription = emitter.addListener("onEngineThroughput", (sample: ThroughputSample) => {
    throughputListeners.get(sample.token)?.forEach((listener) => listener(sample));
  });
}

/** Samples of one session, until the returned function runs. */
export function subscribeEngineThroughput(token: string, listener: ThroughputListener): () => void {
  watchEngineThroughput();
  const listeners = throughputListeners.get(token) ?? new Set<ThroughputListener>();
  listeners.add(listener);
  throughputListeners.set(token, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) throughputListeners.delete(token);
  };
}

/** A segment that took longer to make than it plays. An untimed sample is not slow. */
export function belowRealtime(sample: Pick<ThroughputSample, "produceSeconds" | "segmentSeconds">): boolean {
  return sample.produceSeconds != null && sample.produceSeconds > sample.segmentSeconds;
}

/**
 * The engine is losing: its last two timed, unthrottled segments of the current generation
 * ran below realtime, and at most one segment stands between the producer and the player.
 */
export function engineStarving(samples: ThroughputSample[]): boolean {
  const latest = samples.at(-1);
  if (!latest) return false;
  const timed = samples.filter((sample) => sample.generation === latest.generation && !sample.throttled && sample.produceSeconds != null);
  return timed.length >= 2 && latest.cushion <= 1 && timed.slice(-2).every(belowRealtime);
}

/** Asked of the device once per process; its decode silicon does not change. */
let decodeSupport: Promise<VideoDecodeSupport> | null = null;
const NO_DECODE_SUPPORT: VideoDecodeSupport = { hevc: false, hevcMain10: false, av1: false };

export function isLocalRemuxAvailable(): boolean {
  return Platform.OS === "ios" && !!LocalRemuxer?.startRemux;
}

/**
 * What this device's VideoToolbox opens (DeviceDecode.swift). Warmed at app start so the
 * lane pick reads a settled answer. Without the engine nothing is assumed decodable.
 */
export function videoDecodeSupport(): Promise<VideoDecodeSupport> {
  if (decodeSupport) return decodeSupport;
  if (!isLocalRemuxAvailable()) return Promise.resolve(NO_DECODE_SUPPORT);
  decodeSupport = (async () => {
    try {
      const support = (await LocalRemuxer.videoDecodeSupport()) as Partial<VideoDecodeSupport> | null;
      const answer = { hevc: support?.hevc === true, hevcMain10: support?.hevcMain10 === true, av1: support?.av1 === true };
      logger.info("Device video decode support", { service: "LocalRemux", ...answer });
      return answer;
    } catch (error) {
      logger.warn("Device decode probe failed", error, { service: "LocalRemux" });
      return NO_DECODE_SUPPORT;
    }
  })();
  return decodeSupport;
}

/** Copy the video where this device's AVPlayer opens it as it stands; re-encode it otherwise. */
async function copiesVideo(videoStream: JellyfinMediaStream | undefined): Promise<boolean> {
  const codec = videoStream?.Codec?.toLowerCase() ?? "";
  if (!codec) return false;
  if (!REMUXABLE_CODECS.some((known) => codec.startsWith(known)) && !AV1_CODECS.some((known) => codec.startsWith(known))) return false;
  return deviceDecodes(codec, videoStream?.BitDepth, await videoDecodeSupport());
}

/** One measured pass of VideoTranscoder.benchmark, as the native side records it. */
export type TranscodeBenchmark = {
  encode: boolean;
  codec?: string;
  decoder?: string;
  encoder?: string;
  pixFmt?: string;
  conversion?: string;
  width?: number;
  height?: number;
  sourceFps?: number;
  frames?: number;
  seconds?: number;
  fps?: number;
  realtime?: number;
  loops?: number;
  windows?: number[];
  deinterlaced?: boolean;
  thermalBefore?: string;
  thermalAfter?: string;
  failed?: string;
  device?: string;
  build?: string;
  cores?: number;
};

/** Runs the software-decode lane on `inputUrl` for `wallSeconds`; dev tooling (app/dev-bench.tsx). */
export async function benchmarkTranscode(inputUrl: string, { wallSeconds, encode }: { wallSeconds: number; encode: boolean }): Promise<TranscodeBenchmark> {
  if (!isLocalRemuxAvailable()) throw new Error("Local remux native module not available on this platform");
  return (await LocalRemuxer.benchmarkTranscode({ inputUrl, wallSeconds, encode })) as TranscodeBenchmark;
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
  if (!videoItem?.MediaStreams) return declineRemux("no media streams");

  // An audio-only item has no video stream to judge, and the engine runs a
  // video-less session for it (Remuxer.runPipeline, `hasVideo`). Its audio
  // still has to be carriable, so the checks below this point all apply.
  const videoStream = videoItem.MediaStreams.find((stream) => stream.Type === "Video");
  const audioOnly = !videoStream && videoItem.MediaStreams.some((stream) => stream.Type === "Audio");
  if (!audioOnly && !videoStream?.Codec) return declineRemux("no video codec in metadata");
  const codec = videoStream?.Codec?.toLowerCase() ?? "";

  // Audio is either copied or re-encoded on device; only codecs the linked
  // FFmpeg has no decoder for stay on the server path. Multi-track files are
  // fine: each carriable track becomes its own HLS audio rendition, so
  // switching still works and still costs the server nothing.
  //
  // One uncarriable track used to condemn the whole file. A disc rip with eight
  // soundtracks, seven of them AC-3 and one RealAudio, went to the server
  // entirely — video re-encoded, every lossless track destroyed — over a track
  // nobody selected. Now the uncarriable ones are dropped and the rest play;
  // only a file with no carriable track at all still declines. A file with no
  // audio whatsoever was always fine and stays fine.
  const audioTracks = videoItem.MediaStreams.filter((stream) => stream.Type === "Audio");
  const carriable = audioTracks.filter((track) => isAudioTrackCarriable(track.Codec));
  if (audioTracks.length > 0 && carriable.length === 0) {
    return declineRemux("no carriable audio track", { codecs: audioTracks.map((track) => track.Codec ?? "unknown").join(", ") });
  }
  if (carriable.length < audioTracks.length) {
    logger.info("Dropping audio tracks the engine cannot carry", {
      service: "LocalRemux",
      dropped: audioTracks.filter((track) => !isAudioTrackCarriable(track.Codec)).map((track) => track.Codec ?? "unknown"),
      kept: carriable.length,
    });
  }

  if (!videoItem.RunTimeTicks || videoItem.RunTimeTicks <= 0) return declineRemux("no runtime in metadata");

  // Audio-only: the carriable check above is the whole test. There is no video
  // codec, resolution or pixel format left to judge.
  if (audioOnly) return true;

  // Prefix match everywhere, same reason as the audio list: family variants
  // match ("hvc1", "wmv3", "vp6f"), codecs that merely CONTAIN an entry do not
  // ("msmpeg4v3" contains "mpeg4", and the two are unrelated formats decoded by
  // different decoders — they are listed separately on purpose).
  // Copied where this device decodes them, re-encoded on device where it does not
  // (an Apple TV HD and 10-bit HEVC); either way the engine takes the file.
  if (REMUXABLE_CODECS.some((known) => codec.startsWith(known))) return true;
  if (AV1_CODECS.some((known) => codec.startsWith(known))) return true;

  // Exotic codecs, decoded and re-encoded on device at any size, depth or field
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
 * draw, and the tier rule startLocalRemux runs — `smallFeedFirst` is true when
 * the remembered link sits below the source and a tier would declare, so the
 * session opens on the smaller server-fed rung. Audio-only items report
 * "copy" — there is no video to re-encode.
 */
export async function predictPlaybackLane(videoItem: JellyfinVideoItem | null): Promise<{ lane: PlaybackLane; smallFeedFirst: boolean }> {
  const lane = await (async (): Promise<PlaybackLane> => {
    // A verdict describes streaming this file. A held file has no link to lose to, and the
    // server lane is exactly what a download exists to do without.
    if (videoItem && !playsFromDisk(videoItem.Id) && (await rememberedVerdict(videoItem))) return "server";
    if (!(await canRemuxLocally(videoItem, { record: false }))) return "server";
    const videoStream = videoItem?.MediaStreams?.find((stream) => stream.Type === "Video");
    if (!videoStream) return "copy";
    return (await copiesVideo(videoStream)) ? "copy" : "deviceTranscode";
  })();
  if (lane === "server" || videoItem == null) return { lane, smallFeedFirst: false };
  const sourceBps = videoItem.MediaSources?.[0]?.Bitrate ?? 0;
  const measuredBps = sourceBps > 0 && !playsFromDisk(videoItem.Id) ? await rememberedBitrate() : null;
  return { lane, smallFeedFirst: measuredBps != null && measuredBps < sourceBps && slipstreamTierBandwidth(videoItem) != null };
}

/**
 * H.264 profile_idc and constraint-flag byte, the `PPCC` of `avc1.PPCCLL`.
 *
 * ONLY the two profiles proved against Jellyfin's own output are listed. Every
 * codec, profile and level combination in the test library was computed with
 * this table and diffed against the string Jellyfin puts in its master playlist
 * for the same file, on files it stream-copies so both describe one bitstream:
 *
 *   High/31 avc1.64001F   High/41 avc1.640029   Main/30 avc1.4D401E
 *   Main/31 avc1.4D401F   Main/51 avc1.4D4033   HEVC Main 10/120 hvc1.2.4.L120.B0
 *
 * Baseline and the High 4:2:x profiles are deliberately absent. A CODECS string
 * AVPlayer disagrees with is a hard rejection of the whole variant, and nothing
 * in the library can prove those, so they get no attribute at all — which is
 * what every SDR variant got before this existed, so nothing regresses.
 */
const H264_PROFILE_TAG: Record<string, string> = {
  main: "4D40",
  high: "6400",
};

/**
 * RFC 6381 tag for the video the engine will actually serve, or "" when it
 * cannot be stated as fact.
 *
 * Empty whenever the engine will re-encode: VideoTranscoder pins no profile or
 * level, so its VideoToolbox output is not knowable when this playlist is
 * written, and guessing it is the one mistake this attribute punishes.
 */
export function videoCodecTag(videoStream: JellyfinMediaStream | undefined, willCopyVideo: boolean): string {
  const level = videoStream?.Level ?? 0;
  if (!willCopyVideo || !videoStream || level <= 0) return "";

  const codec = videoStream.Codec?.toLowerCase() ?? "";
  const profile = videoStream.Profile?.trim().toLowerCase() ?? "";

  if (codec === "h264") {
    const tag = H264_PROFILE_TAG[profile];
    return tag ? `avc1.${tag}${level.toString(16).toUpperCase().padStart(2, "0")}` : "";
  }
  // HDR10 and HLG are Main 10 by definition, which is the one HEVC profile the
  // library can prove. Other HEVC profiles fall through to no attribute.
  if (codec === "hevc" && profile === "main 10") return `hvc1.2.4.L${level}.B0`;
  // Copied AV1. Jellyfin's Level is the sequence header's seq_level_idx
  // verbatim; the bitstream spec forces Main tier ("M") for levels <= 7, and
  // above that the tier bit is not in the metadata, so "M" is the same
  // required-attribute guess hdrFallbackTag makes.
  if (AV1_CODECS.some((known) => codec.startsWith(known)) && profile === "main" && videoStream.BitDepth) {
    return `av01.0.${String(level).padStart(2, "0")}M.${String(videoStream.BitDepth).padStart(2, "0")}`;
  }
  return "";
}

/**
 * SUPPLEMENTAL-CODECS for a Dolby Vision source the engine copies, or "".
 *
 * Profile 8 with BL compatibility 1 (PQ) or 4 (HLG) is single-layer: the base
 * layer IS HDR10 or HLG, so CODECS keeps its hvc1 token and DV rides alongside.
 * A player that ignores the attribute sees exactly the manifest it sees today.
 *
 * Profile 7 is dual-layer, which Apple decodes nowhere, so DolbyVisionConverter
 * rewrites its RPUs to single-layer 8.1 during the copy and it is advertised as
 * what it arrives as, 8.1 / db1p. The engine fails the session to the server if
 * it meets a profile 7 it cannot convert, so this never outruns the stream.
 *
 * Profile 5 is not backward compatible and returns "".
 *
 * `dvh1` rather than `dvhe` because Remuxer tags the sample entry `hvc1`: the
 * two must agree (ISO/IEC 14496-15) or the sample description is misread.
 */
export function dolbyVisionSupplementalCodecs(stream: JellyfinMediaStream | undefined, willCopyVideo: boolean): string {
  // A re-encode drops the RPU, so the claim would outlive the metadata.
  if (!stream || !willCopyVideo) return "";
  if (stream.RpuPresentFlag !== 1) return "";

  const level = stream.DvLevel && stream.DvLevel > 0 ? stream.DvLevel : 6;
  // Converted profile 7 lands on 8.1 whatever compatibility id the source carried.
  if (stream.DvProfile === 7) return `dvh1.08.${String(level).padStart(2, "0")}/db1p`;
  if (stream.DvProfile !== 8 || stream.ElPresentFlag === 1) return "";

  const brand = stream.DvBlSignalCompatibilityId === 1 ? "db1p" : stream.DvBlSignalCompatibilityId === 4 ? "db4h" : "";
  if (!brand) return "";
  return `dvh1.08.${String(level).padStart(2, "0")}/${brand}`;
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
  /** Filesystem path of a track saved with a download; the engine serves those bytes itself. */
  localVtt: string;
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
      // A track saved with the download is a PATH, not a URL: the engine serves its bytes over
      // the loopback. A file:// URI inside an http playlist is a scheme AVFoundation will not
      // follow, and handing it one loses the whole asset, not just the subtitle.
      const localVtt = isImage ? "" : (localSubtitleUri(videoItem.Id, stream.Index as number) ?? "");
      return { stream, isImage, localVtt, vttUrl: isImage || localVtt ? "" : getSubtitleUrl(videoItem.Id, stream.Index as number, "vtt") };
    })
    .filter((entry) => entry.isImage || entry.localVtt.length > 0 || entry.vttUrl.length > 0);

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
    localVtt: entry.localVtt,
    isDefault: position === firstDefault,
    // Forced tracks used to be burned into the picture. They are renditions
    // now, and the flag reaches the playlist as AUTOSELECT=YES so the track
    // presents itself without being asked for. Never as FORCED=YES: AVKit
    // withholds one of those from the picker and does not apply it either.
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

/** What the master playlist actually carries: Remuxer.masterPlaylist() strips quotes from NAME. */
function manifestName(name: string): string {
  return name.replace(/"/g, "");
}

/**
 * Resolve the viewer's pick in AVKit's own subtitle picker to a source stream.
 *
 * Identity is the rendition's NAME. The engine writes it into the master playlist
 * (Remuxer.masterPlaylist) and AVFoundation hands it back as the option's display
 * title, verbatim — measured on device, published === reported — and
 * subtitleLabels() guarantees no two renditions of a file share one.
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
  // that does not declare CLOSED-CAPTIONS=NONE — AVKit shows it as "CC" and it
  // draws nothing. Measured on T88, which has no subtitle streams at all and
  // still reported one track.
  if (renditions.length === 0) return nothing;

  if (selected.length > 1) {
    return { ...nothing, reason: `${selected.length} tracks report selected at once, so the pick cannot be read; two renditions are sharing a display name` };
  }

  const ordinal = selected[0].index;
  const title = selected[0].title?.trim() ?? "";
  const named = title ? renditions.find((rendition) => manifestName(rendition.name) === title) : undefined;
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
 * Start a remux session and return the loopback HLS URL for the player.
 * Throws when the native module is unavailable or the session cannot start;
 * callers fall back to the server transcode path.
 */
export async function startLocalRemux(videoItem: JellyfinVideoItem, preferredAudioStreamIndex?: number, startOffsetSeconds?: number): Promise<string> {
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
  // Uncarriable tracks are filtered out rather than handed over: the engine
  // fails a session it cannot build a rendition for, and canRemuxLocally now
  // admits files that carry one (see isAudioTrackCarriable).
  const orderedAudio = orderedCarriableAudio(videoItem, preferredAudioStreamIndex);
  const audioTracks = orderedAudio.map((stream) => ({
    index: stream.Index as number,
    name: stream.DisplayTitle || stream.Language || `Audio ${stream.Index}`,
    language: stream.Language || "und",
    isDefault: stream.IsDefault === true,
  }));
  // Built by the shared helper so the app's ordinal lookup sees exactly this
  // list, in exactly this order.
  const subtitles = subtitleRenditions(videoItem);

  // HLS VIDEO-RANGE for the master playlist. Apple's spec requires it and
  // AVFoundation hard-rejects PQ (HDR10/DoVi-with-PQ) content in a variant
  // that doesn't declare it (-12927). Jellyfin's VideoRangeType is the source:
  // HDR10/HDR10+/DOVI are PQ-transfer, HLG is HLG, everything else SDR.
  // Empty on an audio-only session, where VIDEO-RANGE has nothing to describe
  // and the engine leaves the attribute off entirely (Remuxer.masterPlaylist).
  const videoStreamMeta = (videoItem.MediaStreams ?? []).find((stream) => stream.Type === "Video");
  const rangeType = (videoStreamMeta?.VideoRangeType || videoStreamMeta?.VideoRange || "SDR").toUpperCase();
  const videoRange = !videoStreamMeta ? "" : rangeType.includes("HLG") ? "HLG" : rangeType.includes("HDR") || rangeType.includes("DOVI") || rangeType.includes("PQ") ? "PQ" : "SDR";

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
  // The track the master playlist marks DEFAULT=YES — not the first Audio
  // stream in source order, which can be a different track entirely.
  const primaryAudio = orderedAudio[0] ?? (videoItem.MediaStreams ?? []).find((stream) => stream.Type === "Audio");
  const primaryAudioCodec = primaryAudio?.Codec?.toLowerCase() ?? "";
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
  // The engine copies the video this device decodes and re-encodes everything else, which
  // is exactly the line between a CODECS tag we can state and one we would be inventing.
  const willCopyVideo = await copiesVideo(videoStreamMeta);
  // A device that cannot decode Main 10 gets 8-bit H.264 from the encoder (VideoTranscoder
  // picks hevc_videotoolbox only where it can), so the variant declares SDR and no HDR tag.
  const flattensToSdr = !willCopyVideo && !(await videoDecodeSupport()).hevcMain10;
  const declaredRange = flattensToSdr ? (videoRange ? "SDR" : "") : videoRange;

  // A non-SDR variant MUST carry CODECS whatever else happens: AVFoundation
  // refuses to select a PQ or HLG variant whose codec support it cannot verify,
  // and with no selectable variant the entire master playlist fails. So HDR
  // keeps its long-standing fallback even for a profile we have not measured.
  const measuredVideoTag = videoCodecTag(videoStreamMeta, willCopyVideo);
  const hdrFallbackTag = `hvc1.2.4.L${videoStreamMeta?.Level && videoStreamMeta.Level > 0 ? videoStreamMeta.Level : 123}.B0`;
  const videoTag = measuredVideoTag || (declaredRange === "SDR" || declaredRange === "" ? "" : hdrFallbackTag);
  // An audio-only variant carries the audio token by itself. There is no video
  // tag to pair it with and no reason to withhold it: the caveat that keeps
  // CODECS off a transcoded video variant is about a token we would be
  // inventing, and the audio one is measured from the source.
  // CODECS names what the rendition CONTAINS (Apple HLS authoring 8.3): a video-only source
  // gets the video token alone, or AVFoundation validates the master against audio that is
  // not there.
  const codecs = videoTag ? (primaryAudio ? `${videoTag},${audioCodecTag}` : videoTag) : videoStreamMeta ? "" : audioCodecTag;
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

  // Peak bit rate is the video plus the audio we will really serve. Jellyfin
  // computes it the same way and its arithmetic was confirmed exactly on two
  // files it stream-copies: T11 declared 5858053 for a 5666053 video and
  // 192000 of audio, T09 declared 5637236 for 5445236 and the same audio.
  //
  // FLAC is the one case where our output is BIGGER than the source, since the
  // engine decodes lossy surround into it. Estimated from the source's own
  // shape rather than measured, because the playlist is written before FFmpeg
  // opens the input; roughly 60% of PCM is the usual FLAC ratio.
  // Same track the CODECS tag describes, for the same reason.
  const audioBitRate =
    audioCodecTag === "fLaC" ? Math.round((primaryAudio?.Channels ?? 2) * (primaryAudio?.SampleRate ?? 48000) * (primaryAudio?.BitDepth ?? 16) * 0.6) : (primaryAudio?.BitRate ?? 192_000);
  const bandwidth = (videoStreamMeta?.BitRate ?? 0) + audioBitRate;

  // Before the call: the engine reports its plan from the pipeline thread,
  // which can beat this promise's resolution.
  watchEnginePlan();
  watchEngineTier();

  // Slipstream tier config. The undercut rule lives in slipstreamTierBandwidth:
  // null means the rung would not meaningfully undercut the primary (audio-
  // heavy small files) and no tier is declared. When declared, every audio
  // track gets a server audio-only rendition URL — the tier's "audio-lo"
  // group, so the survival rung never depends on the engine's source pull.
  // BANDWIDTH covers the variant PLUS its renditions (RFC 8216 §4.3.4.2)
  // and CODECS names the group's audio codec.
  // A link measured below the source opens on the smallest feed: the tier is
  // declared and listed FIRST, and AVPlayer climbs to the primary from its
  // own delivery measurements. Healthy or unmeasured sessions declare NO
  // tier — AVPlayer's per-host loopback history otherwise steers it there
  // anyway (device-logged), moving audio to the server-fed group for nothing.
  // A held file is read off the disk, so the link to the server describes nothing about this
  // session and the tier would put a server URL first in a playlist that must carry none.
  const sourceBps = videoItem.MediaSources?.[0]?.Bitrate ?? 0;
  const measuredBps = sourceBps > 0 && !playsFromDisk(videoItem.Id) ? await rememberedBitrate() : null;
  const linkBelowSource = measuredBps != null && measuredBps < sourceBps;
  const tierBandwidth = linkBelowSource && audioTracks.length > 0 ? slipstreamTierBandwidth(videoItem, preferredAudioStreamIndex) : null;
  const streamsByIndex = new Map((videoItem.MediaStreams ?? []).map((stream) => [stream.Index, stream]));
  const tierAudioPlan = serverAudioPlan(primaryAudio);
  const tierConfig =
    tierBandwidth != null
      ? {
          tierPlaylistUrl: getTierPlaylistUrl(videoItem.Id, videoItem, SLIPSTREAM_TIER, generatePlaySessionId()),
          tierBandwidth,
          tierCodecs: `${SLIPSTREAM_TIER.codecs},${tierAudioPlan.tag}`,
          tierWidth: SLIPSTREAM_TIER.width,
          tierHeight: SLIPSTREAM_TIER.height,
        }
      : {};
  const audioTracksConfig =
    tierBandwidth != null
      ? audioTracks.map((track) => {
          const stream = streamsByIndex.get(track.index);
          const plan = serverAudioPlan(stream);
          return { ...track, serverAudioUrl: getAudioRenditionUrl(videoItem.Id, videoItem, track.index, plan.codec, stream?.Channels ?? 6, generatePlaySessionId()) };
        })
      : audioTracks;

  const tierFirst = tierBandwidth != null;
  probeEmit("variant", { videoRange: declaredRange, codecs, supplementalCodecs: supplementalCodecs || "(none)", audioTracks: audioTracks.length, tierFirst });

  const url: string = await LocalRemuxer.startRemux({
    inputUrl,
    itemId: videoItem.Id,
    audioTracks: audioTracksConfig,
    durationSeconds,
    subtitles,
    videoRange: declaredRange,
    codecs,
    supplementalCodecs,
    width,
    height,
    frameRate,
    bandwidth,
    readAheadSegments: REMUX_READ_AHEAD_SEGMENTS,
    // EXT-X-START resume: AVPlayer opens at the offset; its first segment
    // request drives the producer's seek-restart there (no position-zero
    // production, no post-load auto-seek).
    startOffsetSeconds: startOffsetSeconds != null && startOffsetSeconds > 0 ? startOffsetSeconds : 0,
    tierFirst,
    ...tierConfig,
  });

  // The token is the path segment of the master URL (…/<token>/master.m3u8).
  // The CALLER owns it and must hand it back to stopLocalRemux; see
  // localRemuxToken() and the note on stopLocalRemux for why this cannot be
  // module state.

  // Plan attribution: honor this session's plan, and flush it if it arrived
  // before this promise resolved.
  activePlanToken = localRemuxToken(url);
  activeTierDeclared = tierFirst;
  if (pendingPlan) {
    // A parked plan either belongs to this session or to a superseded one;
    // both ways the slot is done with it.
    if (pendingPlan.token === activePlanToken) reportEnginePlan(pendingPlan);
    pendingPlan = null;
  }

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
 * Whether the measured link's total buffer debt for this file outruns the
 * engine cushion: duration x (source/measured - 1) > cushion seconds. Below
 * it, the cushion carries the whole deficit at original quality.
 */
export function deficitExceedsCushion(measuredBps: number | null, sourceBps: number, durationSeconds: number): boolean {
  if (measuredBps == null || sourceBps <= 0 || measuredBps >= sourceBps) return false;
  return durationSeconds * (sourceBps / measuredBps - 1) > REMUX_READ_AHEAD_SEGMENTS * 6;
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

/** The manifest a download wrote next to its media, or null before it has any. */
async function readLocalManifest(url: string): Promise<string | null> {
  try {
    const file = new File(url);
    return file.exists ? await file.text() : null;
  } catch (error) {
    logger.debug("Local image subtitle manifest unreadable", { service: "LocalRemux", error: String(error) });
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

/**
 * Playlist shim for server-lane resume: the transcode's playlists re-served
 * through the loopback with EXT-X-START injected, so AVPlayer opens the
 * stream AT the resume point instead of buffering position zero (one ffmpeg
 * spin-up at the right place, no dead download, full-duration timeline).
 * Resolves the local master URL, or null when the module is missing or the
 * shim fails — callers fall back to the raw URL plus the client seek.
 * The token (localRemuxToken on the URL) owns the shim; hand it to
 * stopPlaylistShim on teardown.
 */
export async function startPlaylistShim(masterUrl: string, startOffsetSeconds: number): Promise<string | null> {
  if (!isLocalRemuxAvailable() || !(startOffsetSeconds > 0)) return null;
  try {
    return await LocalRemuxer.startPlaylistShim({ masterUrl, startOffsetSeconds });
  } catch (error) {
    logger.warn("Failed to start playlist shim", error, { service: "LocalRemux" });
    return null;
  }
}

export async function stopPlaylistShim(token: string | null): Promise<void> {
  if (!isLocalRemuxAvailable() || !token) return;
  try {
    await LocalRemuxer.stopPlaylistShim(token);
  } catch (error) {
    logger.warn("Failed to stop playlist shim", error, { service: "LocalRemux", token });
  }
}

/**
 * Chapter keyframes for the lanes that run no remux session, resolved as the base URL they
 * answer under, or null when the engine cannot start one. The caller owns the token on that
 * URL and hands it to stopFrameProvider.
 */
export async function startFrameProvider(inputUrl: string, itemId: string): Promise<string | null> {
  if (!isLocalRemuxAvailable() || !inputUrl) return null;
  try {
    return await LocalRemuxer.startFrameProvider({ inputUrl, itemId });
  } catch (error) {
    logger.warn("Failed to start frame provider", error, { service: "LocalRemux" });
    return null;
  }
}

export async function stopFrameProvider(token: string | null): Promise<void> {
  if (!isLocalRemuxAvailable() || !token) return;
  try {
    await LocalRemuxer.stopFrameProvider(token);
  } catch (error) {
    logger.warn("Failed to stop frame provider", error, { service: "LocalRemux", token });
  }
}

/** Where Jellyfin's own screen grabber takes a poster: a tenth of the way in, or 10 s when the runtime is unknown. */
export function posterFrameSeconds(item: Pick<JellyfinVideoItem, "RunTimeTicks">): number {
  const runtime = (item.RunTimeTicks || 0) / JELLYFIN_TIME.TICKS_PER_SECOND;
  return runtime > 0 ? runtime / 10 : 10;
}

/** Settled posters by item id. A failure is kept as null, retried on the policy below, and stands. */
const posterFrames = new Map<string, string | null>();
const posterFramesInFlight = new Map<string, Promise<string | null>>();
/** Cards waiting on each job; the engine is told to drop a job only when the last one leaves. */
const posterFrameWaiters = new Map<string, number>();

/** The engine answers nothing both for a file with no frame in it and for a source it could not
 *  open, so a failure is retried after the window, three times, and only then stands. */
export const POSTER_FRAME_RETRY_MS = 60_000;
export const POSTER_FRAME_ATTEMPTS = 3;
const posterFrameFailures = new Map<string, { at: number; attempts: number }>();

/** True while a stored failure is one this item has earned another try at. */
function posterFrameRetryable(itemId: string, now = Date.now()): boolean {
  const failure = posterFrameFailures.get(itemId);
  return !!failure && failure.attempts < POSTER_FRAME_ATTEMPTS && now - failure.at >= POSTER_FRAME_RETRY_MS;
}

function recordPosterFrameFailure(itemId: string): void {
  const failure = posterFrameFailures.get(itemId);
  posterFrameFailures.set(itemId, { at: Date.now(), attempts: (failure?.attempts ?? 0) + 1 });
}

/** Bumped by every clear, so a job that outlived one writes nothing back and picture keys change. */
let posterFrameGen = 0;
/** Bumped when a settled poster had to be decoded again, so the picture key changes and a card reloads it. */
const posterFrameRevisions = new Map<string, number>();

/** The settled answer for an item, or undefined before any request has finished or while a
 *  failure is due another try. */
export function posterFrameIfCached(itemId: string): string | null | undefined {
  const settled = posterFrames.get(itemId);
  return settled === null && posterFrameRetryable(itemId) ? undefined : settled;
}

/** A keyframe decode of ours is open: it shares the cores and the link the engine is timed on. */
export function posterFrameWorkInFlight(): boolean {
  return posterFramesInFlight.size > 0;
}

/** Which set of answers is current. Mixed into the image cache key so a switch redraws. */
export function posterFrameGeneration(): number {
  return posterFrameGen;
}

export function posterFrameRevision(itemId: string): number {
  return posterFrameRevisions.get(itemId) ?? 0;
}

export function clearPosterFrameCache(): void {
  posterFrameGen += 1;
  // A job of the generation being left writes nothing back, but is still open against a server
  // the app has left.
  for (const itemId of posterFramesInFlight.keys()) if (LocalRemuxer?.cancelPosterFrame) void LocalRemuxer.cancelPosterFrame(itemId);
  posterFrames.clear();
  posterFramesInFlight.clear();
  posterFrameWaiters.clear();
  posterFrameFailures.clear();
  posterFrameRevisions.clear();
}

/** Drops the engine's pooled frames: ids collide across servers, so none may outlive a switch. */
export async function clearFramePool(): Promise<void> {
  if (!isLocalRemuxAvailable()) return;
  try {
    await LocalRemuxer.clearFramePool();
  } catch (error) {
    logger.warn("Failed to clear the frame pool", error, { service: "LocalRemux" });
  }
}

/**
 * A keyframe for a card the server left without a poster, decoded by the engine into the
 * frame pool and answered as a file URL. Callers asking at once share one job. A job the
 * engine dropped is asked again while a card still waits, and settles nothing otherwise.
 * A failure stands until it is due a retry; a success is confirmed with the engine, which
 * decodes again a poster whose file the pool has trimmed since.
 */
export async function requestPosterFrame(item: Pick<JellyfinVideoItem, "Id" | "RunTimeTicks">): Promise<string | null> {
  const settled = posterFrameIfCached(item.Id);
  if (settled === null) return null;
  if (!isLocalRemuxAvailable()) return null;
  posterFrameWaiters.set(item.Id, (posterFrameWaiters.get(item.Id) ?? 0) + 1);
  const pending = posterFramesInFlight.get(item.Id);
  if (pending) return pending;
  const generation = posterFrameGen;
  const job = (async (): Promise<string | null> => {
    try {
      const inputUrl = localMediaUri(item.Id) ?? getRemoteVideoStreamUrl(item.Id);
      let result: { uri?: string | null; cancelled?: boolean; fresh?: boolean } | undefined;
      do {
        result = await LocalRemuxer.posterFrame({ itemId: item.Id, inputUrl, seconds: posterFrameSeconds(item) });
        // A cancel from a card that left lands on the job a card arriving since has joined: ask again for it.
      } while (result?.cancelled && generation === posterFrameGen && (posterFrameWaiters.get(item.Id) ?? 0) > 0);
      if (result?.cancelled) return null;
      const uri = result?.uri ?? null;
      if (generation === posterFrameGen) {
        posterFrames.set(item.Id, uri);
        if (uri === null) recordPosterFrameFailure(item.Id);
        else posterFrameFailures.delete(item.Id);
        if (settled !== undefined && result?.fresh) posterFrameRevisions.set(item.Id, posterFrameRevision(item.Id) + 1);
      }
      return uri;
    } catch (error) {
      logger.warn("Poster frame failed", error, { service: "LocalRemux", itemId: item.Id });
      if (generation === posterFrameGen) {
        posterFrames.set(item.Id, null);
        recordPosterFrameFailure(item.Id);
      }
      return null;
    } finally {
      // A cleared generation owns none of these entries: a job started since holds them.
      // The waiter count is owed one cancel per mounted card, and settling is not a card leaving.
      if (generation === posterFrameGen) posterFramesInFlight.delete(item.Id);
    }
  })();
  posterFramesInFlight.set(item.Id, job);
  return job;
}

/** A card leaving the screen. The engine drops the job once no card waits on it. */
export function cancelPosterFrame(itemId: string): void {
  const waiting = posterFrameWaiters.get(itemId) ?? 0;
  if (waiting > 1) {
    posterFrameWaiters.set(itemId, waiting - 1);
    return;
  }
  posterFrameWaiters.delete(itemId);
  if (waiting === 1 && LocalRemuxer?.cancelPosterFrame) void LocalRemuxer.cancelPosterFrame(itemId);
}
