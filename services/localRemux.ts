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
// Submodules, not the barrel: the barrel re-exports liveTv, which imports this module.
import { JELLYFIN_TIME } from "@/services/jellyfin/constants";
import { audioCatalogue, playbackMediaStreams, type AudioCatalogueTrack } from "@/services/jellyfin/audioTracks";
import { generatePlaySessionId, getCachedConfig } from "@/services/jellyfin/session";
import { getSubtitleUrl, isDvdSubCodec, isImageBasedSubtitleCodec, isPgsCodec } from "@/services/jellyfin/subtitles";
import { deviceDecodes, isLiveSource, sourceVideoRange } from "@/services/jellyfin/media";
import { rememberedVerdict } from "@/services/engineVerdicts";
import { localMediaUri, localSubtitleUri, playsFromDisk } from "@/services/downloads/localSource";
import { getAudioRenditionUrl, getRemoteVideoStreamUrl, getTierPlaylistUrl, getVideoStreamUrl } from "@/services/jellyfin/streamUrls";
import { rememberedBitrate } from "@/services/jellyfin/bitrateTest";
import type { JellyfinMediaStream, JellyfinVideoItem } from "@/types/jellyfin";
import { noteDeviceDecode, probeEmit } from "@/services/playbackProbe";
import { logger } from "@/utils/logger";

const { LocalRemuxer } = NativeModules;
/** Same, but only on hardware that reports AV1 decode support at runtime. */
const AV1_CODECS = ["av1", "av01"];

/**
 * Live segment target. AVPlayer starts a live playlist three target durations in (tvOS sim,
 * 2026-09-11): 2s puts the first frame ~12s after the press on a transcoded channel, 6s ~21s.
 */
const LIVE_SEGMENT_SECONDS = 2;

/** Every codec the engine takes, video copied or decoded and audio carried: the live DeviceProfile. */
export function engineCodecAllowlists(): { video: string[]; audio: string[] } {
  return { video: [...REMUXABLE_CODECS, ...AV1_CODECS, ...TRANSCODABLE_VIDEO_CODECS], audio: [...REMUXABLE_AUDIO_CODECS] };
}

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
  if (!isAudioTrackCarriable(stream.Codec)) return { usesServerAudio: true, codecs: "mp4a.40.2", bandwidth: RUNG_AUDIO_BANDWIDTH };
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
  identity?: string;
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

type TierListener = (report: EngineTierReport) => void;
const tierListeners = new Map<string, Set<TierListener>>();

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
    tierListeners.get(report.token)?.forEach((listener) => listener(report));
    // Every report follows the master, which follows this session's start, so a foreign token
    // is a superseded session still winding down.
    if (report.token !== activePlanToken) return;
    logger.info("Slipstream tier", { service: "LocalRemux", state: report.state, reason: report.reason, probeSeconds: report.probeSeconds });
    probeEmit("tier", { state: report.state, ...(report.reason ? { reason: report.reason } : {}), ...(report.probeSeconds != null ? { probeSeconds: report.probeSeconds } : {}) });
  });
}

/** One session's tier verdict, until the returned function runs. Never fires on a native build without the event. */
export function subscribeEngineTier(token: string, listener: TierListener): () => void {
  watchEngineTier();
  const listeners = tierListeners.get(token) ?? new Set<TierListener>();
  listeners.add(listener);
  tierListeners.set(token, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) tierListeners.delete(token);
  };
}

/** The link rate the engine measured behind the loopback, in bits per second. */
export type EngineLinkReport = { token: string; bps: number; copyListed?: boolean };

type LinkListener = (report: EngineLinkReport) => void;
const linkListeners = new Map<string, Set<LinkListener>>();
const linkReports = new Map<string, EngineLinkReport | null>();
let linkSubscription: { remove: () => void } | null = null;

function rememberLink(token: string, report: EngineLinkReport | null): void {
  linkReports.delete(token);
  linkReports.set(token, report);
  if (linkReports.size > 32) linkReports.delete(linkReports.keys().next().value!);
}

function watchEngineLink(): void {
  if (linkSubscription || !isLocalRemuxAvailable()) return;
  if (!nativeEmits("onEngineLink")) {
    logger.info("Engine build predates the link report; the session plays uncapped", { service: "LocalRemux" });
    return;
  }
  const emitter = new NativeEventEmitter(LocalRemuxer);
  linkSubscription = emitter.addListener("onEngineLink", (report: EngineLinkReport) => {
    if (!report.token || !Number.isFinite(report.bps) || report.bps <= 0 || linkReports.get(report.token) === null) return;
    rememberLink(report.token, report);
    linkListeners.get(report.token)?.forEach((listener) => listener(report));
  });
}

/**
 * The engine's measured link rate for one session, until the returned function runs. AVPlayer
 * measures the loopback, which says nothing about the link behind the engine, so this is what the
 * variant cap is built from. Never fires on a native build without the event.
 */
export function subscribeEngineLink(token: string, listener: LinkListener): () => void {
  watchEngineLink();
  const listeners = linkListeners.get(token) ?? new Set<LinkListener>();
  listeners.add(listener);
  linkListeners.set(token, listeners);
  const latest = linkReports.get(token);
  if (latest) listener(latest);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) linkListeners.delete(token);
  };
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
  /** Wall seconds the producer spent blocked on the input while making this segment. */
  readSeconds?: number;
};

/** Share of a segment's wall time spent waiting on the input above which the link, not the engine, set the pace. */
export const READ_BOUND_SHARE = 0.6;

/** The segment took long because its bytes arrived slowly, not because the engine was slow. */
export function readBound(sample: Pick<ThroughputSample, "produceSeconds" | "readSeconds">): boolean {
  return sample.produceSeconds != null && sample.produceSeconds > 0 && sample.readSeconds != null && sample.readSeconds / sample.produceSeconds >= READ_BOUND_SHARE;
}

/** What a session has read so far (Remuxer.progress), or null without the session or the native method. */
export type EngineProgress = {
  alive: boolean;
  bytesRead: number;
  readSeconds: number;
  elapsedSeconds: number;
  sourceState?: string;
  recovering?: boolean;
  hasPlayableSupplier?: boolean;
  sourceRetryAfterSeconds?: number;
};

export async function engineProgress(token: string): Promise<EngineProgress | null> {
  if (!isLocalRemuxAvailable() || typeof LocalRemuxer.engineProgress !== "function") return null;
  try {
    const progress = (await LocalRemuxer.engineProgress(token)) as Partial<EngineProgress> | null;
    if (!progress || typeof progress.bytesRead !== "number" || typeof progress.readSeconds !== "number" || typeof progress.elapsedSeconds !== "number") return null;
    return {
      alive: progress.alive === true,
      bytesRead: progress.bytesRead,
      readSeconds: progress.readSeconds,
      elapsedSeconds: progress.elapsedSeconds,
      ...(typeof progress.sourceState === "string" ? { sourceState: progress.sourceState } : {}),
      ...(typeof progress.recovering === "boolean" ? { recovering: progress.recovering } : {}),
      ...(typeof progress.hasPlayableSupplier === "boolean" ? { hasPlayableSupplier: progress.hasPlayableSupplier } : {}),
      ...(typeof progress.sourceRetryAfterSeconds === "number" && Number.isFinite(progress.sourceRetryAfterSeconds) && progress.sourceRetryAfterSeconds >= 0
        ? { sourceRetryAfterSeconds: progress.sourceRetryAfterSeconds }
        : {}),
    };
  } catch (error) {
    logger.warn("Engine progress read failed", error, { service: "LocalRemux", token });
    return null;
  }
}

/** A live session's subtitle renditions as its master publishes them, once the input resolved; null when unknown. */
export async function liveSubtitleRenditions(token: string | null): Promise<SubtitleRendition[] | null> {
  if (!isLocalRemuxAvailable() || !token || typeof LocalRemuxer.liveSubtitles !== "function") return null;
  try {
    const tracks = (await LocalRemuxer.liveSubtitles(token)) as { index: number; name: string; language: string; isDefault: boolean; isForced: boolean; isImage: boolean }[] | null;
    if (!Array.isArray(tracks)) return null;
    const firstDefault = tracks.findIndex((track) => track.isDefault);
    return tracks.map((track, position) => ({
      index: track.index,
      name: track.name,
      language: track.language || "und",
      vttUrl: "",
      localVtt: "",
      isDefault: position === firstDefault,
      isForced: track.isForced,
      isImage: track.isImage,
      isEngineText: false,
    }));
  } catch (error) {
    logger.warn("Live subtitle read failed", error, { service: "LocalRemux", token });
    return null;
  }
}

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

/** A session's first pipeline failure, as the engine reports it (Remuxer.fail). */
export type EngineFailure = { token: string; message: string };

type FailureListener = (failure: EngineFailure) => void;
const failureListeners = new Map<string, Set<FailureListener>>();
let failureSubscription: { remove: () => void } | null = null;

function watchEngineFailure(): void {
  if (failureSubscription || !isLocalRemuxAvailable()) return;
  if (!nativeEmits("onEngineFailed")) {
    logger.info("Engine build predates the failure report; the pre-flight deadline stands in", { service: "LocalRemux" });
    return;
  }
  const emitter = new NativeEventEmitter(LocalRemuxer);
  failureSubscription = emitter.addListener("onEngineFailed", (failure: EngineFailure) => {
    failureListeners.get(failure.token)?.forEach((listener) => listener(failure));
  });
}

/** One session's failure, until the returned function runs. Never fires on a native build without the event. */
export function subscribeEngineFailure(token: string, listener: FailureListener): () => void {
  watchEngineFailure();
  const listeners = failureListeners.get(token) ?? new Set<FailureListener>();
  listeners.add(listener);
  failureListeners.set(token, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) failureListeners.delete(token);
  };
}

/**
 * A startup step the session finished (Remuxer.mark): open_input, find_stream_info, vt_decode_probe,
 * image_subtitle_decoders, renditions_built; or source_released, when the rungs carry the session alone.
 */
export type EngineStage = { token: string; stage: string; elapsed: number };

type StageListener = (stage: EngineStage) => void;
const stageListeners = new Map<string, Set<StageListener>>();
let stageSubscription: { remove: () => void } | null = null;

function watchEngineStage(): void {
  if (stageSubscription || !isLocalRemuxAvailable() || !nativeEmits("onEngineStage")) return;
  const emitter = new NativeEventEmitter(LocalRemuxer);
  stageSubscription = emitter.addListener("onEngineStage", (stage: EngineStage) => {
    stageListeners.get(stage.token)?.forEach((listener) => listener(stage));
  });
}

/** One session's startup steps, until the returned function runs. Never fires on a native build without the event. */
export function subscribeEngineStage(token: string, listener: StageListener): () => void {
  watchEngineStage();
  const listeners = stageListeners.get(token) ?? new Set<StageListener>();
  listeners.add(listener);
  stageListeners.set(token, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stageListeners.delete(token);
  };
}

/** A live session's subtitle playlist, asked for by AVPlayer: it asks only while that rendition is selected. */
export type SubtitleRequest = { token: string; streamIndex: number; requestedAt: number };

type SubtitleRequestListener = (request: SubtitleRequest) => void;
const subtitleRequestListeners = new Map<string, Set<SubtitleRequestListener>>();
let subtitleRequestSubscription: { remove: () => void } | null = null;

function watchSubtitleRequests(): void {
  if (subtitleRequestSubscription || !isLocalRemuxAvailable() || !nativeEmits("onEngineSubtitleRequest")) return;
  const emitter = new NativeEventEmitter(LocalRemuxer);
  subtitleRequestSubscription = emitter.addListener("onEngineSubtitleRequest", (request: SubtitleRequest) => {
    subtitleRequestListeners.get(request.token)?.forEach((listener) => listener(request));
  });
}

/** One live session's subtitle playlist requests, until the returned function runs. Never fires on a native build without the event. */
export function subscribeSubtitleRequests(token: string, listener: SubtitleRequestListener): () => void {
  watchSubtitleRequests();
  const listeners = subtitleRequestListeners.get(token) ?? new Set<SubtitleRequestListener>();
  listeners.add(listener);
  subtitleRequestListeners.set(token, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) subtitleRequestListeners.delete(token);
  };
}

/** FFmpeg's wording for an HTTP 404 on the input (av_strerror of AVERROR_HTTP_NOT_FOUND). */
export function engineInputMissing(message: string): boolean {
  return /Server returned 404/.test(message);
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
const NO_DECODE_SUPPORT: VideoDecodeSupport = { hevc: false, hevcMain10: false, av1: false, h264MaxHeight: null, hevcMaxHeight: null };

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
      const answer: VideoDecodeSupport = {
        hevc: support?.hevc === true,
        hevcMain10: support?.hevcMain10 === true,
        av1: support?.av1 === true,
        h264MaxHeight: typeof support?.h264MaxHeight === "number" ? support.h264MaxHeight : null,
        hevcMaxHeight: typeof support?.hevcMaxHeight === "number" ? support.hevcMaxHeight : null,
      };
      logger.info("Device video decode support", { service: "LocalRemux", ...answer });
      noteDeviceDecode(answer);
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
  return deviceDecodes(codec, videoStream?.BitDepth, await videoDecodeSupport(), videoStream?.Height);
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
  // A channel read from its origin carries no server probe; the engine's own open decides what it plays.
  if (isLiveSource(videoItem) && videoItem?.liveStreamUrl && !videoItem.LiveStreamId) return true;
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
  if (needsServerAudio && (audioOnly || isLiveSource(videoItem) || playsFromDisk(videoItem.Id))) {
    return declineRemux("audio track requires an unavailable server supplier");
  }

  // A live stream has no runtime; the engine's live mode needs none.
  if (!isLiveSource(videoItem) && (!videoItem.RunTimeTicks || videoItem.RunTimeTicks <= 0)) return declineRemux("no runtime in metadata");

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
  /** Jellyfin's WebVTT, for a sidecar track only: everything in the container is decoded on device. */
  vttUrl: string;
  /** Filesystem path of a track saved with a download; the engine serves those bytes itself. */
  localVtt: string;
  isDefault: boolean;
  isForced: boolean;
  isImage: boolean;
  isExternal?: boolean;
  /** An embedded text track the engine decodes and publishes as WebVTT segments. */
  isEngineText: boolean;
  /** The server's WebVTT of an engine text track, for windows the engine cannot read in time (rung sessions). */
  serverVttUrl?: string;
  /** The server's raw copy of a PGS or DVD track, decoded on device when the source is not being read (rung sessions). */
  serverSupUrl?: string;
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
    return manifestName(stream.DisplayTitle?.trim() || stream.Title?.trim() || language) || `Track ${position + 1}`;
  });

  // Anything still repeated after that — two tracks genuinely both called
  // "English", which real discs do ship — is disambiguated by position.
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
  const shipped = playbackMediaStreams(videoItem)
    .filter((stream) => stream.Type === "Subtitle" && (!imageOnly || isImageBasedSubtitleCodec(stream.Codec)))
    .map((stream) => {
      const index = stream.Index;
      if (index === undefined || !Number.isInteger(index) || index < 0 || index > 2_147_483_647) {
        throw new Error(`Subtitle track is missing a valid Int32 Jellyfin stream index for item ${videoItem.Id}`);
      }
      if (streamIndexes.has(index)) throw new Error(`Duplicate subtitle stream index ${index} for item ${videoItem.Id}`);
      streamIndexes.add(index);
      const isImage = isImageBasedSubtitleCodec(stream.Codec);
      // A track saved with the download is a PATH, not a URL: the engine serves its bytes over
      // the loopback. A file:// URI inside an http playlist is a scheme AVFoundation will not
      // follow, and handing it one loses the whole asset, not just the subtitle.
      const localVtt = isImage ? "" : (localSubtitleUri(videoItem.Id, index) ?? "");
      const isEngineText = !isImage && !localVtt && stream.IsExternal !== true;
      const vttUrl = isImage || isEngineText || localVtt ? "" : getSubtitleUrl(videoItem.Id, index, "vtt");
      const serverSupUrl = isImage && stream.IsExternal === true ? externalImageSubtitleUrl(videoItem, stream) : "";
      if (isImage && stream.IsExternal === true && !serverSupUrl) throw new Error(`No bitmap subtitle supplier for stream ${index} of item ${videoItem.Id}`);
      if (!isImage && !isEngineText && !localVtt && !isRemoteSubtitleUrl(vttUrl)) throw new Error(`No text subtitle supplier for stream ${index} of item ${videoItem.Id}`);
      return {
        stream,
        index,
        isImage,
        isEngineText,
        localVtt,
        vttUrl,
        serverSupUrl,
      };
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

function manifestName(name: string): string {
  return name.replace(/"/g, "'").replace(/\r\n|[\p{Cc}\p{Cf}]/gu, " ").trim();
}

function publishedRenditionNames(tracks: { name: string; index: number }[]): string[] {
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
 * Start a remux session and return the loopback HLS URL for the player.
 * Throws when the native module is unavailable or the session cannot start;
 * callers fall back to the server transcode path.
 */
export async function startLocalRemux(
  videoItem: JellyfinVideoItem,
  preferredAudioStreamIndex?: number,
  startOffsetSeconds?: number,
  // prewarm: a live ring neighbour no player reads yet, kept out of the plan and probe the playing session owns.
  options: { prewarm?: boolean; liveWindowSeconds?: number; serverVideoOnly?: boolean } = {},
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
  const inputUrl = videoItem.liveStreamUrl ?? getVideoStreamUrl(videoItem.Id, videoItem);
  const durationSeconds = live ? 0 : (videoItem.RunTimeTicks ?? 0) / JELLYFIN_TIME.TICKS_PER_SECOND;

  const orderedAudio = audioCatalogue(videoItem, preferredAudioStreamIndex);
  const audioTracks = orderedAudio.map((track) => ({
    index: track.index,
    identity: track.identity,
    name: track.name,
    language: track.stream.Language || "und",
    isDefault: track.stream.IsDefault === true,
    ...(serverVideoOnly ? { usesServerAudio: true, codecs: "mp4a.40.2", bandwidth: RUNG_AUDIO_BANDWIDTH } : audioOutput(track.stream)),
  }));
  if (audioTracks.some((track) => track.usesServerAudio) && (live || playsFromDisk(videoItem.Id) || !mediaStreams.some((stream) => stream.Type === "Video"))) {
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

  // Before the call: the engine reports its plan from the pipeline thread,
  // which can beat this promise's resolution.
  if (!options.prewarm) {
    watchEnginePlan();
    watchEngineTier();
  }

  // Slipstream ladder: always offered for a streamable source with audio. AVPlayer's native ABR
  // opens on the smallest rung and climbs to the engine primary as it measures the segments it
  // downloads, so a slow link plays at once on a small feed and a fast one reaches the copy. A held
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
  if (!options.prewarm) probeEmit("variant", { videoRange: declaredRange, codecs, supplementalCodecs: supplementalCodecs || "(none)", audioTracks: audioTracks.length, tierOffered });

  watchEngineLink();
  const url: string = await LocalRemuxer.startRemux({
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
    // Read straight from its origin, never through a server open: the engine checks it answers.
    ...(live && videoItem.liveStreamUrl && !videoItem.LiveStreamId ? { probeOrigin: true } : {}),
  });

  // The token is the path segment of the master URL (…/<token>/master.m3u8).
  // The CALLER owns it and must hand it back to stopLocalRemux; see
  // localRemuxToken() and the note on stopLocalRemux for why this cannot be
  // module state.

  // Plan attribution: honor this session's plan, and flush it if it arrived
  // before this promise resolved.
  if (!options.prewarm) {
    activePlanToken = localRemuxToken(url);
    activeTierDeclared = tierOffered;
    if (pendingPlan) {
      // A parked plan either belongs to this session or to a superseded one;
      // both ways the slot is done with it.
      if (pendingPlan.token === activePlanToken) reportEnginePlan(pendingPlan);
      pendingPlan = null;
    }
  }

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
  rememberLink(token, null);
  linkListeners.delete(token);
  try {
    await LocalRemuxer.stopRemux(token);
  } catch (error) {
    logger.warn("Failed to stop local remux session", error, { service: "LocalRemux", token });
  }
}

/** Resizes a live session's window from here on: a hot ring neighbour starts short and widens once adopted. */
export async function setLiveWindow(token: string | null, seconds: number): Promise<void> {
  if (!isLocalRemuxAvailable() || !token || typeof LocalRemuxer.setLiveWindow !== "function") return;
  try {
    await LocalRemuxer.setLiveWindow(token, seconds);
  } catch (error) {
    logger.warn("Failed to resize a live window", error, { service: "LocalRemux", token });
  }
}

/**
 * Playlist shim for the server lane: the transcode's playlists re-served through the loopback,
 * with EXT-X-START injected for a resume and, with `sdrInit`, every avc1 init segment retagged
 * BT.709 (PlaylistShim.swift). Null when the module is missing or the shim fails; callers use
 * the raw URL. The token (localRemuxToken on the URL) owns the shim; hand it to stopPlaylistShim.
 */
export async function startPlaylistShim(masterUrl: string, startOffsetSeconds: number, options: { sdrInit?: boolean } = {}): Promise<string | null> {
  const sdrInit = options.sdrInit === true;
  if (!isLocalRemuxAvailable() || (!(startOffsetSeconds > 0) && !sdrInit)) return null;
  try {
    return await LocalRemuxer.startPlaylistShim({ masterUrl, startOffsetSeconds: Math.max(0, startOffsetSeconds), sdrInit });
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

/** A source with no frame in it is retried after the window, three times, and then stands. A
 *  source that would not open, a file still being copied for one, is asked again for as long as
 *  it fails, the wait doubling up to the cap. */
export const POSTER_FRAME_RETRY_MS = 60_000;
export const POSTER_FRAME_ATTEMPTS = 3;
export const POSTER_FRAME_OPEN_RETRY_CAP_MS = 10 * 60_000;
type PosterFrameFailureReason = "open" | "frame";
const posterFrameFailures = new Map<string, { at: number; attempts: number; reason: PosterFrameFailureReason }>();

/** True while a stored failure is one this item has earned another try at. */
function posterFrameRetryable(itemId: string, now = Date.now()): boolean {
  const failure = posterFrameFailures.get(itemId);
  if (!failure) return false;
  if (failure.reason === "open") {
    return now - failure.at >= Math.min(POSTER_FRAME_RETRY_MS * 2 ** (failure.attempts - 1), POSTER_FRAME_OPEN_RETRY_CAP_MS);
  }
  return failure.attempts < POSTER_FRAME_ATTEMPTS && now - failure.at >= POSTER_FRAME_RETRY_MS;
}

function recordPosterFrameFailure(itemId: string, reason: PosterFrameFailureReason): void {
  const failure = posterFrameFailures.get(itemId);
  // Once per item: the retries that follow are the policy, not news.
  if (!failure) logger.debug("Poster frame unavailable", { service: "LocalRemux", itemId, reason: reason === "open" ? "source would not open" : "no frame in the source" });
  posterFrameFailures.set(itemId, { at: Date.now(), attempts: (failure?.attempts ?? 0) + 1, reason });
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
      let result: { uri?: string | null; cancelled?: boolean; fresh?: boolean; reason?: PosterFrameFailureReason } | undefined;
      do {
        result = await LocalRemuxer.posterFrame({ itemId: item.Id, inputUrl, seconds: posterFrameSeconds(item) });
        // A cancel from a card that left lands on the job a card arriving since has joined: ask again for it.
      } while (result?.cancelled && generation === posterFrameGen && (posterFrameWaiters.get(item.Id) ?? 0) > 0);
      if (result?.cancelled) return null;
      const uri = result?.uri ?? null;
      if (generation === posterFrameGen) {
        posterFrames.set(item.Id, uri);
        if (uri === null) recordPosterFrameFailure(item.Id, result?.reason === "open" ? "open" : "frame");
        else posterFrameFailures.delete(item.Id);
        if (settled !== undefined && result?.fresh) posterFrameRevisions.set(item.Id, posterFrameRevision(item.Id) + 1);
      }
      return uri;
    } catch (error) {
      logger.warn("Poster frame failed", error, { service: "LocalRemux", itemId: item.Id });
      if (generation === posterFrameGen) {
        posterFrames.set(item.Id, null);
        recordPosterFrameFailure(item.Id, "frame");
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
