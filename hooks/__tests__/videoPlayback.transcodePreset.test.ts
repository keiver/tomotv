/**
 * Which preset the server lane opens at, and what it may adapt up to. The measurement the plan
 * asks for is the caller's to make, so measurementFor is tested alongside it.
 */
import { measurementFor, planTranscodePreset } from "../videoPlayback/transcodePreset";
import { FLOOR_INDEX, ORIGINAL_INDEX } from "@/services/adaptiveQuality";
import { QUALITY_PRESETS } from "@/services/jellyfin/constants";

const NOW = 1_700_000_000_000;
const base = { overrideIndex: null, mode: "auto" as const, qualityIndex: ORIGINAL_INDEX, stallFallback: false, measuredBps: null, sourceBitrateBps: 8_000_000, nowMs: NOW };

describe("measurementFor", () => {
  it("measures nothing for a mid-session switch: the controller already holds the state", () => {
    expect(measurementFor({ hasOverride: true, stallFallback: false, mode: "auto" })).toBe("none");
  });

  it("measures nothing after a starvation, which enters at the floor regardless", () => {
    expect(measurementFor({ hasOverride: false, stallFallback: true, mode: "auto" })).toBe("none");
  });

  it("may probe once on Auto, remembered per server", () => {
    expect(measurementFor({ hasOverride: false, stallFallback: false, mode: "auto" })).toBe("rememberedOrFresh");
  });

  it("never blocks a pinned session on a fresh probe", () => {
    expect(measurementFor({ hasOverride: false, stallFallback: false, mode: "fixed" })).toBe("remembered");
  });
});

describe("planTranscodePreset", () => {
  it("returns the override and leaves the controller alone", () => {
    const plan = planTranscodePreset({ ...base, overrideIndex: 2 });
    expect(plan).toMatchObject({ reason: "override", preset: QUALITY_PRESETS[2], adaptive: null });
  });

  it("enters at the floor after a starvation and adapts up to Original on Auto", () => {
    const plan = planTranscodePreset({ ...base, stallFallback: true });
    expect(plan).toMatchObject({ reason: "stallFallback", startIndex: FLOOR_INDEX, ceilingIndex: ORIGINAL_INDEX });
    expect(plan.adaptive).not.toBeNull();
  });

  it("adapts up only to the pin when one is set", () => {
    const plan = planTranscodePreset({ ...base, stallFallback: true, mode: "fixed", qualityIndex: 2 });
    expect(plan).toMatchObject({ startIndex: FLOOR_INDEX, ceilingIndex: 2 });
  });

  it("omits the preset when Auto picks Original, leaving the URL byte-for-byte the stored setting", () => {
    const plan = planTranscodePreset({ ...base, measuredBps: 100_000_000 });
    expect(plan).toMatchObject({ reason: "auto", startIndex: ORIGINAL_INDEX, preset: undefined });
  });

  it("opens under the pin when the link measures below it, and still climbs to the pin", () => {
    const plan = planTranscodePreset({ ...base, mode: "fixed", qualityIndex: ORIGINAL_INDEX, measuredBps: 1_000_000 });
    expect(plan.reason).toBe("pinned");
    expect(plan.startIndex).toBeLessThan(ORIGINAL_INDEX);
    expect(plan.ceilingIndex).toBe(ORIGINAL_INDEX);
    expect(plan.preset).toBe(QUALITY_PRESETS[plan.startIndex]);
  });

  it("starts a session with a cold measurement without throwing it to the floor", () => {
    const plan = planTranscodePreset({ ...base, measuredBps: null });
    expect(plan.adaptive).not.toBeNull();
    expect(plan.reason).toBe("auto");
  });
});
