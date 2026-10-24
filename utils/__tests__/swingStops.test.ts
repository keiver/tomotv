import { swingStops } from "@/utils/swingStops";

describe("swingStops", () => {
  it("goes from the start to the peak by the middle and back by the end", () => {
    const { inputRange, outputRange } = swingStops(0.25, 1);
    expect(inputRange[0]).toBe(0);
    expect(inputRange.at(-1)).toBe(1);
    expect(outputRange[0]).toBeCloseTo(0.25);
    expect(outputRange[inputRange.indexOf(0.5)]).toBeCloseTo(1);
    expect(outputRange.at(-1)).toBeCloseTo(0.25);
  });

  it("rises and falls symmetrically, eased slow at both ends", () => {
    const { outputRange } = swingStops(0, 1, 16);
    for (let i = 0; i <= 16; i++) expect(outputRange[i]).toBeCloseTo(outputRange[16 - i]);
    expect(outputRange[1] - outputRange[0]).toBeLessThan(outputRange[5] - outputRange[4]);
  });

  it("keeps the input range ascending, as interpolation requires", () => {
    const { inputRange } = swingStops(1, 0.35, 8);
    expect(inputRange).toEqual([...inputRange].sort((a, b) => a - b));
    expect(inputRange).toHaveLength(9);
  });
});
