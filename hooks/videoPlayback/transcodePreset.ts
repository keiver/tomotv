import { FLOOR_INDEX, ORIGINAL_INDEX, pickStartupIndex } from "@/services/adaptiveQuality";
import { QUALITY_PRESETS, type QualityPreset } from "@/services/jellyfin/constants";

export type QualityMode = "auto" | "fixed";

/** What the plan needs measured before it can be made. */
export type MeasurementNeed = "none" | "remembered";

/** Never a fresh probe: a read short enough to wait on reads a burst, so a cold start takes the floor like every player's. */
export function measurementFor(input: { stallFallback: boolean }): MeasurementNeed {
  return input.stallFallback ? "none" : "remembered";
}

export interface PresetPlanInput {
  mode: QualityMode;
  /** The viewer's pin, or the default index while Auto. */
  qualityIndex: number;
  /** A starvation pushed this session to the server. */
  stallFallback: boolean;
  measuredBps: number | null;
  sourceBitrateBps: number | null;
}

export interface PresetPlan {
  /** undefined = the stored setting, which is byte-for-byte the pre-adaptive URL. */
  preset: QualityPreset | undefined;
  /** How the start was picked, for the log. */
  reason: "stallFallback" | "auto" | "pinned";
  ceilingIndex: number;
  startIndex: number;
}

export function planTranscodePreset(input: PresetPlanInput): PresetPlan {
  if (input.stallFallback) {
    const ceiling = input.mode === "auto" ? ORIGINAL_INDEX : input.qualityIndex;
    return {
      preset: QUALITY_PRESETS[FLOOR_INDEX],
      reason: "stallFallback",
      ceilingIndex: ceiling,
      startIndex: FLOOR_INDEX,
    };
  }

  if (input.mode === "auto") {
    const startIndex = pickStartupIndex(input.measuredBps, ORIGINAL_INDEX, input.sourceBitrateBps);
    return {
      preset: startIndex === ORIGINAL_INDEX ? undefined : QUALITY_PRESETS[startIndex],
      reason: "auto",
      ceilingIndex: ORIGINAL_INDEX,
      startIndex,
    };
  }

  const startIndex = pickStartupIndex(input.measuredBps, input.qualityIndex, input.sourceBitrateBps);
  return {
    preset: QUALITY_PRESETS[startIndex],
    reason: "pinned",
    ceilingIndex: input.qualityIndex,
    startIndex,
  };
}
