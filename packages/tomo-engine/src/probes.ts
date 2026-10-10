import type { VideoDecodeSupport } from "./codecs";
import { engineLog, noteDeviceDecode } from "./config";
import { engineEmitter, engineModule, isLocalRemuxAvailable, nativeEmits } from "./native";

/** Asked of the device once per process; its decode silicon does not change. */
let decodeSupport: Promise<VideoDecodeSupport> | null = null;
const NO_DECODE_SUPPORT: VideoDecodeSupport = { hevc: false, hevcMain10: false, av1: false, h264MaxHeight: null, hevcMaxHeight: null };

/**
 * What this device's VideoToolbox opens (DeviceDecode.swift). Warm it at app start so a lane
 * pick reads a settled answer. Without the engine nothing is assumed decodable.
 */
export function videoDecodeSupport(): Promise<VideoDecodeSupport> {
  if (decodeSupport) return decodeSupport;
  if (!isLocalRemuxAvailable()) return Promise.resolve(NO_DECODE_SUPPORT);
  decodeSupport = (async () => {
    try {
      const support = (await engineModule().videoDecodeSupport()) as Partial<VideoDecodeSupport> | null;
      const answer: VideoDecodeSupport = {
        hevc: support?.hevc === true,
        hevcMain10: support?.hevcMain10 === true,
        av1: support?.av1 === true,
        h264MaxHeight: typeof support?.h264MaxHeight === "number" ? support.h264MaxHeight : null,
        hevcMaxHeight: typeof support?.hevcMaxHeight === "number" ? support.hevcMaxHeight : null,
      };
      engineLog().info("Device video decode support", { service: "LocalRemux", ...answer });
      noteDeviceDecode(answer);
      return answer;
    } catch (error) {
      engineLog().warn("Device decode probe failed", error, { service: "LocalRemux" });
      return NO_DECODE_SUPPORT;
    }
  })();
  return decodeSupport;
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

/** Runs the software-decode lane on `inputUrl` for `wallSeconds`; dev tooling. */
export function benchmarkTranscode(inputUrl: string, { wallSeconds, encode }: { wallSeconds: number; encode: boolean }): Promise<TranscodeBenchmark> {
  if (!isLocalRemuxAvailable()) throw new Error("Local remux native module not available on this platform");
  return engineModule().benchmarkTranscode({ inputUrl, wallSeconds, encode }) as Promise<TranscodeBenchmark>;
}

/** One stream as the demuxer reports it (InputProbe.swift). Fields the codec parameters do not carry are absent. */
export interface ProbedStream {
  index: number;
  type: "video" | "audio" | "subtitle" | "data" | "attachment" | "unknown";
  /** FFmpeg's codec name: h264, hevc, aac, subrip, hdmv_pgs_subtitle. */
  codec: string;
  profile?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  bitDepth?: number;
  /** FFmpeg's transfer name: bt709, smpte2084 (PQ), arib-std-b67 (HLG). */
  colorTransfer?: string;
  channels?: number;
  sampleRate?: number;
  bitRate?: number;
  language?: string;
  title?: string;
  isDefault: boolean;
  isForced: boolean;
}

export interface InputProbe {
  /** The demuxer's name: matroska,webm; mov,mp4,m4a,3gp,3g2,mj2; mpegts. */
  formatName: string;
  /** 0 when the container declares none (a live stream). */
  durationSeconds: number;
  streams: ProbedStream[];
}

/** Opens `url` the way a session would and reports what the demuxer finds, for sources with no metadata of their own. */
export function probeInput(input: { url: string; headers?: Record<string, string> }): Promise<InputProbe> {
  if (!isLocalRemuxAvailable()) return Promise.reject(new Error("Local remux native module not available on this platform"));
  return engineModule().probeInput({ url: input.url, headers: input.headers ?? {} }) as Promise<InputProbe>;
}

/** What the native link probe read: the rate, whether it filled a window, and over how long. */
export interface LinkReading {
  bps: number;
  kind: "full" | "short";
  seconds: number;
}

/** Whether this build's engine measures a link. */
export function canMeasureLink(): boolean {
  return typeof engineModule()?.measureLink === "function";
}

/** Reads `url` for up to `budgetMs` and reports the rate seen; null without the probe or a reading. */
export function measureLink(url: string, headers: Record<string, string>, budgetMs: number): Promise<LinkReading | null> {
  const measure = engineModule()?.measureLink;
  if (typeof measure !== "function") return Promise.resolve(null);
  return measure(url, headers, budgetMs) as Promise<LinkReading | null>;
}

export async function cancelMeasureLink(): Promise<void> {
  const cancel = engineModule()?.cancelMeasureLink;
  if (typeof cancel === "function") await cancel();
}

/** How a live origin answered a short TCP open: reachable, refused, or nothing within the timeout. */
export type OriginReach = "reachable" | "refused" | "silent";

/** Whether this build's engine probes a live origin and ranks live sessions. */
export function canProbeOrigin(): boolean {
  return typeof engineModule()?.probeOriginReach === "function" && typeof engineModule()?.setLivePriority === "function";
}

export function probeOriginReach(url: string, timeoutMs: number): Promise<OriginReach> {
  return engineModule().probeOriginReach(url, timeoutMs) as Promise<OriginReach>;
}

/** One live frame grab request, as LocalRemuxer.liveFrame reads it. */
export interface LiveFrameRequest {
  channelId: string;
  inputUrl: string;
  httpHeaders: Record<string, string>;
  originKey?: string;
  fallbackUrl?: string;
  priority?: "playback" | "ring" | "preview";
  deadline: number;
  span: number;
  interval: number;
  count: number;
  clipSpan: number;
  shownPts?: number | null;
  shownUri?: string;
}

export interface LiveFrameResult {
  uris?: string[] | null;
  clip?: string | null;
  pts?: number | null;
  unchanged?: boolean;
  missing?: boolean;
  cancelled?: boolean;
  reason?: string;
  failure?: string | null;
}

export function canGrabLiveFrames(): boolean {
  return typeof engineModule()?.liveFrame === "function";
}

export function liveFrame(request: LiveFrameRequest): Promise<LiveFrameResult> {
  return engineModule().liveFrame(request) as Promise<LiveFrameResult>;
}

export function canReadLiveFramesOnDisk(): boolean {
  return typeof engineModule()?.liveFramesOnDisk === "function";
}

/** The newest burst on disk for each channel id asked, keyed by channel id. */
export function liveFramesOnDisk(channelIds: string[]): Promise<Record<string, { uris: string[]; clip?: string | null; at: number }>> {
  if (!canReadLiveFramesOnDisk()) return Promise.resolve({});
  return (engineModule().liveFramesOnDisk(channelIds) as Promise<Record<string, { uris: string[]; clip?: string | null; at: number }> | null>).then((found) => found ?? {});
}

export function cancelLiveFrame(channelId: string): void {
  const cancel = engineModule()?.cancelLiveFrame;
  if (typeof cancel !== "function") return;
  void cancel(channelId)?.catch?.(() => {});
}

/** The engine's `onLiveFrame` events, when the running build emits them; otherwise nothing is subscribed. */
export function subscribeLiveFrames(listener: (event: unknown) => void): (() => void) | null {
  if (!nativeEmits("onLiveFrame")) return null;
  const subscription = engineEmitter().addListener("onLiveFrame", listener);
  return () => subscription.remove();
}

/** Drops the engine's pooled frames: ids collide across sources, so none may outlive a switch. */
export async function clearFramePool(): Promise<void> {
  if (!isLocalRemuxAvailable()) return;
  try {
    await engineModule().clearFramePool();
  } catch (error) {
    engineLog().warn("Failed to clear the frame pool", error, { service: "LocalRemux" });
  }
}

/** What LocalRemuxer.repackageDownload answers. */
export interface RepackageResult {
  repackaged?: boolean;
  reason?: string;
  failed?: boolean;
  /** This source will never rewrap. */
  permanent?: boolean;
  subtitleStreamIndices?: number[];
  imageSubtitleIndices?: number[];
  droppedAudioIndices?: number[];
  elapsedSeconds?: number;
}

export function canRepackage(): boolean {
  return typeof engineModule()?.repackageDownload === "function";
}

/** Rewraps a held file into the container the native player opens, in place of a transcode. */
export function repackageDownload(request: { itemId: string; inputPath: string; outputPath: string }): Promise<RepackageResult> {
  return engineModule().repackageDownload(request) as Promise<RepackageResult>;
}

export function canMergeParts(): boolean {
  return typeof engineModule()?.mergeDownloadParts === "function";
}

/** Joins a parallel download's ranged part files into one, in order; parts are removed as consumed. */
export function mergeDownloadParts(request: { parts: string[]; outputPath: string }): Promise<void> {
  return engineModule().mergeDownloadParts(request) as Promise<void>;
}

export function cancelRepackage(itemId: string): void {
  if (typeof engineModule()?.cancelRepackage !== "function") return;
  void engineModule().cancelRepackage(itemId);
}
