import { JellyfinItem, JellyfinMediaStream } from "@/types/jellyfin";
import { buildDetailRows, formatBitrate, formatCoordinates, formatExposure, formatFileSize, formatMediaDate, formatPixelSize, joinMeta, streamDetailLine } from "../mediaInfo";

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
