/**
 * The ring is two half-arcs rotating inside half-width clips, so the whole drawing is these
 * two angles. Checked as arithmetic rather than by rendering, which would prove nothing about
 * what ends up on screen anyway.
 */
import { ringRotations } from "@/components/progress-ring";

/** Where each half sits when its clip hides it, and when its clip shows all of it. */
const RIGHT_EMPTY = 225;
const RIGHT_FULL = 405;
const LEFT_EMPTY = 45;
const LEFT_FULL = 225;

describe("ringRotations", () => {
  it("shows nothing at zero", () => {
    expect(ringRotations(0)).toEqual({ right: RIGHT_EMPTY, left: LEFT_EMPTY });
  });

  it("fills the right half over the first 50%, leaving the left alone", () => {
    expect(ringRotations(0.25)).toEqual({ right: 315, left: LEFT_EMPTY });
    expect(ringRotations(0.5)).toEqual({ right: RIGHT_FULL, left: LEFT_EMPTY });
  });

  it("holds the right half full while the left one fills", () => {
    expect(ringRotations(0.75)).toEqual({ right: RIGHT_FULL, left: 135 });
    expect(ringRotations(1)).toEqual({ right: RIGHT_FULL, left: LEFT_FULL });
  });

  it("clamps rather than spinning past a full circle", () => {
    expect(ringRotations(1.4)).toEqual({ right: RIGHT_FULL, left: LEFT_FULL });
    expect(ringRotations(-2)).toEqual({ right: RIGHT_EMPTY, left: LEFT_EMPTY });
  });

  it("advances the visible arc monotonically", () => {
    const sweep = [0, 0.1, 0.3, 0.49, 0.51, 0.8, 1].map(ringRotations);
    const covered = sweep.map(({ right, left }) => right - RIGHT_EMPTY + (left - LEFT_EMPTY));
    expect(covered).toEqual([...covered].sort((a, b) => a - b));
    expect(covered[covered.length - 1]).toBe(360);
  });
});
