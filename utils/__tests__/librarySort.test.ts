/** The sort list per library kind, and the comparator for lists the app orders itself: every key, both directions, missing keys last, name as the tie-break. */
import { compareItems, sortChoices, sortChoicesWith, sortItems, SORT_LABEL_KEYS } from "@/utils/librarySort";
import { EMPTY_FILTERS, type LibrarySortBy } from "@/types/jellyfin";
import { en } from "@/services/i18n/strings";

const sort = (sortBy: LibrarySortBy, sortOrder: "Ascending" | "Descending" = "Ascending") => ({ ...EMPTY_FILTERS, sortBy, sortOrder });

describe("sortChoices", () => {
  it("offers the movie list by default, with shows and music lists of their own", () => {
    expect(sortChoices(undefined)).toEqual(["SortName", "DateCreated", "PremiereDate", "ProductionYear", "CommunityRating", "CriticRating", "OfficialRating", "Runtime", "DatePlayed", "PlayCount"]);
    expect(sortChoices("movies")).toEqual(sortChoices(undefined));
    expect(sortChoices("homevideos")).toEqual(sortChoices(undefined));
    expect(sortChoices("tvshows")).toEqual(["SortName", "DateCreated", "DateLastContentAdded", "PremiereDate", "ProductionYear", "CommunityRating", "OfficialRating", "SeriesDatePlayed"]);
    expect(sortChoices("music")).toEqual(["SortName", "Album", "AlbumArtist", "Artist", "DateCreated", "PremiereDate", "ProductionYear", "CommunityRating", "Runtime", "DatePlayed", "PlayCount"]);
  });

  it("always starts with the name and keeps a saved sort the list lacks visible", () => {
    for (const type of [undefined, "tvshows", "music"]) expect(sortChoices(type)[0]).toBe("SortName");
    expect(sortChoicesWith("tvshows", "Album")).toEqual([...sortChoices("tvshows"), "Album"]);
    expect(sortChoicesWith("tvshows", "SortName")).toEqual(sortChoices("tvshows"));
  });

  it("has a string for every sort", () => {
    for (const key of Object.values(SORT_LABEL_KEYS)) expect(typeof en[key]).toBe("string");
  });
});

describe("compareItems", () => {
  const a = {
    Name: "Alpha",
    DateCreated: "2026-01-02T00:00:00Z",
    DateLastMediaAdded: "2026-03-01T00:00:00Z",
    PremiereDate: "1999-05-01",
    ProductionYear: 1999,
    CommunityRating: 7.5,
    CriticRating: 60,
    OfficialRating: "PG",
    RunTimeTicks: 100,
    Album: "Blue",
    AlbumArtist: "Zed",
    Artists: ["Zed"],
    UserData: { LastPlayedDate: "2026-02-01T00:00:00Z", PlayCount: 3 },
  };
  const b = {
    Name: "Bravo",
    DateCreated: "2026-01-01T00:00:00Z",
    DateLastMediaAdded: "2026-04-01T00:00:00Z",
    PremiereDate: "2005-05-01",
    ProductionYear: 2005,
    CommunityRating: 8.1,
    CriticRating: 90,
    OfficialRating: "R",
    RunTimeTicks: 50,
    Album: "Amber",
    AlbumArtist: "Ann",
    Artists: ["Ann"],
    UserData: { LastPlayedDate: "2026-02-02T00:00:00Z", PlayCount: 1 },
  };
  const names = (items: { Name: string }[]) => items.map((item) => item.Name);

  it.each<[LibrarySortBy, string[]]>([
    ["SortName", ["Alpha", "Bravo"]],
    ["DateCreated", ["Bravo", "Alpha"]],
    ["DateLastContentAdded", ["Alpha", "Bravo"]],
    ["PremiereDate", ["Alpha", "Bravo"]],
    ["ProductionYear", ["Alpha", "Bravo"]],
    ["CommunityRating", ["Alpha", "Bravo"]],
    ["CriticRating", ["Alpha", "Bravo"]],
    ["OfficialRating", ["Alpha", "Bravo"]],
    ["Runtime", ["Bravo", "Alpha"]],
    ["DatePlayed", ["Alpha", "Bravo"]],
    ["SeriesDatePlayed", ["Alpha", "Bravo"]],
    ["PlayCount", ["Bravo", "Alpha"]],
    ["Album", ["Bravo", "Alpha"]],
    ["AlbumArtist", ["Bravo", "Alpha"]],
    ["Artist", ["Bravo", "Alpha"]],
  ])("orders by %s ascending and flips for descending", (sortBy, ascending) => {
    expect(names(sortItems([b, a], sort(sortBy)))).toEqual(ascending);
    expect(names(sortItems([a, b], sort(sortBy, "Descending")))).toEqual([...ascending].reverse());
  });

  it("puts an item without the key last either way and breaks ties by name", () => {
    const blank = { Name: "Zulu", UserData: {} };
    const twin = { ...b, Name: "Aardvark", ProductionYear: 2005 };
    expect(names(sortItems([blank, b, a], sort("ProductionYear")))).toEqual(["Alpha", "Bravo", "Zulu"]);
    expect(names(sortItems([blank, b, a], sort("ProductionYear", "Descending")))).toEqual(["Bravo", "Alpha", "Zulu"]);
    expect(names(sortItems([b, twin], sort("ProductionYear", "Descending")))).toEqual(["Aardvark", "Bravo"]);
    expect(compareItems(sort("SortName"))({ Name: "File 2" }, { Name: "File 10" })).toBeLessThan(0);
  });

  it("falls back to the date added for a library without a last-content date", () => {
    const show = { Name: "Show", DateCreated: "2026-05-01T00:00:00Z" };
    expect(names(sortItems([show, b], sort("DateLastContentAdded", "Descending")))).toEqual(["Show", "Bravo"]);
  });
});
