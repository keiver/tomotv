import { formatSeasonEpisode } from "../seasonEpisode";

describe("formatSeasonEpisode", () => {
  it("prefers server metadata over the name", () => {
    expect(formatSeasonEpisode({ Name: "S05E09 wrong", Path: "/x/y.mkv", ParentIndexNumber: 1, IndexNumber: 2 })).toBe("S01E02");
  });

  it("zero-pads season and episode", () => {
    expect(formatSeasonEpisode({ Name: "n", Path: "", ParentIndexNumber: 3, IndexNumber: 7 })).toBe("S03E07");
  });

  it("accepts season 0 (specials)", () => {
    expect(formatSeasonEpisode({ Name: "n", Path: "", ParentIndexNumber: 0, IndexNumber: 1 })).toBe("S00E01");
  });

  it("ignores metadata when only one of the two numbers is present", () => {
    expect(formatSeasonEpisode({ Name: "no pattern here", Path: "", IndexNumber: 4 })).toBeNull();
  });

  it.each([
    ["Show S01E05", "S01E05"],
    ["show s2e9", "S02E09"],
    ["Show.S01.E05.1080p", "S01E05"],
    ["Show S01_E05", "S01E05"],
    ["Show S01-E05", "S01E05"],
    ["Show 1x05", "S01E05"],
    ["Show 12x113", "S12E113"],
  ])("parses %s from the name", (name, expected) => {
    expect(formatSeasonEpisode({ Name: name, Path: "" })).toBe(expected);
  });

  it("falls back to the filename when the name has no pattern", () => {
    expect(formatSeasonEpisode({ Name: "The Pilot", Path: "/media/tv/Show/Show.S01E01.mkv" })).toBe("S01E01");
  });

  it("handles Windows-style server paths", () => {
    expect(formatSeasonEpisode({ Name: "The Pilot", Path: "C:\\media\\tv\\Show.S01E01.mkv" })).toBe("S01E01");
  });

  it("does not match a resolution as a 1x05 pattern", () => {
    expect(formatSeasonEpisode({ Name: "Movie 1920x1080", Path: "" })).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(formatSeasonEpisode({ Name: "Some Movie (2020)", Path: "/media/movies/Some Movie (2020).mkv" })).toBeNull();
  });
});
