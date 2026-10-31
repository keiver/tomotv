import { edgeTapStep } from "@/components/page-viewer";

describe("edgeTapStep", () => {
  it("steps back inside the left band and forward inside the right one", () => {
    expect(edgeTapStep(0, 1000, 0.1)).toBe(-1);
    expect(edgeTapStep(99, 1000, 0.1)).toBe(-1);
    expect(edgeTapStep(901, 1000, 0.1)).toBe(1);
    expect(edgeTapStep(1000, 1000, 0.1)).toBe(1);
  });

  it("does nothing between the bands, at either boundary included", () => {
    expect(edgeTapStep(100, 1000, 0.1)).toBe(0);
    expect(edgeTapStep(500, 1000, 0.1)).toBe(0);
    expect(edgeTapStep(900, 1000, 0.1)).toBe(0);
  });

  it("does nothing with no band or no width", () => {
    expect(edgeTapStep(0, 1000, 0)).toBe(0);
    expect(edgeTapStep(1000, 1000, 0)).toBe(0);
    expect(edgeTapStep(0, 0, 0.1)).toBe(0);
  });
});
