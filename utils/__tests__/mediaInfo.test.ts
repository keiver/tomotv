import { JellyfinItem, JellyfinMediaStream } from "@/types/jellyfin";
import {
  buildDetailRows,
  formatBitrate,
  formatCoordinates,
  formatExposure,
  formatFileSize,
  formatIndexLine,
  formatMediaDate,
  formatPixelSize,
  joinMeta,
  overviewParagraphs,
  streamDetailLine,
} from "../mediaInfo";

// Field-for-field the shapes the live server returned for each kind (Jellyfin 10.11.11).
const PHOTO = {
  Name: "01-home",
  Id: "photo-1",
  Type: "Photo",
  Path: "/Users/k/Pictures/appstore-ipad/01-home.png",
  DateCreated: "2026-08-19T04:31:25.4932031Z",
  Album: "appstore-ipad",
  Width: 2064,
  Height: 2752,
  RunTimeTicks: 0,
  UserData: { PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, Played: false },
} as unknown as JellyfinItem;

const SERIES = {
  Name: "Caminandes",
  Id: "series-1",
  Type: "Series",
  Path: "/Users/k/Movies/Shows/Caminandes",
  DateCreated: "2026-08-17T13:06:48.811098Z",
  DateLastMediaAdded: "2026-08-14T15:50:34.8099727Z",
  PremiereDate: "2013-11-13T00:00:00.0000000Z",
  ProductionYear: 2013,
  RecursiveItemCount: 2,
  ChildCount: 1,
  RunTimeTicks: 0,
  UserData: { UnplayedItemCount: 2, PlayCount: 0, PlaybackPositionTicks: 0 },
} as unknown as JellyfinItem;

// A tagged song: Jellyfin puts the track in IndexNumber and the disc in
// ParentIndexNumber (AudioFileProber), the pair #68 was reading as S02E05.
const SONG = {
  Name: "Shine On You Crazy Diamond",
  Id: "audio-1",
  Type: "Audio",
  Path: "/Users/k/Music/Wish You Were Here/1-05 Shine On.flac",
  Album: "Wish You Were Here",
  Artists: ["Pink Floyd"],
  IndexNumber: 5,
  ParentIndexNumber: 2,
  RunTimeTicks: 0,
} as unknown as JellyfinItem;

describe("buildDetailRows", () => {
  const valueFor = (rows: { label: string; value: string }[], label: string) => rows.find((row) => row.label === label)?.value;

  it("gives a photo its pixels, album and dates", () => {
    const rows = buildDetailRows(PHOTO, { dimensionsShownElsewhere: false });

    expect(valueFor(rows, "Dimensions")).toBe("2064×2752 · 5.7 MP");
    expect(valueFor(rows, "Album")).toBe("appstore-ipad");
    expect(valueFor(rows, "Added")).toBe("19 Aug 2026");
  });

  it("counts a series' episodes and its unplayed remainder", () => {
    const rows = buildDetailRows(SERIES, { dimensionsShownElsewhere: false });

    expect(valueFor(rows, "Contains")).toBe("2 episodes · 2 unplayed");
    expect(valueFor(rows, "Released")).toBe("13 Nov 2013");
    expect(valueFor(rows, "Latest media")).toBe("14 Aug 2026");
  });

  it("counts a photo album in photos, singular when there is one", () => {
    const rows = buildDetailRows({ ...SERIES, Type: "PhotoAlbum", RecursiveItemCount: 1 }, { dimensionsShownElsewhere: false });

    expect(valueFor(rows, "Contains")).toBe("1 photo · 2 unplayed");
  });

  it("drops the dimensions when the panel states them above", () => {
    const rows = buildDetailRows({ ...PHOTO, Type: "Episode" }, { dimensionsShownElsewhere: true });

    expect(valueFor(rows, "Dimensions")).toBeUndefined();
  });

  // The server sends 0001-01-01 for a folder that never had media added.
  it("treats the server's year-one sentinel as no date", () => {
    const rows = buildDetailRows({ ...SERIES, DateLastMediaAdded: "0001-01-01T00:00:00.0000000Z" }, { dimensionsShownElsewhere: false });

    expect(valueFor(rows, "Latest media")).toBeUndefined();
  });

  it("emits no empty rows", () => {
    const rows = buildDetailRows({ Name: "Bare", Id: "x", Type: "Movie" } as unknown as JellyfinItem, { dimensionsShownElsewhere: true });

    expect(rows.every((row) => row.value !== "")).toBe(true);
  });

  it("reports plays and the last play once the item has been watched", () => {
    const rows = buildDetailRows({ ...PHOTO, UserData: { PlayCount: 1, LastPlayedDate: "2026-08-06T18:22:11.059176Z" } }, { dimensionsShownElsewhere: false });

    expect(valueFor(rows, "Plays")).toBe("1 play");
    expect(valueFor(rows, "Last played")).toBe("6 Aug 2026");
  });

  it("gives a tagged song its disc and track alongside the album", () => {
    const rows = buildDetailRows(SONG, { dimensionsShownElsewhere: true });

    expect(valueFor(rows, "Album")).toBe("Wish You Were Here");
    expect(valueFor(rows, "Artist")).toBe("Pink Floyd");
    expect(valueFor(rows, "Disc")).toBe("2");
    expect(valueFor(rows, "Track")).toBe("5");
  });

  it("leaves the disc row off a song the file numbers no disc for", () => {
    const rows = buildDetailRows({ ...SONG, ParentIndexNumber: undefined }, { dimensionsShownElsewhere: true });

    expect(valueFor(rows, "Disc")).toBeUndefined();
    expect(valueFor(rows, "Track")).toBe("5");
  });

  // The row filter drops "", so a real track number of 0 must not be dropped with it.
  it("keeps a track number of 0", () => {
    const rows = buildDetailRows({ ...SONG, IndexNumber: 0, ParentIndexNumber: 0 }, { dimensionsShownElsewhere: true });

    expect(valueFor(rows, "Disc")).toBe("0");
    expect(valueFor(rows, "Track")).toBe("0");
  });

  // Same two fields, entirely different meaning, formatIndexBadge is what knows.
  it("never turns an episode's season/episode pair into disc and track rows", () => {
    const rows = buildDetailRows({ ...SONG, Type: "Episode", Name: "The Pilot", Path: "/tv/Show/Show.S02E05.mkv" }, { dimensionsShownElsewhere: true });

    expect(valueFor(rows, "Disc")).toBeUndefined();
    expect(valueFor(rows, "Track")).toBeUndefined();
  });
});

describe("formatIndexLine", () => {
  it("labels a tagged song's disc and track", () => {
    expect(formatIndexLine(SONG)).toBe("Disc 2 · Track 5");
  });

  it("names the track alone when the file carries no disc tag", () => {
    expect(formatIndexLine({ ...SONG, ParentIndexNumber: undefined })).toBe("Track 5");
  });

  it("keeps a track number of 0", () => {
    expect(formatIndexLine({ ...SONG, IndexNumber: 0, ParentIndexNumber: undefined })).toBe("Track 0");
  });

  it("is the season/episode tag on an episode, unchanged", () => {
    expect(formatIndexLine({ Name: "The Pilot", Path: "", Type: "Episode", ParentIndexNumber: 1, IndexNumber: 5 })).toBe("S01E05");
  });

  it("is empty for anything carrying no index at all", () => {
    expect(formatIndexLine({ Name: "Some Movie (2020)", Path: "", Type: "Movie" })).toBe("");
  });
});

describe("formatExposure", () => {
  // Jellyfin stores EXIF ApertureValue and ShutterSpeedValue raw, and both are
  // APEX (Emby.Photos/PhotoProvider.cs): f = sqrt(2^APEX), seconds = 1/2^APEX.
  it("converts the APEX aperture to an f-number", () => {
    expect(formatExposure({ Aperture: 4 })).toBe("ƒ/4");
    expect(formatExposure({ Aperture: 3 })).toBe("ƒ/2.8");
  });

  it("converts the APEX shutter value to a fraction of a second", () => {
    expect(formatExposure({ ShutterSpeed: 7 })).toBe("1/128s");
  });

  it("prefers ExposureTime, which is already seconds", () => {
    expect(formatExposure({ ExposureTime: 1 / 125, ShutterSpeed: 7 })).toBe("1/125s");
    expect(formatExposure({ ExposureTime: 2 })).toBe("2s");
  });

  it("joins a full exposure in the order a photographer reads it", () => {
    expect(formatExposure({ FocalLength: 50, Aperture: 4, ExposureTime: 1 / 250, IsoSpeedRating: 400 })).toBe("50mm · ƒ/4 · 1/250s · ISO 400");
  });

  it("returns empty when the file carries no exposure data", () => {
    expect(formatExposure({})).toBe("");
  });
});

describe("formatCoordinates", () => {
  it("labels each hemisphere and appends altitude", () => {
    expect(formatCoordinates(37.7749, -122.4194, 18)).toBe("37.7749°N, 122.4194°W · 18 m");
    expect(formatCoordinates(-33.8688, 151.2093, undefined)).toBe("33.8688°S, 151.2093°E");
  });

  it("returns empty without both halves of a position", () => {
    expect(formatCoordinates(37.7749, undefined, 18)).toBe("");
  });
});

describe("formatPixelSize", () => {
  it("pairs the dimensions with megapixels", () => {
    // The dimensions the demo library's photos actually carry.
    expect(formatPixelSize(1320, 2868)).toBe("1320×2868 · 3.8 MP");
  });

  it("omits megapixels for an image too small to round to a tenth", () => {
    expect(formatPixelSize(200, 200)).toBe("200×200");
  });

  it("returns empty when either dimension is missing", () => {
    expect(formatPixelSize(undefined, 2868)).toBe("");
    expect(formatPixelSize(1320, 0)).toBe("");
  });
});

describe("formatMediaDate", () => {
  it("reads the date off a Jellyfin timestamp", () => {
    expect(formatMediaDate("2026-08-19T04:28:43.9446036Z")).toBe("19 Aug 2026");
  });

  it("drops the leading zero from the day", () => {
    expect(formatMediaDate("2026-01-05T00:00:00.0000000Z")).toBe("5 Jan 2026");
  });

  it("returns empty for absent or unparseable input", () => {
    expect(formatMediaDate(undefined)).toBe("");
    expect(formatMediaDate("not a date")).toBe("");
    expect(formatMediaDate("2026-13-01T00:00:00Z")).toBe("");
  });
});

describe("formatFileSize", () => {
  it("formats gigabytes with two decimals", () => {
    expect(formatFileSize(1847765580)).toBe("1.72 GB");
  });

  it("formats sub-GB sizes as whole megabytes", () => {
    expect(formatFileSize(830 * 1024 ** 2)).toBe("830 MB");
  });

  it("returns empty for absent or zero", () => {
    expect(formatFileSize(undefined)).toBe("");
    expect(formatFileSize(0)).toBe("");
  });
});

describe("formatBitrate", () => {
  it("formats Mbps with one decimal", () => {
    expect(formatBitrate(1632744)).toBe("1.6 Mbps");
  });

  it("formats sub-Mbps as whole kbps", () => {
    expect(formatBitrate(627980)).toBe("628 kbps");
  });

  it("returns empty for absent", () => {
    expect(formatBitrate(undefined)).toBe("");
  });
});

describe("joinMeta", () => {
  it("drops falsy parts and joins with the dot separator", () => {
    expect(joinMeta(["1989", "", undefined, false, "PG-13"])).toBe("1989 · PG-13");
  });
});

describe("streamDetailLine", () => {
  it("builds the video line with HDR and bit depth, omitting SDR", () => {
    const hdr: JellyfinMediaStream = {
      Codec: "hevc",
      Type: "Video",
      Profile: "Main 10",
      Width: 3840,
      Height: 1600,
      RealFrameRate: 23.976025,
      VideoRangeType: "HDR10",
      BitDepth: 10,
    };
    expect(streamDetailLine(hdr)).toBe("HEVC · Main 10 · 3840×1600 · 23.976 fps · HDR10 · 10-bit");
    expect(streamDetailLine({ ...hdr, VideoRangeType: "SDR", BitDepth: 8 })).toBe("HEVC · Main 10 · 3840×1600 · 23.976 fps · 8-bit");
  });

  it("builds the audio line from layout, sample rate and language", () => {
    const flac: JellyfinMediaStream = {
      Codec: "flac",
      Type: "Audio",
      ChannelLayout: "5.1",
      SampleRate: 48000,
      BitDepth: 24,
      BitRate: 627980,
      Language: "eng",
    };
    expect(streamDetailLine(flac)).toBe("FLAC · 5.1 · 48 kHz · 24-bit · 628 kbps · eng");
  });

  it("falls back to a channel count when the layout is absent", () => {
    expect(streamDetailLine({ Codec: "aac", Type: "Audio", Channels: 2 })).toBe("AAC · 2ch");
  });

  it("marks forced and external subtitle tracks", () => {
    expect(streamDetailLine({ Codec: "PGSSUB", Type: "Subtitle", Language: "eng", IsForced: true })).toBe("PGSSUB · eng · Forced");
    expect(streamDetailLine({ Codec: "subrip", Type: "Subtitle", IsExternal: true })).toBe("SUBRIP · External");
  });
});

const OVERVIEW_CAP = 4001; // 4000-char slice plus the ellipsis marking the cut

describe("overviewParagraphs", () => {
  it("returns nothing for absent or empty text", () => {
    expect(overviewParagraphs(undefined)).toEqual([]);
    expect(overviewParagraphs(null)).toEqual([]);
    expect(overviewParagraphs("")).toEqual([]);
  });

  it("breaks on a newline that follows a finished sentence", () => {
    expect(overviewParagraphs("A boy leaves home.\nHe never returns.")).toEqual(["A boy leaves home.", "He never returns."]);
    expect(overviewParagraphs('He asked "why?"\nNobody answered.')).toEqual(['He asked "why?"', "Nobody answered."]);
  });

  it("closes up a newline that lands mid-sentence, which is a scraper's hard wrap", () => {
    expect(overviewParagraphs("A boy leaves home\nand never returns.")).toEqual(["A boy leaves home and never returns."]);
    expect(overviewParagraphs("Wrapped at eighty columns,\nas scrapers do.")).toEqual(["Wrapped at eighty columns, as scrapers do."]);
  });

  it("breaks on a blank line even mid-sentence", () => {
    expect(overviewParagraphs("cut here\n\nand here")).toEqual(["cut here", "and here"]);
  });

  it("keeps a blank line as the author's paragraph break", () => {
    expect(overviewParagraphs("First part.\n\nSecond part.")).toEqual(["First part.", "Second part."]);
  });

  it("treats CRLF and block tags as breaks", () => {
    expect(overviewParagraphs("One.\r\n\r\nTwo.")).toEqual(["One.", "Two."]);
    expect(overviewParagraphs("One.<br><br>Two.")).toEqual(["One.", "Two."]);
    expect(overviewParagraphs("<p>One.</p><p>Two.</p>")).toEqual(["One.", "Two."]);
  });

  it("strips inline markup and decodes entities", () => {
    expect(overviewParagraphs("Tom &amp; Jerry in <b>caf&eacute;</b> &#39;99&hellip;")).toEqual(["Tom & Jerry in café '99…"]);
  });

  it("never lets a decoded entity come back as markup", () => {
    expect(overviewParagraphs("safe &lt;script&gt;alert(1)&lt;/script&gt; text")).toEqual(["safe alert(1) text"]);
  });

  it("collapses runs of whitespace and nbsp", () => {
    expect(overviewParagraphs("Too   much&nbsp;&nbsp;space.  ")).toEqual(["Too much space."]);
  });

  it("chunks an unbroken wall at sentence ends", () => {
    const sentence = "The elder acts as a tour guide and protector for his colleague. ";
    const blocks = overviewParagraphs(sentence.repeat(14));
    expect(blocks.length).toBeGreaterThan(1);
    blocks.forEach((block) => expect(block).toMatch(/\.$/));
    expect(blocks.join(" ")).toBe(sentence.repeat(14).trim());
  });

  it("leaves a block the author already paragraphed alone, however long", () => {
    const long = "The elder acts as a tour guide and protector for his colleague. ".repeat(14).trim();
    expect(overviewParagraphs(`A short opener.\n${long}`)).toEqual(["A short opener.", long]);
  });

  it("does not chunk a wall that is under the budget", () => {
    const short = "One sentence here. And a second one. And a third to close.";
    expect(overviewParagraphs(short)).toEqual([short]);
  });

  it("leaves a short overview as one paragraph", () => {
    expect(overviewParagraphs("Short and sweet.")).toEqual(["Short and sweet."]);
  });

  // The cap cuts UTF-16 units, so it can land mid-tag, mid-entity or between surrogates.
  // Cleanup only removes what is terminated, so the fragment would render literally.
  // "word " x 799 is 3995 chars, so the 4000th unit lands three characters into each fragment.
  it("leaves no markup fragment when the cap lands inside a tag", () => {
    const blocks = overviewParagraphs("word ".repeat(799) + "ab<span>rest");
    expect(blocks.join(" ")).not.toContain("<");
  });

  it("leaves no entity fragment when the cap lands inside one", () => {
    const blocks = overviewParagraphs("word ".repeat(799) + "ab&amp;rest");
    expect(blocks.join(" ")).not.toContain("&");
  });

  it("leaves no lone surrogate when the cap lands inside a pair", () => {
    // "word " x 799 is 3995 chars, so the 4000th unit is the emoji's high surrogate.
    const blocks = overviewParagraphs("word ".repeat(799) + "abcd\u{1F600}" + "x".repeat(200));
    const joined = blocks.join(" ");
    expect(joined).toBe(joined.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, ""));
  });

  it("caps a pathological overview and marks the cut", () => {
    const blocks = overviewParagraphs("word ".repeat(3000));
    expect(blocks.join(" ").length).toBeLessThanOrEqual(OVERVIEW_CAP);
    expect(blocks[blocks.length - 1].endsWith("…")).toBe(true);
  });
});
