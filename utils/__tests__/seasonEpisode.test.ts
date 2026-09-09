import { formatIndexBadge, formatSeasonEpisode, orderSortNameTies, parseSeasonEpisode } from "../seasonEpisode";

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

  // #68: Jellyfin fills a tagged track's IndexNumber with the track and
  // ParentIndexNumber with the disc, which read as a season/episode pair.
  it.each(["Audio", "AudioBook"])("never turns a %s disc/track pair into a season/episode", (type) => {
    expect(formatSeasonEpisode({ Name: "Disc One Track One", Path: "/music/01.flac", ParentIndexNumber: 1, IndexNumber: 1, Type: type })).toBeNull();
  });

  it("ignores an explicit S01E05 in an audio track's own name", () => {
    expect(formatSeasonEpisode({ Name: "Live S01E05 Session", Path: "", Type: "Audio" })).toBeNull();
  });

  it("still tags a music video, which numbers nothing", () => {
    expect(formatSeasonEpisode({ Name: "n", Path: "", ParentIndexNumber: 1, IndexNumber: 4, Type: "MusicVideo" })).toBe("S01E04");
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

describe("formatIndexBadge", () => {
  it.each([
    [{ Name: "Disc One Track One", Path: "", ParentIndexNumber: 1, IndexNumber: 1, Type: "Audio" }, 1, 1],
    [{ Name: "Disc Two Track Five", Path: "", ParentIndexNumber: 2, IndexNumber: 5, Type: "Audio" }, 2, 5],
    [{ Name: "Chapter One", Path: "", ParentIndexNumber: 1, IndexNumber: 2, Type: "AudioBook" }, 1, 2],
  ])("shows whatever disc the file is tagged with, first one included", (item, disc, label) => {
    expect(formatIndexBadge(item)).toEqual({ kind: "track", disc, label });
  });

  it("has no disc segment when the file carries no disc tag", () => {
    expect(formatIndexBadge({ Name: "Track Only No Disc", Path: "", IndexNumber: 7, Type: "Audio" })).toEqual({ kind: "track", disc: null, label: 7 });
  });

  it("keeps a track number of 0 (the card guards on the object, not truthiness)", () => {
    expect(formatIndexBadge({ Name: "Intro", Path: "", IndexNumber: 0, Type: "Audio" })).toEqual({ kind: "track", disc: null, label: 0 });
  });

  it("drops a disc with no track number rather than badging a lone disc", () => {
    expect(formatIndexBadge({ Name: "Side B", Path: "", ParentIndexNumber: 2, Type: "Audio" })).toBeNull();
  });

  it.each([
    ["Untagged Song", "Audio"],
    ["Artist - 05 - Named Like A Track", "Audio"],
    ["Live S01E05 Session", "Audio"],
  ])("gives an untagged music item no badge at all: %s", (name, type) => {
    expect(formatIndexBadge({ Name: name, Path: "", Type: type })).toBeNull();
  });

  it("tags an episode, which needs no icon to read as one", () => {
    expect(formatIndexBadge({ Name: "The Pilot", Path: "", ParentIndexNumber: 1, IndexNumber: 1, Type: "Episode" })).toEqual({ kind: "seasonEpisode", label: "S01E01" });
  });

  it("returns null when neither tier answers", () => {
    expect(formatIndexBadge({ Name: "Some Movie (2020)", Path: "", Type: "Movie" })).toBeNull();
  });
});

describe("parseSeasonEpisode", () => {
  it("returns numbers from server metadata", () => {
    expect(parseSeasonEpisode({ Name: "n", Path: "", ParentIndexNumber: 3, IndexNumber: 7 })).toEqual({ season: 3, episode: 7 });
  });

  it("returns a null season for a bare episode on Type Episode", () => {
    expect(parseSeasonEpisode({ Name: "n", Path: "", IndexNumber: 5, Type: "Episode" })).toEqual({ season: null, episode: 5 });
  });

  it("parses the pair out of the filename when the server has none", () => {
    expect(parseSeasonEpisode({ Name: "Raised by Wolves", Path: "/m/Raised.by.Wolves.2020.S01E04.720p.mkv" })).toEqual({ season: 1, episode: 4 });
  });

  it("parses 1x02 and Episode 7 forms", () => {
    expect(parseSeasonEpisode({ Name: "Show 1x02", Path: "" })).toEqual({ season: 1, episode: 2 });
    expect(parseSeasonEpisode({ Name: "Show Episode 7", Path: "" })).toEqual({ season: null, episode: 7 });
  });

  it("returns null when nothing is derivable", () => {
    expect(parseSeasonEpisode({ Name: "Plain Movie", Path: "/m/Plain.Movie.2019.mkv" })).toBeNull();
  });

  it("agrees with the badge formatter on every branch", () => {
    const cases = [
      { Name: "n", Path: "", ParentIndexNumber: 1, IndexNumber: 2 },
      { Name: "n", Path: "", IndexNumber: 5, Type: "Episode" },
      { Name: "Show", Path: "/x/Show.S02E03.mkv" },
      { Name: "Show - 05 (1080p)", Path: "" },
      { Name: "Song", Path: "", IndexNumber: 3, Type: "Audio" },
      { Name: "Plain", Path: "" },
    ];
    for (const item of cases) {
      const pair = parseSeasonEpisode(item);
      const tag = formatSeasonEpisode(item);
      if (pair === null) expect(tag).toBeNull();
      else expect(tag).toBe(pair.season === null ? `E${String(pair.episode).padStart(2, "0")}` : `S${String(pair.season).padStart(2, "0")}E${String(pair.episode).padStart(2, "0")}`);
    }
  });
});

describe("orderSortNameTies", () => {
  const scanned = (episode: number, name = "Raised by Wolves") => ({
    Id: `e${episode}`,
    Name: name,
    Type: "Movie",
    Path: `/media/Raised.by.Wolves.2020.S01/Raised.by.Wolves.2020.S01E${String(episode).padStart(2, "0")}.720p.WEBRip.x264.mkv`,
  });
  const ids = <T extends { Id: string }>(list: T[]) => list.map((item) => item.Id);

  it("puts a same-named flat episode folder in season/episode order (the server's real row order)", () => {
    const rowOrder = [4, 6, 2, 3, 8, 1, 7, 5, 10, 9].map((n) => scanned(n));
    expect(ids(orderSortNameTies(rowOrder))).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10"]);
  });

  it("orders by season before episode", () => {
    const items = [
      { Id: "s2e1", Name: "Show", Path: "/x/Show.S02E01.mkv" },
      { Id: "s1e2", Name: "Show", Path: "/x/Show.S01E02.mkv" },
      { Id: "s1e1", Name: "Show", Path: "/x/Show.S01E01.mkv" },
    ];
    expect(ids(orderSortNameTies(items))).toEqual(["s1e1", "s1e2", "s2e1"]);
  });

  it("orders numerically, not lexically (E10 after E9)", () => {
    const items = [scanned(10), scanned(9), scanned(100), scanned(1)];
    expect(ids(orderSortNameTies(items))).toEqual(["e1", "e9", "e10", "e100"]);
  });

  it("leaves differently named neighbours where the server put them", () => {
    const items = [
      { Id: "a", Name: "Alpha", Path: "/x/Alpha.S01E09.mkv" },
      { Id: "b", Name: "Beta", Path: "/x/Beta.S01E01.mkv" },
      { Id: "c", Name: "The Gamma", Path: "/x/Gamma.S01E05.mkv" },
    ];
    expect(orderSortNameTies(items)).toBe(items);
  });

  it("does not group names that differ only by case (the server ordered those by Name)", () => {
    const items = [
      { Id: "b", Name: "Show", Path: "/x/Show.S01E02.mkv" },
      { Id: "a", Name: "show", Path: "/x/Show.S01E01.mkv" },
    ];
    expect(orderSortNameTies(items)).toBe(items);
  });

  it("only reorders inside a run, including a run that spans a page boundary", () => {
    const items = [{ Id: "a", Name: "Alpha", Path: "/x/Alpha.mkv" }, scanned(63), scanned(2), { Id: "z", Name: "Zulu", Path: "/x/Zulu.mkv" }];
    expect(ids(orderSortNameTies(items))).toEqual(["a", "e2", "e63", "z"]);
  });

  it("handles several runs in one list independently", () => {
    const items = [
      { Id: "a2", Name: "Alpha", Path: "/x/Alpha.S01E02.mkv" },
      { Id: "a1", Name: "Alpha", Path: "/x/Alpha.S01E01.mkv" },
      { Id: "m", Name: "Middle", Path: "/x/Middle.mkv" },
      { Id: "z3", Name: "Zulu", Path: "/x/Zulu.S01E03.mkv" },
      { Id: "z1", Name: "Zulu", Path: "/x/Zulu.S01E01.mkv" },
      { Id: "z2", Name: "Zulu", Path: "/x/Zulu.S01E02.mkv" },
    ];
    expect(ids(orderSortNameTies(items))).toEqual(["a1", "a2", "m", "z1", "z2", "z3"]);
  });

  it("keeps unparsable same-named items after the parsed ones, in their own order", () => {
    const items = [
      { Id: "x", Name: "Show", Path: "/x/Show.Sample.mkv" },
      { Id: "e2", Name: "Show", Path: "/x/Show.S01E02.mkv" },
      { Id: "y", Name: "Show", Path: "/x/Show.Trailer.mkv" },
      { Id: "e1", Name: "Show", Path: "/x/Show.S01E01.mkv" },
    ];
    expect(ids(orderSortNameTies(items))).toEqual(["e1", "e2", "x", "y"]);
  });

  it("keeps a run of unparsable same-named items untouched", () => {
    const items = [
      { Id: "b", Name: "Show", Path: "/x/Show.Part.B.mkv" },
      { Id: "a", Name: "Show", Path: "/x/Show.Part.A.mkv" },
    ];
    expect(orderSortNameTies(items)).toBe(items);
  });

  it("keeps items with equal pairs in server order", () => {
    const items = [
      { Id: "dup-b", Name: "Show", Path: "/x/Show.S01E01.1080p.mkv" },
      { Id: "dup-a", Name: "Show", Path: "/x/Show.S01E01.720p.mkv" },
    ];
    expect(orderSortNameTies(items)).toBe(items);
  });

  it("sorts a season-less episode as season 0", () => {
    const items = [
      { Id: "s1e1", Name: "Show", Path: "/x/Show.S01E01.mkv" },
      { Id: "e3", Name: "Show", Path: "/x/Show.Episode.3.mkv" },
      { Id: "e2", Name: "Show", Path: "/x/Show.Episode.2.mkv" },
    ];
    expect(ids(orderSortNameTies(items))).toEqual(["e2", "e3", "s1e1"]);
  });

  it("prefers server index numbers over the filename inside a run", () => {
    const items = [
      { Id: "b", Name: "Show", Path: "/x/Show.S01E01.mkv", ParentIndexNumber: 1, IndexNumber: 2 },
      { Id: "a", Name: "Show", Path: "/x/Show.S01E02.mkv", ParentIndexNumber: 1, IndexNumber: 1 },
    ];
    expect(ids(orderSortNameTies(items))).toEqual(["a", "b"]);
  });

  it("reads Windows paths", () => {
    const items = [
      { Id: "b", Name: "Show", Path: "C:\\tv\\Show\\Show.S01E02.mkv" },
      { Id: "a", Name: "Show", Path: "C:\\tv\\Show\\Show.S01E01.mkv" },
    ];
    expect(ids(orderSortNameTies(items))).toEqual(["a", "b"]);
  });

  it("never reorders audio tracks that share a title", () => {
    const items = [
      { Id: "t3", Name: "Intro", Path: "/m/03 Intro.flac", Type: "Audio", IndexNumber: 3 },
      { Id: "t1", Name: "Intro", Path: "/m/01 Intro.flac", Type: "Audio", IndexNumber: 1 },
    ];
    expect(orderSortNameTies(items)).toBe(items);
  });

  it("never groups items with no Name", () => {
    const items = [
      { Id: "b", Name: undefined as unknown as string, Path: "/x/Show.S01E02.mkv" },
      { Id: "a", Name: undefined as unknown as string, Path: "/x/Show.S01E01.mkv" },
      { Id: "d", Name: "", Path: "/x/Show.S01E04.mkv" },
      { Id: "c", Name: "", Path: "/x/Show.S01E03.mkv" },
    ];
    expect(orderSortNameTies(items)).toBe(items);
  });

  it("returns the input array itself when nothing moves, a new array when something does", () => {
    const still = [scanned(1), scanned(2)];
    expect(orderSortNameTies(still)).toBe(still);
    const moved = [scanned(2), scanned(1)];
    expect(orderSortNameTies(moved)).not.toBe(moved);
  });

  it("never mutates the input and keeps every item reference", () => {
    const items = [scanned(3), scanned(1), scanned(2)];
    const snapshot = [...items];
    const out = orderSortNameTies(items);
    expect(items).toEqual(snapshot);
    expect(out).toHaveLength(3);
    for (const item of out) expect(items).toContain(item);
    expect(new Set(out).size).toBe(3);
  });

  it("handles empty and single-item lists", () => {
    const empty: { Id: string; Name: string; Path: string }[] = [];
    expect(orderSortNameTies(empty)).toBe(empty);
    const one = [scanned(1)];
    expect(orderSortNameTies(one)).toBe(one);
  });

  it("orders a 5000-item run in well under a second", () => {
    const big = Array.from({ length: 5000 }, (_, i) => scanned(5000 - i));
    const started = Date.now();
    const out = orderSortNameTies(big);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out[0].Id).toBe("e1");
    expect(out[4999].Id).toBe("e5000");
  });
});
