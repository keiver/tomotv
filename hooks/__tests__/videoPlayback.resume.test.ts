/**
 * Where a session opens. StartTimeTicks is deliberately unused: with fMP4 segments Jellyfin
 * answers the EXT-X-MAP init segment with HTTP 400 whenever it is set, so resume is a
 * client-side seek in every mode.
 */
import { resolveResume } from "../videoPlayback/resume";

const TICKS_PER_SECOND = 10_000_000;

describe("resolveResume", () => {
  it("maps the caller's ticks to seconds", () => {
    expect(resolveResume({ live: false, pendingSeekSec: null, startPositionTicks: 600 * TICKS_PER_SECOND, userDataTicks: undefined })).toEqual({ seconds: 600, source: "caller" });
  });

  it("falls back to the server's UserData position", () => {
    expect(resolveResume({ live: false, pendingSeekSec: null, startPositionTicks: undefined, userDataTicks: 90 * TICKS_PER_SECOND })).toEqual({ seconds: 90, source: "server" });
  });

  it("trusts what the launching screen displayed over the refetched UserData", () => {
    const decision = resolveResume({ live: false, pendingSeekSec: null, startPositionTicks: 600 * TICKS_PER_SECOND, userDataTicks: 5 * TICKS_PER_SECOND });
    expect(decision).toEqual({ seconds: 600, source: "caller" });
  });

  it("leaves a pending seek alone: a restart owns the playhead", () => {
    expect(resolveResume({ live: false, pendingSeekSec: 42, startPositionTicks: 600 * TICKS_PER_SECOND, userDataTicks: 90 * TICKS_PER_SECOND })).toEqual({ seconds: null, source: null });
  });

  it("never resumes a live channel", () => {
    expect(resolveResume({ live: true, pendingSeekSec: null, startPositionTicks: 600 * TICKS_PER_SECOND, userDataTicks: 90 * TICKS_PER_SECOND })).toEqual({ seconds: null, source: null });
  });

  it.each([
    ["absent", undefined],
    ["zero", 0],
  ])("does not resume when the position is %s", (_label, ticks) => {
    expect(resolveResume({ live: false, pendingSeekSec: null, startPositionTicks: ticks, userDataTicks: ticks })).toEqual({ seconds: null, source: null });
  });
});
