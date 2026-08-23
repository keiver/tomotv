/**
 * settleX is the whole horizontal gesture: whether a finished drag leaves the bar open or
 * tucked against an edge. Pure and exported so the rule can be checked off the UI thread.
 */
import { settleX } from "@/components/draggable-toolbar";

const OFFSET = 400;

describe("settleX", () => {
  describe("from expanded", () => {
    it("stays open when the drag never reaches a quarter of the travel", () => {
      expect(settleX(0, 99, OFFSET)).toBe(0);
      expect(settleX(0, -99, OFFSET)).toBe(0);
    });

    it("tucks to the side the drag went", () => {
      expect(settleX(0, 101, OFFSET)).toBe(OFFSET);
      expect(settleX(0, -101, OFFSET)).toBe(-OFFSET);
    });

    it("treats a release with no movement as staying open", () => {
      expect(settleX(0, 0, OFFSET)).toBe(0);
    });
  });

  describe("from tucked away", () => {
    it("needs half the travel back before it reopens", () => {
      expect(settleX(OFFSET, -199, OFFSET)).toBe(OFFSET);
      expect(settleX(OFFSET, -201, OFFSET)).toBe(0);
      expect(settleX(-OFFSET, 199, OFFSET)).toBe(-OFFSET);
      expect(settleX(-OFFSET, 201, OFFSET)).toBe(0);
    });

    it("stays put when the drag pushes further into the edge", () => {
      expect(settleX(OFFSET, 300, OFFSET)).toBe(OFFSET);
      expect(settleX(-OFFSET, -300, OFFSET)).toBe(-OFFSET);
    });
  });
});
