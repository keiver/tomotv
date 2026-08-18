/**
 * adaptiveQuality - the pure controller behind client-driven quality adaptation
 * on the server transcode lane. Every rule is asserted: startup picks, the
 * occupancy-driven down path (jump to the supported preset, not one notch),
 * the conservative up path (70% bandwidth trust, saturation, dwell), the
 * reversal damping, refractory, floor/ceiling clamps and the runaway guard.
 */

import {
  advanceAdaptive,
  BASE_DWELL_MS,
  BW_UP_TRUST,
  createAdaptiveState,
  DOWN_REFRACTORY_MS,
  DRAIN_TICKS_TO_SWITCH,
  FLOOR_INDEX,
  markProbeStarted,
  MAX_SWITCHES_PER_SESSION,
  OCCUPANCY_FLOOR_SEC,
  OCCUPANCY_SATURATED_SEC,
  ORIGINAL_INDEX,
  pickStartupIndex,
  PROBE_INTERVAL_MS,
  shouldProbeThroughput,
  THROUGHPUT_STALE_MS,
  type AdaptiveQualityState,
} from "../adaptiveQuality";
import { QUALITY_PRESETS } from "../jellyfin/constants";

const T0 = 1_000_000;

// Drive N draining low-occupancy ticks; returns the last advance result.
function drain(state: AdaptiveQualityState, startAtMs: number, ticks: number = DRAIN_TICKS_TO_SWITCH) {
  let s = state;
  let last: { state: AdaptiveQualityState; switchTo: number | null } = { state: s, switchTo: null };
  // Seed a previous occupancy so the first drain tick sees a decline.
  last = advanceAdaptive(s, { kind: "tick", occupancySec: OCCUPANCY_FLOOR_SEC - 0.5, nowMs: startAtMs });
  s = last.state;
  for (let i = 1; i <= ticks; i++) {
    last = advanceAdaptive(s, { kind: "tick", occupancySec: OCCUPANCY_FLOOR_SEC - 0.5 - i * 0.5, nowMs: startAtMs + i * 1000 });
    s = last.state;
    if (last.switchTo != null) break;
  }
  return last;
}

describe("pickStartupIndex", () => {
  it("opens at the floor when no measurement exists — picture first, climb on real checks", () => {
    expect(pickStartupIndex(null, ORIGINAL_INDEX, 5_000_000)).toBe(FLOOR_INDEX);
    expect(pickStartupIndex(null, 2, null)).toBe(FLOOR_INDEX);
  });

  it("keeps Original when the link carries the SOURCE bitrate at 70% trust", () => {
    // 20 Mbps source over a 30 Mbps link: 0.7*30 = 21 >= 20 → stream copy stays.
    expect(pickStartupIndex(30_000_000, ORIGINAL_INDEX, 20_000_000)).toBe(ORIGINAL_INDEX);
    // Same link, 25 Mbps source: 21 < 25 → capped preset instead.
    expect(pickStartupIndex(30_000_000, ORIGINAL_INDEX, 25_000_000)).not.toBe(ORIGINAL_INDEX);
  });

  it("picks the highest capped preset the measurement clears at 70% trust", () => {
    // 0.7 * 13 Mbps = 9.1 Mbps → 1080p (8 Mbps), not 4K (20 Mbps).
    expect(pickStartupIndex(13_000_000, ORIGINAL_INDEX, 50_000_000)).toBe(3);
    // 0.7 * 3 Mbps = 2.1 Mbps → 480p (1.5 Mbps), not 540p (2.5 Mbps).
    expect(pickStartupIndex(3_000_000, ORIGINAL_INDEX, 50_000_000)).toBe(FLOOR_INDEX);
  });

  it("floors an unusably slow measurement", () => {
    expect(pickStartupIndex(100_000, ORIGINAL_INDEX, 50_000_000)).toBe(FLOOR_INDEX);
  });

  it("respects a pinned ceiling below Original", () => {
    // Fast link, but the session is pinned at 720p (index 2).
    expect(pickStartupIndex(100_000_000, 2, 5_000_000)).toBe(2);
  });
});

describe("createAdaptiveState", () => {
  it("clamps start and ceiling into the preset range", () => {
    const s = createAdaptiveState(99, 99, null, T0);
    expect(s.ceilingIndex).toBe(ORIGINAL_INDEX);
    expect(s.currentIndex).toBe(ORIGINAL_INDEX);
    const f = createAdaptiveState(-3, ORIGINAL_INDEX, null, T0);
    expect(f.currentIndex).toBe(FLOOR_INDEX);
  });
});

describe("down-switching", () => {
  it("switches down after consecutive draining low-occupancy ticks", () => {
    const s = createAdaptiveState(3, ORIGINAL_INDEX, null, T0 - DOWN_REFRACTORY_MS - 1);
    const result = drain(s, T0);
    expect(result.switchTo).toBe(FLOOR_INDEX); // no throughput sample → the floor
  });

  it("jumps straight to the preset the measured link supports, not one notch", () => {
    let s = createAdaptiveState(4, ORIGINAL_INDEX, null, T0 - DOWN_REFRACTORY_MS - 1);
    // Link measured at ~2.8 Mbps: 0.95*2.8 = 2.66 → 540p (2.5 Mbps), skipping 1080p/720p.
    s = advanceAdaptive(s, { kind: "throughput", bps: 2_800_000, nowMs: T0 }).state;
    const result = drain(s, T0 + 1000);
    expect(result.switchTo).toBe(1);
  });

  it("a stall event is an immediate down trigger", () => {
    const s = createAdaptiveState(3, ORIGINAL_INDEX, null, T0 - DOWN_REFRACTORY_MS - 1);
    const result = advanceAdaptive(s, { kind: "stall", nowMs: T0 });
    expect(result.switchTo).toBe(FLOOR_INDEX);
  });

  it("does not fire twice inside the refractory window", () => {
    const s = createAdaptiveState(3, ORIGINAL_INDEX, null, T0 - DOWN_REFRACTORY_MS - 1);
    const first = advanceAdaptive(s, { kind: "stall", nowMs: T0 });
    expect(first.switchTo).not.toBeNull();
    const second = advanceAdaptive(first.state, { kind: "stall", nowMs: T0 + 1000 });
    expect(second.switchTo).toBeNull();
  });

  it("holds the floor instead of switching below it", () => {
    const s = createAdaptiveState(FLOOR_INDEX, ORIGINAL_INDEX, null, T0 - DOWN_REFRACTORY_MS - 1);
    expect(advanceAdaptive(s, { kind: "stall", nowMs: T0 }).switchTo).toBeNull();
  });

  it("recovering occupancy resets the drain counter", () => {
    let s = createAdaptiveState(3, ORIGINAL_INDEX, null, T0 - DOWN_REFRACTORY_MS - 1);
    s = advanceAdaptive(s, { kind: "tick", occupancySec: 6, nowMs: T0 }).state;
    s = advanceAdaptive(s, { kind: "tick", occupancySec: 5, nowMs: T0 + 1000 }).state; // draining 1
    s = advanceAdaptive(s, { kind: "tick", occupancySec: 7, nowMs: T0 + 2000 }).state; // recovers
    expect(s.drainingTicks).toBe(0);
  });
});

describe("up-switching", () => {
  const upReady = (): AdaptiveQualityState => {
    // At 720p (2), ceiling Original, dwell long elapsed, fresh generous sample.
    let s = createAdaptiveState(2, ORIGINAL_INDEX, 5_000_000, T0 - BASE_DWELL_MS - 1000);
    s = advanceAdaptive(s, { kind: "throughput", bps: 100_000_000, nowMs: T0 - 1000 }).state;
    return s;
  };

  it("steps one preset up when saturated, measured, and dwelled", () => {
    const result = advanceAdaptive(upReady(), { kind: "tick", occupancySec: OCCUPANCY_SATURATED_SEC, nowMs: T0 });
    expect(result.switchTo).toBe(3);
  });

  it("refuses without buffer saturation", () => {
    const result = advanceAdaptive(upReady(), { kind: "tick", occupancySec: OCCUPANCY_SATURATED_SEC - 1, nowMs: T0 });
    expect(result.switchTo).toBeNull();
  });

  it("refuses on a stale throughput sample", () => {
    let s = createAdaptiveState(2, ORIGINAL_INDEX, null, T0 - BASE_DWELL_MS - THROUGHPUT_STALE_MS - 5000);
    s = advanceAdaptive(s, { kind: "throughput", bps: 100_000_000, nowMs: T0 - THROUGHPUT_STALE_MS - 1000 }).state;
    expect(advanceAdaptive(s, { kind: "tick", occupancySec: OCCUPANCY_SATURATED_SEC, nowMs: T0 }).switchTo).toBeNull();
  });

  it("refuses before the dwell elapses", () => {
    let s = createAdaptiveState(2, ORIGINAL_INDEX, null, T0 - 1000); // switched 1s ago
    s = advanceAdaptive(s, { kind: "throughput", bps: 100_000_000, nowMs: T0 }).state;
    expect(advanceAdaptive(s, { kind: "tick", occupancySec: OCCUPANCY_SATURATED_SEC, nowMs: T0 + 1000 }).switchTo).toBeNull();
  });

  it("trusts only 70% of the measurement for the next preset", () => {
    let s = createAdaptiveState(2, ORIGINAL_INDEX, null, T0 - BASE_DWELL_MS - 1000);
    // 1080p needs 8 Mbps: a 10 Mbps sample gives 7 usable — refused; 12 Mbps gives 8.4 — allowed.
    s = advanceAdaptive(s, { kind: "throughput", bps: 10_000_000, nowMs: T0 - 500 }).state;
    expect(advanceAdaptive(s, { kind: "tick", occupancySec: OCCUPANCY_SATURATED_SEC, nowMs: T0 }).switchTo).toBeNull();
    s = advanceAdaptive(s, { kind: "throughput", bps: QUALITY_PRESETS[3].bitrate / BW_UP_TRUST, nowMs: T0 + 500 }).state;
    expect(advanceAdaptive(s, { kind: "tick", occupancySec: OCCUPANCY_SATURATED_SEC, nowMs: T0 + 1000 }).switchTo).toBe(3);
  });

  it("gates entry into Original on the SOURCE bitrate, not the 120Mbps sentinel", () => {
    let s = createAdaptiveState(4, ORIGINAL_INDEX, 30_000_000, T0 - BASE_DWELL_MS - 1000);
    // 40 Mbps link: 0.7*40 = 28 < 30 source → refused despite clearing every preset.
    s = advanceAdaptive(s, { kind: "throughput", bps: 40_000_000, nowMs: T0 - 500 }).state;
    expect(advanceAdaptive(s, { kind: "tick", occupancySec: OCCUPANCY_SATURATED_SEC, nowMs: T0 }).switchTo).toBeNull();
    // 50 Mbps: 35 >= 30 → Original.
    s = advanceAdaptive(s, { kind: "throughput", bps: 50_000_000, nowMs: T0 + 500 }).state;
    expect(advanceAdaptive(s, { kind: "tick", occupancySec: OCCUPANCY_SATURATED_SEC, nowMs: T0 + 1000 }).switchTo).toBe(ORIGINAL_INDEX);
  });

  it("never exceeds the ceiling", () => {
    let s = createAdaptiveState(2, 2, null, T0 - BASE_DWELL_MS - 1000);
    s = advanceAdaptive(s, { kind: "throughput", bps: 100_000_000, nowMs: T0 - 500 }).state;
    expect(advanceAdaptive(s, { kind: "tick", occupancySec: OCCUPANCY_SATURATED_SEC, nowMs: T0 }).switchTo).toBeNull();
  });
});

describe("oscillation damping and runaway guard", () => {
  it("doubles the up-dwell when a down follows an up closely", () => {
    let s = createAdaptiveState(2, ORIGINAL_INDEX, null, T0 - BASE_DWELL_MS - 1000);
    s = advanceAdaptive(s, { kind: "throughput", bps: 100_000_000, nowMs: T0 - 500 }).state;
    const up = advanceAdaptive(s, { kind: "tick", occupancySec: OCCUPANCY_SATURATED_SEC, nowMs: T0 });
    expect(up.switchTo).toBe(3);
    // Stall 20s later (past the refractory, inside the reversal window).
    const down = advanceAdaptive(up.state, { kind: "stall", nowMs: T0 + DOWN_REFRACTORY_MS + 1000 });
    expect(down.switchTo).not.toBeNull();
    expect(down.state.upDwellMs).toBe(BASE_DWELL_MS * 2);
  });

  it("stops switching at the runaway cap", () => {
    let s = createAdaptiveState(3, ORIGINAL_INDEX, null, T0 - DOWN_REFRACTORY_MS - 1);
    s = { ...s, switchCount: MAX_SWITCHES_PER_SESSION };
    expect(advanceAdaptive(s, { kind: "stall", nowMs: T0 }).switchTo).toBeNull();
  });
});

describe("shouldProbeThroughput", () => {
  it("probes only below the ceiling, on a healthy buffer, spaced out", () => {
    const s = createAdaptiveState(2, ORIGINAL_INDEX, null, T0);
    expect(shouldProbeThroughput(s, OCCUPANCY_SATURATED_SEC, T0 + PROBE_INTERVAL_MS)).toBe(true);
    expect(shouldProbeThroughput(s, OCCUPANCY_SATURATED_SEC - 1, T0 + PROBE_INTERVAL_MS)).toBe(false);
    expect(shouldProbeThroughput(s, OCCUPANCY_SATURATED_SEC, T0 + PROBE_INTERVAL_MS - 1000)).toBe(false);
    const atCeiling = createAdaptiveState(ORIGINAL_INDEX, ORIGINAL_INDEX, null, T0);
    expect(shouldProbeThroughput(atCeiling, OCCUPANCY_SATURATED_SEC, T0 + PROBE_INTERVAL_MS)).toBe(false);
    const marked = markProbeStarted(s, T0 + PROBE_INTERVAL_MS);
    expect(shouldProbeThroughput(marked, OCCUPANCY_SATURATED_SEC, T0 + PROBE_INTERVAL_MS + 1000)).toBe(false);
  });
});

describe("gatewayMaxBitRate", () => {
  const { gatewayMaxBitRate } = jest.requireActual<typeof import("../adaptiveQuality")>("../adaptiveQuality");

  it("caps a pinned preset at its bitrate (pins become seamless)", () => {
    expect(gatewayMaxBitRate({ mode: "fixed", bitrate: 8_000_000 })).toBe(8_000_000);
  });

  it("leaves Auto uncapped", () => {
    expect(gatewayMaxBitRate({ mode: "auto", bitrate: 120_000_000 })).toBeUndefined();
  });
});

describe("post-seek grace", () => {
  const { SEEK_GRACE_MS } = jest.requireActual<typeof import("../adaptiveQuality")>("../adaptiveQuality");

  it("suppresses drain-driven down-switches during the grace (the live false positive)", () => {
    let s = createAdaptiveState(3, ORIGINAL_INDEX, null, T0 - DOWN_REFRACTORY_MS - 1);
    s = advanceAdaptive(s, { kind: "seeked", nowMs: T0 }).state;
    // Collapsed occupancy right after the seek must not switch.
    const inGrace = drain(s, T0 + 1000);
    expect(inGrace.switchTo).toBeNull();
    expect(inGrace.state.drainingTicks).toBe(0);
  });

  it("suppresses stall events during the grace", () => {
    let s = createAdaptiveState(3, ORIGINAL_INDEX, null, T0 - DOWN_REFRACTORY_MS - 1);
    s = advanceAdaptive(s, { kind: "seeked", nowMs: T0 }).state;
    expect(advanceAdaptive(s, { kind: "stall", nowMs: T0 + 1000 }).switchTo).toBeNull();
  });

  it("resumes normal down-switching after the grace expires", () => {
    let s = createAdaptiveState(3, ORIGINAL_INDEX, null, T0 - DOWN_REFRACTORY_MS - 1);
    s = advanceAdaptive(s, { kind: "seeked", nowMs: T0 }).state;
    const after = drain(s, T0 + SEEK_GRACE_MS + 1000);
    expect(after.switchTo).not.toBeNull();
  });

  it("a seek resets the drain counter and last occupancy", () => {
    let s = createAdaptiveState(3, ORIGINAL_INDEX, null, T0);
    s = advanceAdaptive(s, { kind: "tick", occupancySec: 6, nowMs: T0 }).state;
    s = advanceAdaptive(s, { kind: "tick", occupancySec: 5, nowMs: T0 + 1000 }).state;
    s = advanceAdaptive(s, { kind: "seeked", nowMs: T0 + 2000 }).state;
    expect(s.drainingTicks).toBe(0);
    expect(s.lastOccupancySec).toBeNull();
  });
});
