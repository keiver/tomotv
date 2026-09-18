/**
 * Which preset the server lane opens at, and the adaptive controller that starts with it.
 * Pure: the caller does the measuring the plan asks for.
 */
import { createAdaptiveState, FLOOR_INDEX, ORIGINAL_INDEX, pickStartupIndex, type AdaptiveQualityState } from "@/services/adaptiveQuality";
import { QUALITY_PRESETS, type QualityPreset } from "@/services/jellyfin/constants";

export type QualityMode = "auto" | "fixed";

/** What the plan needs measured before it can be made. */
export type MeasurementNeed = "none" | "remembered" | "rememberedOrFresh";

export function measurementFor(input: { hasOverride: boolean; stallFallback: boolean; mode: QualityMode }): MeasurementNeed {
  if (input.hasOverride || input.stallFallback) return "none";
  // jellyfin-web's startup pattern: measure once, remembered per server.
  return input.mode === "auto" ? "rememberedOrFresh" : "remembered";
}

export interface PresetPlanInput {
  /** A mid-session switch the controller already holds the state for. */
  overrideIndex: number | null;
  mode: QualityMode;
  /** The viewer's pin, or the default index while Auto. */
  qualityIndex: number;
  /** A starvation pushed this session to the server. */
  stallFallback: boolean;
  measuredBps: number | null;
  sourceBitrateBps: number | null;
  nowMs: number;
}

export interface PresetPlan {
  /** undefined = the stored setting, which is byte-for-byte the pre-adaptive URL. */
  preset: QualityPreset | undefined;
  /** null leaves the controller where it is (a mid-session switch). */
  adaptive: AdaptiveQualityState | null;
  /** How the start was picked, for the log. */
  reason: "override" | "stallFallback" | "auto" | "pinned";
  /** Ceiling the session may adapt up to. */
  ceilingIndex: number;
  startIndex: number;
}

export function planTranscodePreset(input: PresetPlanInput): PresetPlan {
  if (input.overrideIndex != null) {
    return { preset: QUALITY_PRESETS[input.overrideIndex], adaptive: null, reason: "override", ceilingIndex: input.overrideIndex, startIndex: input.overrideIndex };
  }

  if (input.stallFallback) {
    // The session owes the viewer playback, not fidelity: enter at the floor and adapt up.
    const ceiling = input.mode === "auto" ? ORIGINAL_INDEX : input.qualityIndex;
    return {
      preset: QUALITY_PRESETS[FLOOR_INDEX],
      adaptive: createAdaptiveState(FLOOR_INDEX, ceiling, input.sourceBitrateBps, input.nowMs),
      reason: "stallFallback",
      ceilingIndex: ceiling,
      startIndex: FLOOR_INDEX,
    };
  }

  if (input.mode === "auto") {
    const startIndex = pickStartupIndex(input.measuredBps, ORIGINAL_INDEX, input.sourceBitrateBps);
    return {
      preset: startIndex === ORIGINAL_INDEX ? undefined : QUALITY_PRESETS[startIndex],
      adaptive: createAdaptiveState(startIndex, ORIGINAL_INDEX, input.sourceBitrateBps, input.nowMs),
      reason: "auto",
      ceilingIndex: ORIGINAL_INDEX,
      startIndex,
    };
  }

  // A pin is a CEILING, not a guarantee: a link measured below it opens at the measured pick
  // and climbs, and stalls can drop below it.
  const startIndex = pickStartupIndex(input.measuredBps, input.qualityIndex, input.sourceBitrateBps);
  return {
    preset: QUALITY_PRESETS[startIndex],
    adaptive: createAdaptiveState(startIndex, input.qualityIndex, input.sourceBitrateBps, input.nowMs),
    reason: "pinned",
    ceilingIndex: input.qualityIndex,
    startIndex,
  };
}
