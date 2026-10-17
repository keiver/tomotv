import { engineLog } from "./config";
import { attributeSession, forgetSession, watchEngineLink, watchEnginePlan, watchEngineStage, watchEngineTier } from "./events";
import { engineModule, isLocalRemuxAvailable } from "./native";
import type { SourcePosition, SubtitleRendition } from "./subtitles";

/** One audio track of a session, as the native side reads it (LocalRemuxer.startRemux). */
export interface EngineAudioTrackConfig {
  /** Source stream index; a live channel's tracks may carry -1 and are discovered off the container. */
  index: number;
  identity: string;
  name: string;
  language: string;
  isDefault: boolean;
  source?: SourcePosition;
  /** The track is not carried from the source: a remote AAC rendition supplies it. */
  usesServerAudio: boolean;
  /** RFC 6381 tags of the output, comma separated; "" when the engine discovers the codec itself. */
  codecs: string;
  bandwidth: number;
  serverAudioUrl?: string;
  serverAudioChannels?: number;
}

/** One remote H.264 rung the master lists beside the engine's own variant. */
export interface EngineTierConfig {
  playlistUrl: string;
  bandwidth: number;
  codecs: string;
  width: number;
  height: number;
  /** Ends this rung's own server transcode when the player has left the rung; absent, only the session stop ends it. */
  stopRequest?: EngineStopRequest;
}

/** A request the engine fires once, unawaited, as the session stops: what ends the session's work on a server. */
export interface EngineStopRequest {
  url: string;
  method: string;
}

/** Everything LocalRemuxer.startRemux reads. Keys the native side does not read are ignored there. */
export interface EngineSessionConfig {
  inputUrl: string;
  itemId: string;
  audioTracks: EngineAudioTrackConfig[];
  /** 0 for a live input. */
  durationSeconds: number;
  subtitles: SubtitleRendition[];
  /** HLS VIDEO-RANGE: SDR, PQ, HLG, or "" for an audio-only session. */
  videoRange: string;
  codecs: string;
  primaryVideoCodecs: string;
  primaryVideoBandwidth: number;
  sourceBandwidth: number;
  serverVideoOnly: boolean;
  supplementalCodecs: string;
  width: number;
  height: number;
  frameRate: number;
  bandwidth: number;
  readAheadSegments: number;
  startOffsetSeconds: number;
  tiers: EngineTierConfig[];
  isLive: boolean;
  liveSegmentSeconds: number;
  liveWindowSeconds?: number;
  httpHeaders?: Record<string, string>;
  probeOrigin?: boolean;
  /** The provider whose connection budget the session's reads spend: a live input's host when absent; a file takes leases only when given. */
  liveOriginKey?: string;
  /** Connections a file's input reads over, the engine's default when absent. Under a provider key it opens as many as the budget spares. */
  inputConnections?: number;
  fallbackInputUrl?: string;
  livePriority?: "playback" | "ring" | "preview";
  stopRequests?: EngineStopRequest[];
  /**
   * The open input names its own range, size, rate and bit rate, and whichever of `audioTracks`,
   * `subtitles` and `durationSeconds` are left empty. Takes no `tiers` and no `serverVideoOnly`.
   */
  describesInput?: boolean;
}

/** What a session needs when the input describes itself: where to read, and where to resume. */
export interface DescribedSessionInput {
  inputUrl: string;
  /** Keys the chapter frame pool and the remembered I-frame mean. */
  itemId: string;
  /** Headers the origin requires, sent on every read of the input. */
  httpHeaders?: Record<string, string>;
  startOffsetSeconds?: number;
  readAheadSegments?: number;
  /** The provider whose connection budget the session's reads spend (setOriginConnectionBudget). */
  originKey?: string;
  /** Connections the input reads over, the engine's default when absent. */
  inputConnections?: number;
}

/** The config of a file session the engine describes from the input: nothing here names a stream. */
export function describedSessionConfig(input: DescribedSessionInput): EngineSessionConfig {
  const offset = input.startOffsetSeconds ?? 0;
  return {
    inputUrl: input.inputUrl,
    itemId: input.itemId,
    audioTracks: [],
    durationSeconds: 0,
    subtitles: [],
    videoRange: "",
    codecs: "",
    primaryVideoCodecs: "",
    primaryVideoBandwidth: 0,
    sourceBandwidth: 0,
    serverVideoOnly: false,
    supplementalCodecs: "",
    width: 0,
    height: 0,
    frameRate: 0,
    bandwidth: 0,
    readAheadSegments: input.readAheadSegments ?? 0,
    startOffsetSeconds: Number.isFinite(offset) && offset > 0 ? offset : 0,
    tiers: [],
    isLive: false,
    liveSegmentSeconds: 6,
    ...(input.httpHeaders && Object.keys(input.httpHeaders).length > 0 ? { httpHeaders: input.httpHeaders } : {}),
    ...(input.originKey ? { liveOriginKey: input.originKey } : {}),
    ...(input.inputConnections && Number.isFinite(input.inputConnections) && input.inputConnections >= 1 ? { inputConnections: Math.floor(input.inputConnections) } : {}),
    describesInput: true,
  };
}

/**
 * How many connections a provider allows this device at once, for every read that names `originKey`;
 * 0 forgets the limit and leaves the provider's own refusals to teach it. False when the binary has no such method.
 */
export async function setOriginConnectionBudget(originKey: string, connections: number): Promise<boolean> {
  if (!isLocalRemuxAvailable() || !originKey || typeof engineModule().setOriginBudget !== "function") return false;
  try {
    await engineModule().setOriginBudget(originKey, Number.isFinite(connections) && connections > 0 ? Math.floor(connections) : 0);
    return true;
  } catch (error) {
    engineLog().warn("Failed to set an origin's connection budget", error, { service: "LocalRemux" });
    return false;
  }
}

/** A provider's limit as the engine holds it, and the connections this device has open on it now. */
export interface OriginConnections {
  /** Set by setOriginConnectionBudget or learned from the provider's refusals; null while neither has happened. */
  budget: number | null;
  active: number;
}

/** What the engine knows of a provider's connections, for a screen that shows or edits the limit; null without the method. */
export async function originConnections(originKey: string): Promise<OriginConnections | null> {
  if (!isLocalRemuxAvailable() || !originKey || typeof engineModule().originBudget !== "function") return null;
  try {
    const answer = (await engineModule().originBudget(originKey)) as { budget?: unknown; active?: unknown } | null;
    if (!answer || typeof answer.active !== "number") return null;
    return { budget: typeof answer.budget === "number" && answer.budget > 0 ? answer.budget : null, active: answer.active };
  } catch (error) {
    engineLog().warn("Failed to read an origin's connections", error, { service: "LocalRemux" });
    return null;
  }
}

export interface StartSessionOptions {
  /** False for a session no player reads yet: its plan and tier are not logged or probed. */
  attributePlan?: boolean;
  /** The session opened with a remote tier to fall back on. */
  tierDeclared?: boolean;
}

/**
 * Start a session and return the loopback HLS master URL for the player.
 * Throws when the native module is unavailable or the session cannot start.
 */
export async function startSession(config: EngineSessionConfig, options: StartSessionOptions = {}): Promise<string> {
  if (!isLocalRemuxAvailable()) {
    throw new Error("Local remux native module not available on this platform");
  }
  const attribute = options.attributePlan !== false;
  // Before the call: the engine reports its plan from the pipeline thread,
  // which can beat this promise's resolution.
  if (attribute) {
    watchEnginePlan();
    watchEngineTier();
  }
  watchEngineLink();
  watchEngineStage();
  const url: string = await engineModule().startRemux(config);
  // The token is the path segment of the master URL (.../<token>/master.m3u8).
  // The CALLER owns it and must hand it back to stopLocalRemux.
  if (attribute) attributeSession(localRemuxToken(url), options.tierDeclared === true);
  return url;
}

/** Session token from the master URL startSession resolved, or null. */
export function localRemuxToken(masterUrl: string | null | undefined): string | null {
  return masterUrl?.split("/").at(-2) ?? null;
}

/**
 * Tear down one session, by the token its own start returned. Ownership belongs to the caller,
 * one token per player instance: two player screens overlap during a transition.
 */
export async function stopLocalRemux(token: string | null): Promise<void> {
  if (!isLocalRemuxAvailable() || !token) return;
  forgetSession(token);
  try {
    await engineModule().stopRemux(token);
  } catch (error) {
    engineLog().warn("Failed to stop local remux session", error, { service: "LocalRemux", token });
  }
}

/** Resizes a live session's window from here on: a hot ring neighbour starts short and widens once adopted. */
export async function setLiveWindow(token: string | null, seconds: number): Promise<void> {
  if (!isLocalRemuxAvailable() || !token || typeof engineModule().setLiveWindow !== "function") return;
  try {
    await engineModule().setLiveWindow(token, seconds);
  } catch (error) {
    engineLog().warn("Failed to resize a live window", error, { service: "LocalRemux", token });
  }
}

/** A session changing hands (a ring neighbour or a card preview adopted by the player) takes the player's rank. */
export async function setLiveSessionPriority(token: string | null, priority: "playback" | "ring" | "preview"): Promise<void> {
  if (!isLocalRemuxAvailable() || !token || typeof engineModule().setLivePriority !== "function") return;
  try {
    await engineModule().setLivePriority(token, priority);
  } catch (error) {
    engineLog().warn("Failed to rank a live session", error, { service: "LocalRemux", token });
  }
}

/**
 * AVPlayer's buffer past the playhead, for the engine's copy reservoir. Resolves the floor the
 * variant cap keeps while the engine admits the copy, in bits per second (0 = none).
 */
export async function reportPlayerBuffer(token: string, aheadSeconds: number, sinceSeek: boolean): Promise<number> {
  if (!isLocalRemuxAvailable() || typeof engineModule().setPlayerBuffer !== "function" || !Number.isFinite(aheadSeconds)) return 0;
  try {
    const floor: unknown = await engineModule().setPlayerBuffer(token, aheadSeconds, sinceSeek);
    return typeof floor === "number" && Number.isFinite(floor) && floor > 0 ? floor : 0;
  } catch (error) {
    engineLog().debug("Player buffer report failed", { service: "LocalRemux", token, error: String(error) });
    return 0;
  }
}

/**
 * Playback has settled: the engine brings up the converted audio tracks it left for a pick, one
 * per segment. False when the binary has no such method or the session is gone.
 */
export async function prepareRemainingTracks(token: string): Promise<boolean> {
  if (!isLocalRemuxAvailable() || !token || typeof engineModule().prepareRemainingTracks !== "function") return false;
  try {
    return (await engineModule().prepareRemainingTracks(token)) === true;
  } catch (error) {
    engineLog().debug("Track ramp request failed", { service: "LocalRemux", token, error: String(error) });
    return false;
  }
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
  if (!isLocalRemuxAvailable() || typeof engineModule().engineProgress !== "function") return null;
  try {
    const progress = (await engineModule().engineProgress(token)) as Partial<EngineProgress> | null;
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
    engineLog().warn("Engine progress read failed", error, { service: "LocalRemux", token });
    return null;
  }
}

/**
 * The subtitle renditions a session read off its input (live, `describesInput`) as its master
 * publishes them, once the input resolved; null when unknown.
 */
export async function inputSubtitleRenditions(token: string | null): Promise<SubtitleRendition[] | null> {
  if (!isLocalRemuxAvailable() || !token || typeof engineModule().liveSubtitles !== "function") return null;
  try {
    const tracks = (await engineModule().liveSubtitles(token)) as
      { index: number; name: string; language: string; isDefault: boolean; isForced: boolean; isImage: boolean; isEngineText?: boolean; isHearingImpaired?: boolean }[] | null;
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
      isEngineText: track.isEngineText === true,
      ...(track.isHearingImpaired === true ? { isHearingImpaired: true } : {}),
    }));
  } catch (error) {
    engineLog().warn("Live subtitle read failed", error, { service: "LocalRemux", token });
    return null;
  }
}

export const liveSubtitleRenditions = inputSubtitleRenditions;

/**
 * Playlist shim for a remote HLS lane: its playlists re-served through the loopback, with
 * EXT-X-START injected for a resume, with `sdrInit` every avc1 init segment retagged BT.709,
 * and `iframeStreamInf` appended to the master (PlaylistShim.swift). Null when the module is
 * missing or the shim fails; callers use the raw URL. The token (localRemuxToken on the URL)
 * owns the shim; hand it to stopPlaylistShim.
 */
export async function startPlaylistShim(masterUrl: string, startOffsetSeconds: number, options: { sdrInit?: boolean; iframeStreamInf?: string } = {}): Promise<string | null> {
  const sdrInit = options.sdrInit === true;
  const iframeStreamInf = options.iframeStreamInf ?? "";
  if (!isLocalRemuxAvailable() || (!(startOffsetSeconds > 0) && !sdrInit && !iframeStreamInf)) return null;
  try {
    const config = { masterUrl, startOffsetSeconds: Math.max(0, startOffsetSeconds), sdrInit };
    return await engineModule().startPlaylistShim(iframeStreamInf ? { ...config, iframeStreamInf } : config);
  } catch (error) {
    engineLog().warn("Failed to start playlist shim", error, { service: "LocalRemux" });
    return null;
  }
}

export async function stopPlaylistShim(token: string | null): Promise<void> {
  if (!isLocalRemuxAvailable() || !token) return;
  try {
    await engineModule().stopPlaylistShim(token);
  } catch (error) {
    engineLog().warn("Failed to stop playlist shim", error, { service: "LocalRemux", token });
  }
}

/** The server lanes' I-frame rendition: frames re-encoded or copied, over the item's length. */
export type ProviderIFrames = { transcode: boolean; durationSeconds: number };

/**
 * Chapter keyframes for the lanes that run no session, resolved as the base URL they answer
 * under, or null when the engine cannot start one. With `iframes` the provider also serves an
 * I-frame rendition at `iframes.m3u8` under that base. The caller owns the token on that URL
 * and hands it to stopFrameProvider.
 */
export async function startFrameProvider(inputUrl: string, itemId: string, iframes?: ProviderIFrames): Promise<string | null> {
  if (!isLocalRemuxAvailable() || !inputUrl) return null;
  try {
    return await engineModule().startFrameProvider(iframes ? { inputUrl, itemId, iframes } : { inputUrl, itemId });
  } catch (error) {
    engineLog().warn("Failed to start frame provider", error, { service: "LocalRemux" });
    return null;
  }
}

export async function stopFrameProvider(token: string | null): Promise<void> {
  if (!isLocalRemuxAvailable() || !token) return;
  try {
    await engineModule().stopFrameProvider(token);
  } catch (error) {
    engineLog().warn("Failed to stop frame provider", error, { service: "LocalRemux", token });
  }
}
