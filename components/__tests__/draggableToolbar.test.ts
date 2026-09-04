/**
 * settleX is the whole horizontal gesture: whether a released drag leaves the bar where it was
 * let go, snaps it back onto the screen, or tucks it against an edge. Pure and exported so the
 * rule can be checked off the UI thread.
 */
import { settleX, type Travel } from "@/components/draggable-toolbar";

/** A 390pt phone holding the 288pt pill: 16 of margin to rest in, a quarter of the pill commits. */
const PHONE: Travel = { rest: 35, edge: 51, commit: 72, tuck: 318 };
/** A window the pill fills to its margins: nowhere to rest but the centre. */
const NARROW: Travel = { rest: 0, edge: 16, commit: 72, tuck: 267 };

describe("settleX", () => {
  it("leaves a bar let go on screen exactly where it was released", () => {
    expect(settleX(0, PHONE)).toBe(0);
    expect(settleX(20, PHONE)).toBe(20);
    expect(settleX(-35, PHONE)).toBe(-35);
  });

  describe("let go hanging off the edge", () => {
    it("snaps back to the margin while less than a quarter of it is off screen", () => {
      expect(settleX(51, PHONE)).toBe(35);
      expect(settleX(123, PHONE)).toBe(35);
      expect(settleX(-100, PHONE)).toBe(-35);
    });

    it("tucks to that side once more than a quarter is off screen", () => {
      expect(settleX(124, PHONE)).toBe(318);
      expect(settleX(-124, PHONE)).toBe(-318);
    });
  });

  describe("from tucked away", () => {
    it("stays tucked while more than a quarter is still off screen", () => {
      expect(settleX(318, PHONE)).toBe(318);
      expect(settleX(200, PHONE)).toBe(318);
      expect(settleX(-200, PHONE)).toBe(-318);
    });

    it("reopens beside its edge once pulled back past the commit line", () => {
      expect(settleX(123, PHONE)).toBe(35);
      expect(settleX(-123, PHONE)).toBe(-35);
    });
  });

  it("offers only the centre and the two tucks in a window the pill fills", () => {
    expect(settleX(10, NARROW)).toBe(0);
    expect(settleX(-80, NARROW)).toBe(0);
    expect(settleX(-89, NARROW)).toBe(-267);
    expect(settleX(89, NARROW)).toBe(267);
  });
});
