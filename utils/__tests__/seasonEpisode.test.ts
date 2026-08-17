import { formatSeasonEpisode } from "../seasonEpisode";

describe("formatSeasonEpisode", () => {
  it("prefers server metadata over the name", () => {
    expect(formatSeasonEpisode({ Name: "S05E09 wrong", Path: "/x/y.mkv", ParentIndexNumber: 1, IndexNumber: 2 })).toBe("S01E02");
  });

  it("drops a season/episode pair that is really the year in the filename", () => {
    expect(
      formatSeasonEpisode({
        Name: "To.Wong.Foo.Thanks.for.Everything.Julie.Newma",
        Path: "/Users/k/Movies/To.Wong.Foo.Thanks.for.Everything.Julie.Newma.1995.DVDRip.XviD.AC3-REKD/To.Wong.Foo.Thanks.for.Everything.Julie.Newma.1995.DVDRip.XviD.AC3-REKD.avi",
        ParentIndexNumber: 19,
        IndexNumber: 95,
        Type: "Episode",
      }),
    ).toBeNull();
  });

  it("keeps a season/episode pair the filename spells out next to a year", () => {
    expect(formatSeasonEpisode({ Name: "Show S19E95 (1995)", Path: "", ParentIndexNumber: 19, IndexNumber: 95 })).toBe("S19E95");
  });

  it("keeps a high season when no year in the text matches it", () => {
    expect(formatSeasonEpisode({ Name: "Greys Anatomy", Path: "/tv/Greys/Greys.S19E05.1080p.mkv", ParentIndexNumber: 19, IndexNumber: 5 })).toBe("S19E05");
  });

  it("zero-pads season and episode", () => {
    expect(formatSeasonEpisode({ Name: "n", Path: "", ParentIndexNumber: 3, IndexNumber: 7 })).toBe("S03E07");
  });

  it("accepts season 0 (specials)", () => {
    expect(formatSeasonEpisode({ Name: "n", Path: "", ParentIndexNumber: 0, IndexNumber: 1 })).toBe("S00E01");
  });

  it("ignores a lone episode number on non-episode types", () => {
    expect(formatSeasonEpisode({ Name: "no pattern here", Path: "", IndexNumber: 4 })).toBeNull();
  });

  it("trusts a lone episode number on Type Episode (season-less anime)", () => {
    expect(formatSeasonEpisode({ Name: "no pattern here", Path: "", IndexNumber: 5, Type: "Episode" })).toBe("E05");
  });

  it("never turns an audio track number into an episode", () => {
    expect(formatSeasonEpisode({ Name: "Song Title", Path: "", IndexNumber: 3, Type: "Audio" })).toBeNull();
  });

  it.each([
    ["Show S01E05", "S01E05"],
    ["show s2e9", "S02E09"],
    ["Show.S01.E05.1080p", "S01E05"],
    ["Show S01_E05", "S01E05"],
    ["Show S01-E05", "S01E05"],
    ["Show 1x05", "S01E05"],
    ["Show 12x113", "S12E113"],
    ["Show S01E1071", "S01E1071"],
    ["Show Season 2 Episode 4", "S02E04"],
    ["Show Ep 7", "E07"],
    ["Show Ep. 12", "E12"],
    ["Show Episode 1071", "E1071"],
    ["Show E05 Finale", "E05"],
    ["[SubsPlease] Show - 05 (1080p)", "E05"],
    ["Show - 05v2", "E05"],
    ["Show - 1071", "E1071"],
  ])("parses %s from the name", (name, expected) => {
    expect(formatSeasonEpisode({ Name: name, Path: "" })).toBe(expected);
  });

  it.each([
    ["Movie - 2017"], // year, not an episode
    ["Rocky - 2"], // sequel: bare numbers need 2+ digits
    ["E3 2019 Conference"], // bare E needs 2+ digits
  ])("does not misread %s", (name) => {
    expect(formatSeasonEpisode({ Name: name, Path: "" })).toBeNull();
  });

  it("skips the bare-number form for audio names", () => {
    expect(formatSeasonEpisode({ Name: "Artist - 05 - Song", Path: "", Type: "Audio" })).toBeNull();
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
