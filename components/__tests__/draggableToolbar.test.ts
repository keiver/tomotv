/**
 * settleX is the whole horizontal gesture: whether a finished drag leaves the bar open or
 * tucked against an edge. Pure and exported so the rule can be checked off the UI thread.
 *
 * The two travels are separate on purpose. A landscape phone insets only the edge carrying
 * the sensor housing, so the bar has further to go one way than the other, and a single
 * symmetric offset left the tucked notch adrift of one edge.
 */
import { settleX } from "@/components/draggable-toolbar";

/** Portrait: no horizontal insets, so the two travels match. */
const LEFT = -400;
const RIGHT = 400;

describe("settleX", () => {
  describe("from expanded", () => {
    it("stays open when the drag never reaches a quarter of the travel", () => {
      expect(settleX(0, 99, LEFT, RIGHT)).toBe(0);
      expect(settleX(0, -99, LEFT, RIGHT)).toBe(0);
    });

    it("tucks to the side the drag went", () => {
      expect(settleX(0, 101, LEFT, RIGHT)).toBe(RIGHT);
      expect(settleX(0, -101, LEFT, RIGHT)).toBe(LEFT);
    });

    it("treats a release with no movement as staying open", () => {
      expect(settleX(0, 0, LEFT, RIGHT)).toBe(0);
    });
  });

  describe("from tucked away", () => {
    it("needs half the travel back before it reopens", () => {
      expect(settleX(RIGHT, -199, LEFT, RIGHT)).toBe(RIGHT);
      expect(settleX(RIGHT, -201, LEFT, RIGHT)).toBe(0);
      expect(settleX(LEFT, 199, LEFT, RIGHT)).toBe(LEFT);
      expect(settleX(LEFT, 201, LEFT, RIGHT)).toBe(0);
    });

    it("stays put when the drag pushes further into the edge", () => {
      expect(settleX(RIGHT, 300, LEFT, RIGHT)).toBe(RIGHT);
      expect(settleX(LEFT, -300, LEFT, RIGHT)).toBe(LEFT);
    });
  });

  describe("with one edge inset further than the other", () => {
    // What a landscape phone gives: the housing edge is inset, the opposite one is not.
    const NEAR = -300;
    const FAR = 500;

    it("commits at a quarter of THAT side's travel, not an averaged one", () => {
      expect(settleX(0, 76, NEAR, FAR)).toBe(0);
      expect(settleX(0, 126, NEAR, FAR)).toBe(FAR);
      expect(settleX(0, -76, NEAR, FAR)).toBe(NEAR);
    });

    it("measures the way back against the travel it actually took", () => {
      // Half of the short side reopens; the same distance on the long side does not.
      expect(settleX(NEAR, 151, NEAR, FAR)).toBe(0);
      expect(settleX(FAR, -151, NEAR, FAR)).toBe(FAR);
      expect(settleX(FAR, -251, NEAR, FAR)).toBe(0);
    });
  });
});
