import { measurementFor, planTranscodePreset } from "../videoPlayback/transcodePreset";
import { FLOOR_INDEX, ORIGINAL_INDEX } from "@/services/adaptiveQuality";
import { QUALITY_PRESETS } from "@/services/jellyfin/constants";

const base = { mode: "auto" as const, qualityIndex: ORIGINAL_INDEX, stallFallback: false, measuredBps: null, sourceBitrateBps: 8_000_000 };

describe("measurementFor", () => {
  it("measures nothing after a starvation, which enters at the floor regardless", () => {
    expect(measurementFor({ stallFallback: true, mode: "auto" })).toBe("none");
  });

  it("may probe once on Auto, remembered per server", () => {
    expect(measurementFor({ stallFallback: false, mode: "auto" })).toBe("rememberedOrFresh");
  });

  it("never blocks a pinned session on a fresh probe", () => {
    expect(measurementFor({ stallFallback: false, mode: "fixed" })).toBe("remembered");
  });
});

describe("planTranscodePreset", () => {
  it("enters at the floor after a starvation on Auto", () => {
    const plan = planTranscodePreset({ ...base, stallFallback: true });
    expect(plan).toMatchObject({ reason: "stallFallback", startIndex: FLOOR_INDEX, ceilingIndex: ORIGINAL_INDEX });
  });

  it("retains the viewer's ceiling when one is set", () => {
    const plan = planTranscodePreset({ ...base, stallFallback: true, mode: "fixed", qualityIndex: 2 });
    expect(plan).toMatchObject({ startIndex: FLOOR_INDEX, ceilingIndex: 2 });
  });

  it("omits the preset when Auto picks Original, leaving the URL byte-for-byte the stored setting", () => {
    const plan = planTranscodePreset({ ...base, measuredBps: 100_000_000 });
    expect(plan).toMatchObject({ reason: "auto", startIndex: ORIGINAL_INDEX, preset: undefined });
  });

  it("opens under the pin when the link measures below it", () => {
    const plan = planTranscodePreset({ ...base, mode: "fixed", qualityIndex: ORIGINAL_INDEX, measuredBps: 1_000_000 });
    expect(plan.reason).toBe("pinned");
    expect(plan.startIndex).toBeLessThan(ORIGINAL_INDEX);
    expect(plan.ceilingIndex).toBe(ORIGINAL_INDEX);
    expect(plan.preset).toBe(QUALITY_PRESETS[plan.startIndex]);
  });

  it("starts a session with a cold measurement at the floor", () => {
    const plan = planTranscodePreset({ ...base, measuredBps: null });
    expect(plan.startIndex).toBe(FLOOR_INDEX);
    expect(plan.reason).toBe("auto");
  });
});
