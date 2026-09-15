import { sweepStart } from "@/components/card-nav-progress";

describe("sweepStart", () => {
  it("opens at the floor when there is no watched fraction", () => {
    expect(sweepStart()).toBeCloseTo(0.08);
    expect(sweepStart(0)).toBeCloseTo(0.08);
  });

  it("floors a tiny watched fraction so the fill is visible", () => {
    expect(sweepStart(0.02)).toBeCloseTo(0.08);
  });

  it("continues from a real watched fraction", () => {
    expect(sweepStart(0.5)).toBeCloseTo(0.5);
  });

  it("caps at a full bar", () => {
    expect(sweepStart(1.5)).toBe(1);
  });
});
