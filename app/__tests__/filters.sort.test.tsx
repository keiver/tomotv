/** The Sort section of Sort & Filter: one chip per sort the library offers plus Shuffle, the order pair while not shuffled, and what a press saves. */
import FiltersScreen from "@/app/filters";
import { FilterChip } from "@/components/filter-chip";
import { EMPTY_FILTERS, type LibraryFilters } from "@/types/jellyfin";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/filter-chip", () => ({ FilterChip: () => null }));
jest.mock("@/components/filters-ghost-mark", () => ({ FiltersGhostMark: () => null }));
jest.mock("@/components/filters-scope", () => ({ FiltersScope: () => null }));
jest.mock("@/components/glass-button", () => ({ GlassButton: () => null }));
jest.mock("@/components/loading-row", () => ({ LoadingRow: () => null }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#fff" }) }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/utils/logger", () => ({ logger: { warn: jest.fn() } }));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ folderId: "lib-1", name: "Movies" }),
  useRouter: () => ({ back: jest.fn() }),
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
let mockCollectionType: string | undefined;
jest.mock("@/services/jellyfinApi", () => ({
  fetchLibraryGenres: jest.fn(async () => []),
  fetchLibraryArtists: jest.fn(async () => []),
  fetchLibraryYears: jest.fn(async () => []),
  fetchUserViews: jest.fn(async () => ({ items: [{ Id: "lib-1", Name: "Movies", CollectionType: mockCollectionType }] })),
}));
let mockFilters: LibraryFilters = EMPTY_FILTERS;
const mockSet = jest.fn();
jest.mock("@/contexts/LibraryFiltersContext", () => ({
  useLibraryFilters: () => ({ getFilters: () => mockFilters, setFilters: mockSet, clearFilters: jest.fn() }),
}));

type Chip = { label: string; selected: boolean; onToggle: () => void };

async function chips(): Promise<Chip[]> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<FiltersScreen />);
  });
  const found = tree.root.findAllByType(FilterChip).map((chip) => chip.props as Chip);
  await act(async () => tree.unmount());
  return found;
}

const labels = (list: Chip[]) => list.map((chip) => chip.label);

describe("Sort & Filter sort section", () => {
  beforeEach(() => {
    mockSet.mockClear();
    mockFilters = EMPTY_FILTERS;
    mockCollectionType = "movies";
  });

  it("offers the movie sorts, Name selected, Ascending selected, and Shuffle off", async () => {
    const list = await chips();
    expect(labels(list)).toEqual([
      "filters.favorite",
      "filters.played",
      "filters.unplayed",
      "sort.name",
      "sort.dateAdded",
      "sort.releaseDate",
      "sort.year",
      "sort.communityRating",
      "sort.criticRating",
      "sort.parentalRating",
      "sort.runtime",
      "sort.datePlayed",
      "sort.playCount",
      "filters.shuffle",
      "sort.ascending",
      "sort.descending",
    ]);
    expect(list.filter((chip) => chip.selected).map((chip) => chip.label)).toEqual(["sort.name", "sort.ascending"]);
  });

  it("offers the show sorts for a shows library", async () => {
    mockCollectionType = "tvshows";
    expect(labels(await chips())).toContain("sort.episodeAdded");
    expect(labels(await chips())).not.toContain("sort.criticRating");
  });

  it("saves a picked sort with shuffle off, and an order on its own", async () => {
    mockFilters = { ...EMPTY_FILTERS, shuffle: true };
    let list = await chips();
    expect(labels(list)).not.toContain("sort.ascending");
    expect(list.find((chip) => chip.label === "filters.shuffle")?.selected).toBe(true);
    expect(list.find((chip) => chip.label === "sort.name")?.selected).toBe(false);
    list.find((chip) => chip.label === "sort.dateAdded")!.onToggle();
    expect(mockSet).toHaveBeenLastCalledWith("lib-1", { ...EMPTY_FILTERS, sortBy: "DateCreated", shuffle: false });

    mockFilters = { ...EMPTY_FILTERS, sortBy: "DateCreated" };
    list = await chips();
    list.find((chip) => chip.label === "sort.descending")!.onToggle();
    expect(mockSet).toHaveBeenLastCalledWith("lib-1", { ...EMPTY_FILTERS, sortBy: "DateCreated", sortOrder: "Descending" });
  });

  it("keeps a saved sort the library's list lacks as a chip", async () => {
    mockCollectionType = "tvshows";
    mockFilters = { ...EMPTY_FILTERS, sortBy: "Album" };
    const list = await chips();
    expect(list.find((chip) => chip.label === "sort.album")?.selected).toBe(true);
  });
});
