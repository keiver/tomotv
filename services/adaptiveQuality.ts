/**
 * adaptiveQuality.ts
 *
 * Client-driven quality adaptation for the SERVER transcode lane. Jellyfin's
 * HLS master is single-variant (verified against the server and its source:
 * DynamicHlsHelper emits one EXT-X-STREAM-INF), so AVPlayer has nothing to
 * adapt between — the client must re-request a different transcode itself,
 * which is how the whole Jellyfin ecosystem does it. This module is the pure
 * controller: the player hook feeds it events and applies its switch verdicts.
 *
 * Signals and thresholds are the surveyed industry ones:
 * - Primary signal is BUFFER OCCUPANCY (Netflix BBA, SIGCOMM'14): playable
 *   duration minus playhead, delivered by react-native-video on every progress
 *   tick. Down-switches trigger on a draining, low buffer or a stall event.
 * - Up-switches trust only 70% of measured bandwidth (hls.js
 *   abrBandWidthUpFactor, ExoPlayer DEFAULT_BANDWIDTH_FRACTION), require a
 *   saturated buffer, and respect a dwell that doubles on every reversal —
 *   asymmetric conservatism, cheap to go down, expensive to go up.
 * - A down-switch jumps straight to the preset the measured link supports at
 *   95% trust (hls.js abrBandWidthFactor); one polite notch against a
 *   collapsed link just stalls again (BBA figure 4).
 *
 * Every switch costs the server a fresh ffmpeg session, so the dwell is the
 * churn bound; MAX_SWITCHES is a runaway backstop, not a policy.
 */

import { QUALITY_PRESETS, QualityMode } from "./jellyfin/constants";

/**
 * Live variant cap for a gateway (Slipstream) session, applied through RNV's
 * `maxBitRate` → AVPlayerItem.preferredPeakBitRate (verified live-applied,
 * RCTVideo.swift:1169). A pinned preset caps which variant AVPlayer may pick —
 * pins become seamless; Auto leaves the ladder free.
 */
export function gatewayMaxBitRate(quality: { mode: QualityMode; bitrate: number }): number | undefined {
  return quality.mode === "fixed" ? quality.bitrate : undefined;
}

export const FLOOR_INDEX = 0; // 480p — "usable beats faithful" on a failing link
export const ORIGINAL_INDEX = QUALITY_PRESETS.length - 1;

/** Buffer below this and draining = the link is losing the race. */
export const OCCUPANCY_FLOOR_SEC = 8;
/** Consecutive draining low-buffer ticks before a down-switch. */
export const DRAIN_TICKS_TO_SWITCH = 3;
/** Buffer at/above this counts as saturated (AVPlayer holding its own target). */
export const OCCUPANCY_SATURATED_SEC = 15;
/** Up-switches trust only this fraction of measured bandwidth. */
export const BW_UP_TRUST = 0.7;
/** Down-switch targets use this fraction of measured bandwidth. */
export const BW_DOWN_SAFETY = 0.95;
/** Base dwell between switches. */
export const BASE_DWELL_MS = 120_000;
/** A down this soon after an up doubles the up-dwell (oscillation damping). */
export const REVERSAL_BACKOFF_WINDOW_MS = 60_000;
/** Two down decisions cannot fire closer than this (a switch takes seconds to apply). */
export const DOWN_REFRACTORY_MS = 15_000;
/** Throughput samples older than this cannot justify an up-switch. */
export const THROUGHPUT_STALE_MS = 120_000;
/** Runaway backstop — a damped controller never gets near it. */
export const MAX_SWITCHES_PER_SESSION = 10;
/** Minimum idle between throughput probes (each downloads real bytes). */
export const PROBE_INTERVAL_MS = 20_000;
/**
 * Down-switch suppression after a seek: a seek fragments AVPlayer's buffered
 * ranges, so occupancy (playableDuration - playhead) collapses and "drains"
 * while the new range refills — a false starvation signal. Measured live
 * 2026-08-18: a healthy LAN session down-switched Original→480p right after
 * a skip. Occupancy readings only count again once the grace expires.
 */
export const SEEK_GRACE_MS = 15_000;

export interface AdaptiveQualityState {
  currentIndex: number;
  /** Highest index this session may reach: the Auto pick's ceiling, or a pinned preset. */
  ceilingIndex: number;
  /** Source stream bitrate; gates entry into Original (its preset bitrate is a sentinel). */
  sourceBitrateBps: number | null;
  lastSwitchAtMs: number;
  lastSwitchDirection: "up" | "down" | null;
  upDwellMs: number;
  switchCount: number;
  drainingTicks: number;
  lastOccupancySec: number | null;
  lastThroughputBps: number | null;
  lastThroughputAtMs: number;
  lastProbeAtMs: number;
  seekGraceUntilMs: number;
}

export type AdaptiveEvent =
  { kind: "tick"; occupancySec: number; nowMs: number } | { kind: "stall"; nowMs: number } | { kind: "throughput"; bps: number; nowMs: number } | { kind: "seeked"; nowMs: number };

export function createAdaptiveState(startIndex: number, ceilingIndex: number, sourceBitrateBps: number | null, nowMs: number): AdaptiveQualityState {
  const ceiling = Math.min(Math.max(ceilingIndex, FLOOR_INDEX), ORIGINAL_INDEX);
  return {
    currentIndex: Math.min(Math.max(startIndex, FLOOR_INDEX), ceiling),
    ceilingIndex: ceiling,
    sourceBitrateBps,
    lastSwitchAtMs: nowMs,
    lastSwitchDirection: null,
    upDwellMs: BASE_DWELL_MS,
    switchCount: 0,
    drainingTicks: 0,
    lastOccupancySec: null,
    lastThroughputBps: null,
    lastThroughputAtMs: 0,
    lastProbeAtMs: nowMs,
    seekGraceUntilMs: 0,
  };
}

/**
 * Entry preset for a session. Original (stream copy, "no server work") is kept
 * whenever the measured link carries the SOURCE bitrate at 70% trust — its
 * preset bitrate is a 120Mbps sentinel no real file reaches, so the source's
 * own rate is the honest requirement. Otherwise the highest capped preset the
 * measurement supports. No measurement = the ceiling, the pre-adaptive behavior.
 */
export function pickStartupIndex(measuredBps: number | null, ceilingIndex: number, sourceBitrateBps: number | null): number {
  const ceiling = Math.min(Math.max(ceilingIndex, FLOOR_INDEX), ORIGINAL_INDEX);
  if (measuredBps == null) return ceiling;
  const usable = measuredBps * BW_UP_TRUST;
  if (ceiling === ORIGINAL_INDEX && sourceBitrateBps != null && usable >= sourceBitrateBps) return ORIGINAL_INDEX;
  let best = FLOOR_INDEX;
  for (let i = Math.min(ceiling, ORIGINAL_INDEX - 1); i >= FLOOR_INDEX; i--) {
    if (QUALITY_PRESETS[i].bitrate <= usable) {
      best = i;
      break;
    }
  }
  return best;
}

/** Whether the hook should fire a throughput probe now: only on a healthy buffer, spaced out. */
export function shouldProbeThroughput(state: AdaptiveQualityState, occupancySec: number, nowMs: number): boolean {
  return state.currentIndex < state.ceilingIndex && occupancySec >= OCCUPANCY_SATURATED_SEC && nowMs - state.lastProbeAtMs >= PROBE_INTERVAL_MS;
}

export function markProbeStarted(state: AdaptiveQualityState, nowMs: number): AdaptiveQualityState {
  return { ...state, lastProbeAtMs: nowMs };
}

function downTarget(state: AdaptiveQualityState): number {
  if (state.lastThroughputBps == null) return FLOOR_INDEX;
  const usable = state.lastThroughputBps * BW_DOWN_SAFETY;
  for (let i = Math.min(state.currentIndex - 1, ORIGINAL_INDEX - 1); i > FLOOR_INDEX; i--) {
    if (QUALITY_PRESETS[i].bitrate <= usable) return i;
  }
  return FLOOR_INDEX;
}

function applyDown(state: AdaptiveQualityState, nowMs: number): { state: AdaptiveQualityState; switchTo: number | null } {
  const reset = { ...state, drainingTicks: 0 };
  if (state.currentIndex <= FLOOR_INDEX || state.switchCount >= MAX_SWITCHES_PER_SESSION) return { state: reset, switchTo: null };
  if (nowMs - state.lastSwitchAtMs < DOWN_REFRACTORY_MS) return { state: reset, switchTo: null };
  const target = downTarget(state);
  // A down soon after an up means the up was premature: damp the next one.
  const reversal = state.lastSwitchDirection === "up" && nowMs - state.lastSwitchAtMs <= REVERSAL_BACKOFF_WINDOW_MS + DOWN_REFRACTORY_MS;
  return {
    state: {
      ...reset,
      currentIndex: target,
      lastSwitchAtMs: nowMs,
      lastSwitchDirection: "down",
      upDwellMs: reversal ? state.upDwellMs * 2 : state.upDwellMs,
      switchCount: state.switchCount + 1,
    },
    switchTo: target,
  };
}

export function advanceAdaptive(state: AdaptiveQualityState, event: AdaptiveEvent): { state: AdaptiveQualityState; switchTo: number | null } {
  switch (event.kind) {
    case "throughput":
      return { state: { ...state, lastThroughputBps: event.bps, lastThroughputAtMs: event.nowMs }, switchTo: null };

    case "seeked":
      return { state: { ...state, drainingTicks: 0, lastOccupancySec: null, seekGraceUntilMs: event.nowMs + SEEK_GRACE_MS }, switchTo: null };

    case "stall":
      // A stall inside the seek grace is the seek buffering, not the link.
      if (event.nowMs < state.seekGraceUntilMs) return { state, switchTo: null };
      return applyDown(state, event.nowMs);

    case "tick": {
      const inGrace = event.nowMs < state.seekGraceUntilMs;
      const prev = state.lastOccupancySec;
      const draining = prev != null && event.occupancySec < prev;
      const low = event.occupancySec < OCCUPANCY_FLOOR_SEC;
      const drainingTicks = !inGrace && low && draining ? state.drainingTicks + 1 : 0;
      const next = { ...state, lastOccupancySec: event.occupancySec, drainingTicks };

      if (drainingTicks >= DRAIN_TICKS_TO_SWITCH) return applyDown(next, event.nowMs);

      // Up: saturated buffer, fresh measurement clearing the next preset at 70%
      // trust, dwell elapsed. Entry into Original is gated on the SOURCE bitrate.
      if (
        next.currentIndex < next.ceilingIndex &&
        event.occupancySec >= OCCUPANCY_SATURATED_SEC &&
        next.lastThroughputBps != null &&
        event.nowMs - next.lastThroughputAtMs <= THROUGHPUT_STALE_MS &&
        event.nowMs - next.lastSwitchAtMs >= next.upDwellMs &&
        next.switchCount < MAX_SWITCHES_PER_SESSION
      ) {
        const target = next.currentIndex + 1;
        const requiredBps = target === ORIGINAL_INDEX && next.sourceBitrateBps != null ? next.sourceBitrateBps : QUALITY_PRESETS[target].bitrate;
        if (next.lastThroughputBps * BW_UP_TRUST >= requiredBps) {
          return {
            state: { ...next, currentIndex: target, lastSwitchAtMs: event.nowMs, lastSwitchDirection: "up", switchCount: next.switchCount + 1, drainingTicks: 0 },
            switchTo: target,
          };
        }
      }
      return { state: next, switchTo: null };
    }
  }
}
