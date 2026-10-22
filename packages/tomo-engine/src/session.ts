import { engineLog } from "./config";
import { attributeSession, forgetSession, watchEngineFailure, watchEngineLink, watchEnginePlan, watchEngineStage, watchEngineTier } from "./events";
import { engineModule, isLocalRemuxAvailable } from "./native";
import { LIVE_BUFFER_SECONDS, LIVE_SEGMENT_SECONDS } from "./playbackConstants";
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
  /** Live: the audio track made the default, by language code; the source's default when absent. */
  liveAudioLanguage?: string;
  /** Live: the input is an HLS playlist whatever its URL's extension. */
  livePlaylist?: boolean;
  /** Live: seconds of output the media playlists wait for before answering, the player's start buffer. */
  liveBufferSeconds?: number;
  stopRequests?: EngineStopRequest[];
  /**
   * The open input names its own range, size, rate and bit rate, and whichever of `audioTracks`,
   * `subtitles` and `durationSeconds` are left empty. Takes no `tiers` and no `serverVideoOnly`.
   */
  describesInput?: boolean;
}

/** A live channel the engine reads from its origin, as any app knows it: a URL and how to reach it. */
export interface LiveSessionInput {
  inputUrl: string;
  /** Keys the frame caches; the channel's own id. */
  itemId: string;
  /** Headers the origin requires, sent on every read of the channel. */
  httpHeaders?: Record<string, string>;
  /** The provider whose connection budget the channel spends (setOriginConnectionBudget); its host when absent. */
  originKey?: string;
  /** "playback" for the channel on screen; a neighbour kept warm or a card preview yields to it. */
  priority?: "playback" | "ring" | "preview";
  /** Seconds the player starts behind the newest output; LIVE_BUFFER_SECONDS when absent. */
  bufferSeconds?: number;
  /** The audio language played first on a channel that offers several (ISO 639-1 or -2); every language is carried. */
  audioLanguage?: string;
  /** Seconds of output kept and listed; the player's rewind. */
  windowSeconds?: number;
  /** A second way to the same channel (a relay), opened once when the origin itself will not open. */
  fallbackInputUrl?: string;
  /** An HLS origin read with no server between: its refusal is checked beside the open, so a refused channel fails in seconds. */
  checkOrigin?: boolean;
  /** The input is an HLS playlist whatever its URL's extension, so it is trimmed and checked for DRM. */
  playlist?: boolean;
}

/**
 * The config of a live session from the channel's URL alone: the engine reads the tracks, the
 * picture and the codecs off the input, opens the top variant of an HLS master with every rendition
 * it names, and answers the player once `bufferSeconds` are built.
 */
export function liveSessionConfig(input: LiveSessionInput): EngineSessionConfig {
  const buffer = input.bufferSeconds ?? LIVE_BUFFER_SECONDS;
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
    readAheadSegments: 0,
    startOffsetSeconds: 0,
    tiers: [],
    isLive: true,
    liveSegmentSeconds: LIVE_SEGMENT_SECONDS,
    liveBufferSeconds: Number.isFinite(buffer) && buffer > 0 ? buffer : 0,
    ...(input.windowSeconds && input.windowSeconds > 0 ? { liveWindowSeconds: input.windowSeconds } : {}),
    ...(input.httpHeaders && Object.keys(input.httpHeaders).length > 0 ? { httpHeaders: input.httpHeaders } : {}),
    ...(input.originKey ? { liveOriginKey: input.originKey } : {}),
    ...(input.priority && input.priority !== "playback" ? { livePriority: input.priority } : {}),
    ...(input.audioLanguage ? { liveAudioLanguage: input.audioLanguage } : {}),
    ...(input.playlist ? { livePlaylist: true } : {}),
    ...(input.fallbackInputUrl ? { fallbackInputUrl: input.fallbackInputUrl } : {}),
    ...(input.checkOrigin ? { probeOrigin: true } : {}),
    describesInput: true,
  };
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

const setLimits = new Map<string, number>();

/**
 * How many connections a provider allows this device at once, for every read that names `originKey`;
 * 0 forgets the limit and leaves the provider's own refusals to teach it. False when the binary has no such method.
 */
export async function setOriginConnectionBudget(originKey: string, connections: number): Promise<boolean> {
  if (!isLocalRemuxAvailable() || !originKey || typeof engineModule().setOriginBudget !== "function") return false;
  const limit = Number.isFinite(connections) && connections > 0 ? Math.floor(connections) : 0;
  try {
    await engineModule().setOriginBudget(originKey, limit);
    if (limit > 0) setLimits.set(originKey, limit);
    else setLimits.delete(originKey);
    return true;
  } catch (error) {
    engineLog().warn("Failed to set an origin's connection budget", error, { service: "LocalRemux" });
    return false;
  }
}

/** The limit setOriginConnectionBudget last gave the engine for a provider; null when none is set. */
export function originConnectionLimit(originKey: string | null | undefined): number | null {
  return (originKey && setLimits.get(originKey)) || null;
}

/** A provider's limit as the engine holds it, and the connections this device has open on it now. */
export interface OriginConnections {
  /** Set by setOriginConnectionBudget or learned from the provider's refusals; null while neither has happened. */
  budget: number | null;
  active: number;
  /** A server recording reads the provider and its limit is 1: the engine opens nothing on it. */
  held: boolean;
}

/** What the engine knows of a provider's connections, for a screen that shows or edits the limit; null without the method. */
export async function originConnections(originKey: string): Promise<OriginConnections | null> {
  if (!isLocalRemuxAvailable() || !originKey || typeof engineModule().originBudget !== "function") return null;
  try {
    const answer = (await engineModule().originBudget(originKey)) as { budget?: unknown; active?: unknown; held?: unknown } | null;
    if (!answer || typeof answer.active !== "number") return null;
    const held = answer.held === true;
    noteHeld(originKey, held);
    return { budget: typeof answer.budget === "number" && answer.budget > 0 ? answer.budget : null, active: answer.active, held };
  } catch (error) {
    engineLog().warn("Failed to read an origin's connections", error, { service: "LocalRemux" });
    return null;
  }
}

const heldOrigins = new Set<string>();
const holdListeners = new Set<() => void>();

function noteHeld(originKey: string, held: boolean): void {
  if (heldOrigins.has(originKey) === held) return;
  if (held) heldOrigins.add(originKey);
  else heldOrigins.delete(originKey);
  for (const listener of holdListeners) listener();
}

/** Tells the engine a server recording reads the provider; at a limit of 1 every read on it ends and none opens. Resolves whether it is held. */
export async function setOriginRecording(originKey: string, active: boolean): Promise<boolean> {
  if (!isLocalRemuxAvailable() || !originKey || typeof engineModule().setOriginRecording !== "function") return false;
  try {
    const held = (await engineModule().setOriginRecording(originKey, active)) === true;
    noteHeld(originKey, held);
    return held;
  } catch (error) {
    engineLog().warn("Failed to set an origin's recording", error, { service: "LocalRemux" });
    return false;
  }
}

/** Whether a recording held the provider at the engine's last answer. */
export function originHeld(originKey: string | null | undefined): boolean {
  return !!originKey && heldOrigins.has(originKey);
}

export function subscribeOriginHolds(listener: () => void): () => void {
  holdListeners.add(listener);
  return () => holdListeners.delete(listener);
}

/** A session the broker ended for its provider's budget, not the channel: no slot was left, or a higher read took its connection. */
export function isConnectionBudgetFailure(message: string): boolean {
  return message.startsWith("no connection left on the") || message.endsWith("yielded its connection to a higher-priority read");
}

/** A session ended or refused because a recording holds its provider's only connection. */
export function isRecordingHoldFailure(message: string): boolean {
  return message.includes("live origin is held by a recording");
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
  watchEngineFailure();
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
  /** Live: seconds of output a player bound now would hold ahead of it. */
  bufferedSeconds?: number;
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
      ...(typeof progress.bufferedSeconds === "number" && Number.isFinite(progress.bufferedSeconds) ? { bufferedSeconds: progress.bufferedSeconds } : {}),
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
