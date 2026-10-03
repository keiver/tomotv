/** The Quality page's rows: Original first, and each subtitle stating what the row does on the measured connection. */
import { QUALITY_ROWS, qualityLabel, qualityRowSubtitle } from "../qualityRows";
import { ORIGINAL_INDEX } from "@/services/adaptiveQuality";

describe("qualityRows", () => {
  it("lists Original first, then the rungs from 4K down", () => {
    expect(QUALITY_ROWS[0]).toBe(ORIGINAL_INDEX);
    expect(QUALITY_ROWS.map(qualityLabel)).toEqual(["Auto", "Up to 4K", "Up to 1080p", "Up to 720p", "Up to 540p", "Up to 480p"]);
  });

  it("describes Auto by the rungs the connection carries, and as adaptive before a measurement", () => {
    expect(qualityRowSubtitle(ORIGINAL_INDEX, null)).toBe("Adapts as it plays");
    expect(qualityRowSubtitle(ORIGINAL_INDEX, 200_000_000)).toMatch(/^Up to .* for now$/);
    expect(qualityRowSubtitle(ORIGINAL_INDEX, 100_000)).toMatch(/^Only .* for now$/);
  });

  it("states a rung's need, then whether the connection carries it", () => {
    expect(qualityRowSubtitle(0, null)).toMatch(/^Needs \d+ Mbps$/);
    expect(qualityRowSubtitle(4, 200_000_000)).toMatch(/^Needs \d+ Mbps, plays in full$/);
    expect(qualityRowSubtitle(4, 100_000)).toMatch(/^Needs \d+ Mbps, (may stall|plays .* for now)$/);
  });
});
