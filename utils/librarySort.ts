import type { StringKey } from "@/services/i18n/strings";
import type { JellyfinItem, LibraryFilters, LibrarySortBy } from "@/types/jellyfin";

/** The i18n key of each sort's chip. */
export const SORT_LABEL_KEYS: Record<LibrarySortBy, StringKey> = {
  SortName: "sort.name",
  DateCreated: "sort.dateAdded",
  DateLastContentAdded: "sort.episodeAdded",
  PremiereDate: "sort.releaseDate",
  ProductionYear: "sort.year",
  CommunityRating: "sort.communityRating",
  CriticRating: "sort.criticRating",
  OfficialRating: "sort.parentalRating",
  Runtime: "sort.runtime",
  DatePlayed: "sort.datePlayed",
  SeriesDatePlayed: "sort.datePlayed",
  PlayCount: "sort.playCount",
  Album: "sort.album",
  AlbumArtist: "sort.albumArtist",
  Artist: "sort.artist",
};

const DEFAULT_CHOICES: readonly LibrarySortBy[] = [
  "SortName",
  "DateCreated",
  "PremiereDate",
  "ProductionYear",
  "CommunityRating",
  "CriticRating",
  "OfficialRating",
  "Runtime",
  "DatePlayed",
  "PlayCount",
];
const SHOW_CHOICES: readonly LibrarySortBy[] = ["SortName", "DateCreated", "DateLastContentAdded", "PremiereDate", "ProductionYear", "CommunityRating", "OfficialRating", "SeriesDatePlayed"];
const MUSIC_CHOICES: readonly LibrarySortBy[] = [
  "SortName",
  "Album",
  "AlbumArtist",
  "Artist",
  "DateCreated",
  "PremiereDate",
  "ProductionYear",
  "CommunityRating",
  "Runtime",
  "DatePlayed",
  "PlayCount",
];

/** The sorts a library of this CollectionType offers; movies and anything unnamed get the default list. */
export function sortChoices(collectionType: string | undefined): readonly LibrarySortBy[] {
  switch (collectionType) {
    case "tvshows":
      return SHOW_CHOICES;
    case "music":
      return MUSIC_CHOICES;
    default:
      return DEFAULT_CHOICES;
  }
}

/** A library whose list lacks the saved sort shows it as an extra chip, so the saved choice is never hidden. */
export function sortChoicesWith(collectionType: string | undefined, current: LibrarySortBy): readonly LibrarySortBy[] {
  const choices = sortChoices(collectionType);
  return choices.includes(current) ? choices : [...choices, current];
}

type Sortable = Pick<
  JellyfinItem,
  | "Name"
  | "DateCreated"
  | "DateLastMediaAdded"
  | "PremiereDate"
  | "ProductionYear"
  | "CommunityRating"
  | "CriticRating"
  | "OfficialRating"
  | "RunTimeTicks"
  | "Album"
  | "AlbumArtist"
  | "Artists"
  | "UserData"
>;

function time(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function keyOf(item: Sortable, sortBy: LibrarySortBy): number | string | undefined {
  switch (sortBy) {
    case "SortName":
      return item.Name;
    case "DateCreated":
      return time(item.DateCreated);
    case "DateLastContentAdded":
      return time(item.DateLastMediaAdded ?? item.DateCreated);
    case "PremiereDate":
      return time(item.PremiereDate);
    case "ProductionYear":
      return item.ProductionYear;
    case "CommunityRating":
      return item.CommunityRating;
    case "CriticRating":
      return item.CriticRating;
    case "OfficialRating":
      return item.OfficialRating;
    case "Runtime":
      return item.RunTimeTicks;
    case "DatePlayed":
    case "SeriesDatePlayed":
      return time(item.UserData?.LastPlayedDate);
    case "PlayCount":
      return item.UserData?.PlayCount;
    case "Album":
      return item.Album;
    case "AlbumArtist":
      return item.AlbumArtist;
    case "Artist":
      return item.Artists?.[0];
  }
}

function compareKeys(a: number | string | undefined, b: number | string | undefined): number {
  if (a === b) return 0;
  // An item without the key sorts last whichever way the list runs.
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * The comparator for lists the app orders itself (a library root with a status filter, merged recording
 * folders). Items missing the key go last; equal keys fall back to the name, ascending.
 */
export function compareItems(filters: Pick<LibraryFilters, "sortBy" | "sortOrder">): (a: Sortable, b: Sortable) => number {
  const direction = filters.sortOrder === "Descending" ? -1 : 1;
  return (a, b) => {
    const ka = keyOf(a, filters.sortBy);
    const kb = keyOf(b, filters.sortBy);
    if (ka === undefined && kb !== undefined) return 1;
    if (kb === undefined && ka !== undefined) return -1;
    const byKey = compareKeys(ka, kb) * direction;
    return byKey !== 0 || filters.sortBy === "SortName" ? byKey : compareKeys(a.Name, b.Name);
  };
}

export function sortItems<T extends Sortable>(items: readonly T[], filters: Pick<LibraryFilters, "sortBy" | "sortOrder">): T[] {
  return [...items].sort(compareItems(filters));
}
