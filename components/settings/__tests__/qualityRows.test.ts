/** The quality choices explain their limits and data use. */
import { QUALITY_ROWS, qualityLabel, qualityRowSubtitle } from "../qualityRows";
import { ORIGINAL_INDEX } from "@/services/adaptiveQuality";

describe("qualityRows", () => {
  it("lists Auto first, then the resolution caps from 4K down", () => {
    expect(QUALITY_ROWS[0]).toBe(ORIGINAL_INDEX);
    expect(QUALITY_ROWS.map(qualityLabel)).toEqual(["Auto", "Up to 4K", "Up to 1080p", "Up to 720p", "Up to 540p", "Up to 480p"]);
  });

  it("explains Auto's adjustment to the connection", () => {
    expect(qualityRowSubtitle(ORIGINAL_INDEX)).toBe("Adjusts to your connection");
  });

  it("explains each resolution cap's quality and data use", () => {
    expect(QUALITY_ROWS.slice(1).map(qualityRowSubtitle)).toEqual([
      "Best detail, highest data use",
      "Full HD, less data than 4K",
      "HD with lower data use",
      "Lower detail, saves data",
      "Lowest detail, least data",
    ]);
  });
});
