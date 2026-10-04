import { engineLog, probeEmit } from "./config";
import { engineEmitter, isLocalRemuxAvailable, nativeEmits } from "./native";
import type { ThroughputSample } from "./throughput";

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
  /** "primary" or the alternate rendition prefix ("a0", "a1", ...). Audio only. */
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
  engineLog().info("Local remux engine plan", {
    service: "LocalRemux",
    video: plan.video ? describeTrack(plan.video) : "none (audio-only)",
    audio: plan.audio.map(describeTrack),
  });
  probeEmit("enginePlan", { video: plan.video, audio: plan.audio });
}

export function watchEnginePlan(): void {
  if (planSubscription || !isLocalRemuxAvailable()) return;
  planSubscription = engineEmitter().addListener("onEnginePlan", (plan: EnginePlan) => {
    // Match by token, not arrival order: the native side replays its cached
    // plan to a fresh listener, so the first event after a JS reload can be a
    // PREVIOUS session's plan and must not be logged against this item. A plan
    // that beats its own start promise parks here until the token is known.
    if (plan.token === activePlanToken) reportEnginePlan(plan);
    else pendingPlan = plan;
  });
}

/** Plan attribution for a just-started session, and the flush of a plan that beat its start promise. */
export function attributeSession(token: string | null, tierDeclared: boolean): void {
  activePlanToken = token;
  activeTierDeclared = tierDeclared;
  if (pendingPlan) {
    // A parked plan either belongs to this session or to a superseded one;
    // both ways the slot is done with it.
    if (pendingPlan.token === activePlanToken) reportEnginePlan(pendingPlan);
    pendingPlan = null;
  }
}

/** What the session did with its server tier: the master's verdict once, then a drop if the server stops delivering.
 *  "copy" is a ladder left out because the link carries the copy alone. */
export interface EngineTierReport {
  token: string;
  state: "listed" | "declined" | "dropped" | "copy";
  reason?: string;
  /** How long the opening segment took to fetch and rewrap. */
  probeSeconds?: number;
}

let tierSubscription: { remove: () => void } | null = null;

type TierListener = (report: EngineTierReport) => void;
const tierListeners = new Map<string, Set<TierListener>>();

export function watchEngineTier(): void {
  if (tierSubscription || !isLocalRemuxAvailable()) return;
  if (!nativeEmits("onEngineTier")) {
    engineLog().info("Engine build predates the tier report; playback is unaffected", { service: "LocalRemux" });
    return;
  }
  tierSubscription = engineEmitter().addListener("onEngineTier", (report: EngineTierReport) => {
    tierListeners.get(report.token)?.forEach((listener) => listener(report));
    // Every report follows the master, which follows this session's start, so a foreign token
    // is a superseded session still winding down.
    if (report.token !== activePlanToken) return;
    engineLog().info("Slipstream tier", { service: "LocalRemux", state: report.state, reason: report.reason, probeSeconds: report.probeSeconds });
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

/** The link rate the engine measured behind the loopback, in bits per second, and what read it. */
export type EngineLinkReport = { token: string; bps: number; copyListed?: boolean; source?: "probe" | "reads" | "rungs" | "playlist" };

type LinkListener = (report: EngineLinkReport) => void;
const linkListeners = new Map<string, Set<LinkListener>>();
const linkReports = new Map<string, EngineLinkReport | null>();
let linkSubscription: { remove: () => void } | null = null;

function rememberLink(token: string, report: EngineLinkReport | null): void {
  linkReports.delete(token);
  linkReports.set(token, report);
  if (linkReports.size > 32) linkReports.delete(linkReports.keys().next().value!);
}

export function watchEngineLink(): void {
  if (linkSubscription || !isLocalRemuxAvailable()) return;
  if (!nativeEmits("onEngineLink")) {
    engineLog().info("Engine build predates the link report; the session plays uncapped", { service: "LocalRemux" });
    return;
  }
  linkSubscription = engineEmitter().addListener("onEngineLink", (report: EngineLinkReport) => {
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

type ThroughputListener = (sample: ThroughputSample) => void;
const throughputListeners = new Map<string, Set<ThroughputListener>>();
let throughputSubscription: { remove: () => void } | null = null;

function watchEngineThroughput(): void {
  if (throughputSubscription || !isLocalRemuxAvailable()) return;
  throughputSubscription = engineEmitter().addListener("onEngineThroughput", (sample: ThroughputSample) => {
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
    engineLog().info("Engine build predates the failure report; the pre-flight deadline stands in", { service: "LocalRemux" });
    return;
  }
  failureSubscription = engineEmitter().addListener("onEngineFailed", (failure: EngineFailure) => {
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
/** Every step a session has reported, so a subscriber arriving after startRemux resolves misses none. */
const stageReports = new Map<string, EngineStage[]>();
let stageSubscription: { remove: () => void } | null = null;

export function watchEngineStage(): void {
  if (stageSubscription || !isLocalRemuxAvailable() || !nativeEmits("onEngineStage")) return;
  stageSubscription = engineEmitter().addListener("onEngineStage", (stage: EngineStage) => {
    const seen = stageReports.get(stage.token) ?? [];
    stageReports.delete(stage.token);
    stageReports.set(stage.token, [...seen, stage]);
    if (stageReports.size > 32) stageReports.delete(stageReports.keys().next().value!);
    stageListeners.get(stage.token)?.forEach((listener) => listener(stage));
  });
}

/** One session's startup steps, the ones already reported first, until the returned function runs. Never fires on a native build without the event. */
export function subscribeEngineStage(token: string, listener: StageListener): () => void {
  watchEngineStage();
  const listeners = stageListeners.get(token) ?? new Set<StageListener>();
  listeners.add(listener);
  stageListeners.set(token, listeners);
  stageReports.get(token)?.forEach(listener);
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
  subtitleRequestSubscription = engineEmitter().addListener("onEngineSubtitleRequest", (request: SubtitleRequest) => {
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

/** Drops what a stopped session left behind: its link reading and listeners, and its stage history. */
export function forgetSession(token: string): void {
  rememberLink(token, null);
  linkListeners.delete(token);
  stageReports.delete(token);
}
