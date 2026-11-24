/**
 * The folder screen and the photo viewer: a press or a long press on a photo names the library
 * the folder is listed under, and a shuffled folder hands the viewer the list it is showing.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { JellyfinItem } from "@/types/jellyfin";

const mockPush = jest.fn();
const mockCrumbs = JSON.stringify([
  { id: "lib1", name: "Photos", type: "folder" },
  { id: "album1", name: "Nebulae", type: "folder" },
]);
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ folderId: "album1", name: "Nebulae", crumbs: mockCrumbs }),
  useRouter: () => ({ push: mockPush }),
}));

let mockGrid: { onItemPress: (item: JellyfinItem) => void; onItemLongPress: (item: JellyfinItem) => void } | null = null;
jest.mock("@/components/library-grid", () => ({
  LibraryGrid: (props: { onItemPress: (item: JellyfinItem) => void; onItemLongPress: (item: JellyfinItem) => void }) => {
    mockGrid = props;
    return null;
  },
}));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn() }) }));
jest.mock("@/contexts/PlayQueueContext", () => ({ usePlayQueue: () => ({ buildQueue: jest.fn(), buildQueueFromItems: jest.fn() }) }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#fff" }) }));
jest.mock("@/hooks/useFolderBackdrop", () => ({ useFolderBackdrop: () => null }));

const mockFolder = { Id: "sub1", Name: "Sub", Type: "Folder" } as JellyfinItem;
const mockSecond = { Id: "p2", Name: "Two", Type: "Photo" } as JellyfinItem;
const mockFirst = { Id: "p1", Name: "One", Type: "Photo" } as JellyfinItem;
const mockItems = [mockFolder, mockSecond, mockFirst];
jest.mock("@/hooks/useFolderContents", () => ({
  useFolderContents: () => ({ items: mockItems, isLoading: false, isLoadingMore: false, hasMoreResults: false, error: null, loadMore: jest.fn(), refresh: jest.fn() }),
}));

let mockShuffle = false;
const mockGetFilters = jest.fn((_id: string) => ({
  genres: [],
  artistIds: [],
  years: [],
  favorite: false,
  played: false,
  unplayed: false,
  shuffle: mockShuffle,
  sortBy: "SortName",
  sortOrder: "Ascending",
}));
jest.mock("@/contexts/LibraryFiltersContext", () => ({ useLibraryFilters: () => ({ getFilters: mockGetFilters }) }));
jest.mock("@/services/jellyfinApi", () => ({
  fetchFilteredVideos: jest.fn(),
  isAudioItem: () => false,
  isBook: () => false,
  isFolder: (item: JellyfinItem) => item.Type === "Folder",
  isPhoto: (item: JellyfinItem) => item.Type === "Photo",
}));

import FolderScreen from "@/app/[folderId]";
import { clearFolderContentsCache, getShuffledListing } from "@/services/folderContentsCache";

async function mountScreen() {
  await act(async () => {
    TestRenderer.create(<FolderScreen />);
  });
  return mockGrid!;
}

describe("folder screen: opening a photo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearFolderContentsCache();
    mockGrid = null;
    mockShuffle = false;
  });

  it("reads the saved view under the library, not the folder", async () => {
    await mountScreen();

    expect(mockGetFilters).toHaveBeenCalledWith("lib1");
    expect(mockGetFilters).not.toHaveBeenCalledWith("album1");
  });

  it("a press names the library and, when shuffled, hands over the list on screen", async () => {
    mockShuffle = true;
    const grid = await mountScreen();

    act(() => grid.onItemPress(mockFirst));

    expect(mockPush).toHaveBeenCalledWith({ pathname: "/photo-viewer", params: { folderId: "album1", photoId: "p1", libraryId: "lib1" } });
    expect(getShuffledListing("album1", "p1")).toEqual(mockItems);
  });

  it("a long press names the library to the info panel and, when shuffled, hands over the list on screen", async () => {
    mockShuffle = true;
    const grid = await mountScreen();

    act(() => grid.onItemLongPress(mockSecond));

    expect(mockPush).toHaveBeenCalledWith({ pathname: "/video-info", params: { videoId: "p2", name: "Two", inFolderId: "album1", inLibraryId: "lib1" } });
    expect(getShuffledListing("album1", "p2")).toEqual(mockItems);
  });

  it("with shuffle off nothing is handed over", async () => {
    const grid = await mountScreen();

    act(() => grid.onItemPress(mockFirst));
    act(() => grid.onItemLongPress(mockSecond));

    expect(getShuffledListing("album1", "p1")).toBeUndefined();
  });
});
