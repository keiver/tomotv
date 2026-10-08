import type { VideoDecodeSupport } from "./codecs";

export type EngineLogContext = Record<string, unknown>;

/** The app's logger, in the three shapes the engine calls. */
export interface EngineLog {
  debug(message: string, context?: EngineLogContext): void;
  info(message: string, context?: EngineLogContext): void;
  warn(message: string, error?: unknown, context?: EngineLogContext): void;
}

export interface EngineHooks {
  log?: EngineLog;
  /** Playback probe events: enginePlan, tier, and whatever the app adds around a session. */
  onProbe?: (event: string, data?: Record<string, unknown>) => void;
  /** The device's decode answer, once per process. */
  onDeviceDecode?: (support: VideoDecodeSupport) => void;
}

const silent: EngineLog = { debug: () => {}, info: () => {}, warn: () => {} };

let hooks: Required<EngineHooks> = { log: silent, onProbe: () => {}, onDeviceDecode: () => {} };

/** Hands the engine the app's logger and probe sinks; unset hooks keep their previous value. */
export function configureEngine(next: EngineHooks): void {
  hooks = {
    log: next.log ?? hooks.log,
    onProbe: next.onProbe ?? hooks.onProbe,
    onDeviceDecode: next.onDeviceDecode ?? hooks.onDeviceDecode,
  };
}

export function engineLog(): EngineLog {
  return hooks.log;
}

export function probeEmit(event: string, data?: Record<string, unknown>): void {
  hooks.onProbe(event, data);
}

export function noteDeviceDecode(support: VideoDecodeSupport): void {
  hooks.onDeviceDecode(support);
}
