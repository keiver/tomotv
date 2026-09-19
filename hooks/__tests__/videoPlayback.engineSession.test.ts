/**
 * The engine session's startup measurement and link steering: the pre-flight gate, the cap
 * AVPlayer picks variants under, the climb back to the copy, and the keep-or-hand-over verdict.
 */
import { createPreflightGate, dropThroughputWatch, keptForReason, linkAffordsChapterFrames, nextLinkCap, planLinkClimb, stillPullingInput, type ThroughputWatch } from "../videoPlayback/engineSession";

describe("createPreflightGate", () => {
  jest.useFakeTimers();

  it("settles the wait with the first sample", async () => {
    const gate = createPreflightGate();
    const waiting = gate.next(20_000);
    expect(gate.settle({ failed: "boom" })).toBe(true);
    await expect(waiting).resolves.toEqual({ failed: "boom" });
  });

  it("holds an outcome that lands between two waits", async () => {
    const gate = createPreflightGate();
    gate.settle({ failed: "early" });
    await expect(gate.next(20_000)).resolves.toEqual({ failed: "early" });
  });

  it("resolves null at the deadline", async () => {
    const gate = createPreflightGate();
    const waiting = gate.next(20_000);
    jest.advanceTimersByTime(20_000);
    await expect(waiting).resolves.toBeNull();
  });

  it("keeps waiting after a deadline the session outlived", async () => {
    const gate = createPreflightGate();
    const first = gate.next(20_000);
    jest.advanceTimersByTime(20_000);
    await expect(first).resolves.toBeNull();

    const second = gate.next(20_000);
    gate.settle({ failed: "late" });
    await expect(second).resolves.toEqual({ failed: "late" });
  });

  it("refuses outcomes once closed, so a late report cannot reopen the decision", () => {
    const gate = createPreflightGate();
    gate.close();
    expect(gate.settle({ failed: "too late" })).toBe(false);
  });
});

describe("stillPullingInput", () => {
  const progress = { alive: true, bytesRead: 2_000, elapsedSeconds: 20, readSeconds: 18 };

  it("extends the wait for a session alive and reading at the link's pace", () => {
    expect(stillPullingInput(progress, 1_000, 0.5)).toBe(true);
  });

  it.each([
    ["the session ended", { ...progress, alive: false }],
    ["no new bytes arrived", { ...progress, bytesRead: 1_000 }],
    ["the time went somewhere other than reading", { ...progress, readSeconds: 2 }],
    ["nothing has been measured yet", { ...progress, elapsedSeconds: 0 }],
  ])("stops waiting when %s", (_label, reading) => {
    expect(stillPullingInput(reading, 1_000, 0.5)).toBe(false);
  });

  it("stops waiting when the engine answers nothing at all", () => {
    expect(stillPullingInput(null, 1_000, 0.5)).toBe(false);
  });
});

describe("nextLinkCap", () => {
  it("commits to a share of the measured link, leaving headroom for it moving", () => {
    expect(nextLinkCap({ bps: 10_000_000, currentCap: 0, floorBps: 0 })).toBe(8_000_000);
  });

  it("never caps below the smallest variant the master lists", () => {
    // A cap under all of them leaves AVPlayer nothing it may play (drill S5 at 0.6 Mb/s).
    expect(nextLinkCap({ bps: 500_000, currentCap: 0, floorBps: 1_200_000 })).toBe(1_200_000);
  });

  it("ignores a move too small to re-evaluate the variant for", () => {
    expect(nextLinkCap({ bps: 10_400_000, currentCap: 8_000_000, floorBps: 0 })).toBeNull();
  });

  it("follows a material drop", () => {
    expect(nextLinkCap({ bps: 4_000_000, currentCap: 8_000_000, floorBps: 0 })).toBe(3_200_000);
  });
});

describe("planLinkClimb", () => {
  const base = { bps: 12_000_000, sourceBps: 8_000_000, copyListed: false as boolean | null, armed: false, nowMs: 100_000, cooldownUntilMs: 0 };

  it("arms the hold when the link clears the source with margin", () => {
    expect(planLinkClimb(base)).toBe("arm");
  });

  it("holds when the master already lists the copy: AVPlayer climbs by itself", () => {
    expect(planLinkClimb({ ...base, copyListed: true })).toBe("hold");
  });

  it("holds when the engine reported nothing about the copy", () => {
    expect(planLinkClimb({ ...base, copyListed: null })).toBe("hold");
  });

  it("cancels a pending hold when the link falls back under the margin", () => {
    expect(planLinkClimb({ ...base, bps: 8_400_000, armed: true })).toBe("cancel");
  });

  it("holds while a rebuild is already armed", () => {
    expect(planLinkClimb({ ...base, armed: true })).toBe("hold");
  });

  it("holds inside the cooldown, so a marginal link cannot bounce the session", () => {
    expect(planLinkClimb({ ...base, cooldownUntilMs: 160_000 })).toBe("hold");
  });

  it("holds when the source rate is unknown, since there is nothing to climb to", () => {
    expect(planLinkClimb({ ...base, sourceBps: 0 })).toBe("hold");
  });
});

describe("keptForReason", () => {
  const base = { belowRealtime: true, live: false, liveHasServerRung: false, tierDeclared: false, readBound: false };

  it("keeps nothing when the segment made realtime", () => {
    expect(keptForReason({ ...base, belowRealtime: false, tierDeclared: true })).toBeNull();
  });

  it("keeps a live channel that has no server rung to fall to", () => {
    expect(keptForReason({ ...base, live: true })).toBe("live");
  });

  it("hands a live channel over once the server offers a transcode", () => {
    expect(keptForReason({ ...base, live: true, liveHasServerRung: true })).toBeNull();
  });

  it("keeps a session carrying a declared tier: its primary is never the startup gate", () => {
    expect(keptForReason({ ...base, tierDeclared: true })).toBe("tier");
  });

  it("keeps a segment that was slow because its bytes arrived slowly", () => {
    expect(keptForReason({ ...base, readBound: true })).toBe("link");
  });

  it("hands over when below realtime is the device's own fault", () => {
    expect(keptForReason(base)).toBeNull();
  });
});

describe("dropThroughputWatch", () => {
  it("ends the subscription and the samples, and leaves the item's hand-over flag alone", () => {
    const unsubscribe = jest.fn();
    const watch: ThroughputWatch = { samples: [{ segmentSeconds: 6 }] as ThroughputWatch["samples"], unsubscribe, handedOver: true };

    dropThroughputWatch(watch);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(watch).toMatchObject({ samples: [], unsubscribe: null, handedOver: true });
  });

  it("is safe on a watch that never subscribed", () => {
    const watch: ThroughputWatch = { samples: [], unsubscribe: null, handedOver: false };
    expect(() => dropThroughputWatch(watch)).not.toThrow();
  });
});

describe("linkAffordsChapterFrames", () => {
  const source = 6_000_000;

  it("affords the grabber on a link that carries the copy with the master's margin", () => {
    expect(linkAffordsChapterFrames(60_000_000, source)).toBe(true);
    expect(linkAffordsChapterFrames(source * 1.2, source)).toBe(true);
  });

  it("does not on a link under that margin, which is a session riding rungs or about to", () => {
    expect(linkAffordsChapterFrames(source * 1.19, source)).toBe(false);
    expect(linkAffordsChapterFrames(1_500_000, source)).toBe(false);
  });

  it("does not before the link has been heard from, or without a source rate to hold it to", () => {
    expect(linkAffordsChapterFrames(null, source)).toBe(false);
    expect(linkAffordsChapterFrames(60_000_000, 0)).toBe(false);
  });
});
