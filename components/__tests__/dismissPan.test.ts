import { leavingByPan } from "@/components/dismiss-pan";

/**
 * The rule that decides whether a drag was somebody leaving the player.
 *
 * It matters more than a gesture rule usually would: committing it tears the session down,
 * and on the phone that unmounts <Video> under AVKit's presented player.
 */
describe("leavingByPan", () => {
  it("leaves on a drag past the commit distance", () => {
    expect(leavingByPan({ translationY: 140, velocityY: 0 }, true)).toBe(true);
  });

  it("stays on a slow drag that stopped short", () => {
    expect(leavingByPan({ translationY: 90, velocityY: 100 }, true)).toBe(false);
  });

  it("leaves on a flick that covered real ground", () => {
    expect(leavingByPan({ translationY: 80, velocityY: 1200 }, true)).toBe(true);
  });

  // The user-facing half of the bug: a twitch just past the 24pt activation threshold reads
  // as fast, and velocity alone used to be enough to leave.
  it("stays on a twitch, however fast it was", () => {
    expect(leavingByPan({ translationY: 30, velocityY: 2400 }, true)).toBe(false);
  });

  // The other half. RNGH runs the END callback for CANCELLED and FAILED too, and a second
  // finger landing cancels an active pan mid-movement.
  it("never leaves on a gesture that was cancelled rather than released", () => {
    expect(leavingByPan({ translationY: 300, velocityY: 3000 }, false)).toBe(false);
    expect(leavingByPan({ translationY: 80, velocityY: 1200 }, false)).toBe(false);
  });

  it("ignores an upward flick", () => {
    expect(leavingByPan({ translationY: -200, velocityY: -3000 }, true)).toBe(false);
  });
});
