/**
 * Pure arithmetic for SyncPlay: server clock offset, command timing and the drift
 * verdict. No timers, no network, no module state, so every branch tests directly.
 */

export const SYNC_PLAY = {
  CLOCK_SAMPLES: 8,
  GREEDY_SAMPLES: 3,
  GREEDY_INTERVAL_MS: 1000,
  POLL_INTERVAL_MS: 60_000,
  /** Buffering edges this soon after our own seek or resume are the seek, not a stall. */
  SEEK_ECHO_WINDOW_MS: 2500,
  /** Apple TV position samples are 250 ms quantised; drift under this is noise. */
  DRIFT_FLOOR_MS: 400,
  DRIFT_EVAL_MS: 2000,
  HOLD_LEAD_MIN_MS: 1000,
  HOLD_LEAD_MAX_MS: 10_000,
  SEEK_TOLERANCE_MS: 250,
  KEEPALIVE_FALLBACK_S: 30,
  RECONNECT_BACKOFF_MS: [1000, 2000, 4000, 8000, 16000, 30000],
} as const;

export interface ServerClockSample {
  /** Server clock minus local clock, in ms. Add to a local time to get server time. */
  offsetMs: number;
  /** One-way trip estimate, in ms. */
  pingMs: number;
}

/**
 * NTP-style sample from one GetUtcTime round trip. t0/t3 are local send and receive
 * times; the ISO strings are the server's reception and transmission stamps.
 */
export function computeClockSample(t0: number, receptionIso: string, transmissionIso: string, t3: number): ServerClockSample | null {
  const t1 = Date.parse(receptionIso);
  const t2 = Date.parse(transmissionIso);
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t3 < t0) return null;
  const offsetMs = (t1 - t0 + (t2 - t3)) / 2;
  const pingMs = Math.max(0, (t3 - t0 - (t2 - t1)) / 2);
  return { offsetMs, pingMs };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median rather than mean: one Wi-Fi spike must not drag the offset. */
export function medianOffset(samples: ServerClockSample[]): number {
  return median(samples.map((sample) => sample.offsetMs));
}

export function medianPing(samples: ServerClockSample[]): number {
  return median(samples.map((sample) => sample.pingMs));
}

/** Local wall-clock ms at which a server `When` stamp falls. */
export function serverToLocalMs(whenIso: string, offsetMs: number): number {
  return Date.parse(whenIso) - offsetMs;
}

export type DriftAction = "none" | "hold" | "resume";

/**
 * Hold-paused is the only correction: a rate change resets the viewer's AVKit audio
 * pick, and a corrective seek costs a buffering edge and a reporter mute.
 */
export function evaluateDrift(input: { playerSeconds: number; groupSeconds: number; holding: boolean }): DriftAction {
  const leadMs = (input.playerSeconds - input.groupSeconds) * 1000;
  if (input.holding) {
    return leadMs < SYNC_PLAY.DRIFT_FLOOR_MS ? "resume" : "none";
  }
  if (leadMs >= SYNC_PLAY.HOLD_LEAD_MIN_MS && leadMs <= SYNC_PLAY.HOLD_LEAD_MAX_MS) return "hold";
  return "none";
}
