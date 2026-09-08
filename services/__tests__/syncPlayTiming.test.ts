import { computeClockSample, evaluateDrift, medianOffset, medianPing, serverToLocalMs, SYNC_PLAY } from "../syncPlayTiming";

describe("computeClockSample", () => {
  it("reads a symmetric round trip as pure offset", () => {
    // Server runs 5 s ahead; 100 ms each way.
    const t0 = 1_000_000;
    const sample = computeClockSample(t0, new Date(t0 + 5000 + 100).toISOString(), new Date(t0 + 5000 + 100).toISOString(), t0 + 200);
    expect(sample).toEqual({ offsetMs: 5000, pingMs: 100 });
  });

  it("keeps an asymmetric trip's error inside the ping", () => {
    // 300 ms out, 100 ms back: the true offset is 5000, the estimate lands inside 100 ms of it.
    const t0 = 1_000_000;
    const sample = computeClockSample(t0, new Date(t0 + 5000 + 300).toISOString(), new Date(t0 + 5000 + 300).toISOString(), t0 + 400);
    expect(sample?.pingMs).toBe(200);
    expect(Math.abs((sample?.offsetMs ?? 0) - 5000)).toBeLessThanOrEqual(200);
  });

  it("rejects unparseable server stamps", () => {
    expect(computeClockSample(0, "nope", "nope", 10)).toBeNull();
  });
});

describe("medians", () => {
  it("ignores one spike", () => {
    const samples = [10, 12, 11, 900, 9, 10, 11, 12].map((offsetMs) => ({ offsetMs, pingMs: offsetMs }));
    expect(medianOffset(samples)).toBe(11);
    expect(medianPing(samples)).toBe(11);
  });

  it("is 0 with no samples", () => {
    expect(medianOffset([])).toBe(0);
  });
});

describe("serverToLocalMs", () => {
  it("subtracts the offset from the server stamp", () => {
    const when = new Date(2_000_000).toISOString();
    expect(serverToLocalMs(when, 5000)).toBe(1_995_000);
  });
});

describe("evaluateDrift", () => {
  it("leaves drift under the floor alone", () => {
    expect(evaluateDrift({ playerSeconds: 100.3, groupSeconds: 100, holding: false })).toBe("none");
    expect(evaluateDrift({ playerSeconds: 99.7, groupSeconds: 100, holding: false })).toBe("none");
  });

  it("holds for a lead inside the band and not beyond it", () => {
    expect(evaluateDrift({ playerSeconds: 102, groupSeconds: 100, holding: false })).toBe("hold");
    expect(evaluateDrift({ playerSeconds: 100 + SYNC_PLAY.HOLD_LEAD_MAX_MS / 1000 + 1, groupSeconds: 100, holding: false })).toBe("none");
  });

  it("never holds for a lag", () => {
    expect(evaluateDrift({ playerSeconds: 95, groupSeconds: 100, holding: false })).toBe("none");
  });

  it("resumes once the group has caught up", () => {
    expect(evaluateDrift({ playerSeconds: 102, groupSeconds: 100, holding: true })).toBe("none");
    expect(evaluateDrift({ playerSeconds: 100.2, groupSeconds: 100, holding: true })).toBe("resume");
  });
});
