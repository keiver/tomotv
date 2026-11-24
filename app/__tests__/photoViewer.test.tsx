/**
 * The photo viewer's remote contract: it renders the pressed photo's counter and steps
 * on left/right TV events. Pins the behaviour the shared page viewer inherits.
 */
import React from "react";
import { ActivityIndicator, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const chain: any = new Proxy(() => chain, { get: () => () => chain, apply: () => chain });
  const gesture = () => chain;
  return {
    Gesture: { Pinch: gesture, Tap: gesture, Pan: gesture, Simultaneous: gesture, Race: gesture, Exclusive: gesture },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    GestureHandlerRootView: View,
  };
});
jest.mock("expo-image", () => ({ Image: Object.assign(() => null, { prefetch: jest.fn() }) }));
jest.mock("@/components/glass-action-cluster", () => ({ GlassActionCluster: () => null }));
jest.mock("@/components/glass-surface", () => ({ GlassSurface: ({ children }: { children?: React.ReactNode }) => children ?? null }));
jest.mock("@/services/macKeyCommands", () => ({ claimMacContextKeys: () => () => {}, subscribeMacKeyCommand: () => () => {} }));
jest.mock("@/services/folderContentsCache", () => ({ ...jest.requireActual("@/services/folderContentsCache"), getFolderCache: () => null }));
/** The saved view of each library, by id; an id with none saved reads the empty view. */
let mockViews: Record<string, object> = {};
jest.mock("@/contexts/LibraryFiltersContext", () => ({
  useLibraryFilters: () => ({
    getFilters: (id: string) => ({
      genres: [],
      artistIds: [],
      years: [],
      favorite: false,
      played: false,
      unplayed: false,
      shuffle: false,
      sortBy: "SortName",
      sortOrder: "Ascending",
      ...mockViews[id],
    }),
  }),
}));
jest.mock("@/utils/shuffle", () => ({ shuffled: (items: unknown[]) => [...items].reverse() }));

const mockPhotos = [
  { Id: "p1", Name: "One", Type: "Photo", Path: "/photos/one.png" },
  { Id: "p2", Name: "Two", Type: "Photo", Path: "/photos/two.gif" },
];
jest.mock("@/services/jellyfinApi", () => ({
  fetchFolderPhotos: jest.fn(async () => mockPhotos),
  fetchFilteredVideos: jest.fn(async () => mockPhotos),
  fetchItemDetails: jest.fn(async () => mockPhotos[0]),
  fetchRecursivePhotos: jest.fn(async () => mockPhotos),
  fetchShuffledPage: jest.fn(async () => ({ items: [], total: 0, more: false })),
  getPhotoUrl: (id: string) => `http://server/${id}`,
  WEBP_ACCEPT: { Accept: "image/webp" },
  SHUFFLE_PAGE_SIZE: 2,
  getPhotoPreviewUrl: (id: string) => `http://server/${id}?preview`,
  isPhoto: (item: { Type: string }) => item.Type === "Photo",
}));

let mockTvHandler: ((event: { eventType: string }) => void) | null = null;
jest.mock("react-native/Libraries/Components/TV/useTVEventHandler", () => ({
  __esModule: true,
  default: (handler: (event: { eventType: string }) => void) => {
    mockTvHandler = handler;
  },
}));
const mockRouter = { back: jest.fn(), push: jest.fn() };
let mockParams: Record<string, string> = { folderId: "f1", photoId: "p1" };
jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockParams, useRouter: () => mockRouter }));

import PhotoViewerScreen from "@/app/photo-viewer";
import { Image } from "expo-image";
import { clearFolderContentsCache, setShuffledListing } from "@/services/folderContentsCache";
import { fetchFilteredVideos, fetchFolderPhotos, fetchItemDetails, fetchRecursivePhotos, fetchShuffledPage } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import * as Reanimated from "react-native-reanimated";

const SHUFFLE = { shuffle: true };
const photo = (id: string, name: string) => ({ Id: id, Name: name, Type: "Photo", Path: `/photos/${id}.png` }) as unknown as JellyfinItem;
const [one, two] = mockPhotos as unknown as JellyfinItem[];
const three = photo("p3", "Three");
const four = photo("p4", "Four");

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { folderId: "f1", photoId: "p1" };
  mockViews = {};
  clearFolderContentsCache();
});

function counter(tree: TestRenderer.ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .flat()
    .join("|");
}

test("steps photos on TV left and right presses", async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(counter(tree)).toMatch(/1\| \/ \|2/);

  await act(async () => {
    mockTvHandler?.({ eventType: "right" });
  });
  expect(counter(tree)).toMatch(/2\| \/ \|2/);

  await act(async () => {
    mockTvHandler?.({ eventType: "left" });
  });
  expect(counter(tree)).toMatch(/1\| \/ \|2/);

  await act(async () => {
    mockTvHandler?.({ eventType: "left" });
  });
  expect(counter(tree)).toMatch(/1\| \/ \|2/);
  tree.unmount();
});

test("a spinner holds the screen while the photo set loads", async () => {
  (fetchFolderPhotos as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  tree.unmount();
});

test("the preview draws while the photo loads, and the spinner under it goes once it has", async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  const page = tree.root.findByType(Image);
  expect(page.props.source).toEqual({ uri: "http://server/p1", headers: { Accept: "image/webp" } });
  expect(page.props.placeholder).toEqual({ uri: "http://server/p1?preview", headers: { Accept: "image/webp" } });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);

  await act(async () => {
    page.props.onLoad();
  });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  tree.unmount();
});

test("a GIF asks without WebP, so it keeps the request it had", async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    mockTvHandler?.({ eventType: "right" });
  });
  const gif = tree.root.findAllByType(Image).find((node) => node.props.source.uri === "http://server/p2");
  expect(gif?.props.source.headers).toBeUndefined();
  tree.unmount();
});

test("a recursive open paints the pressed photo while the sweep still runs, then reseats it in the set", async () => {
  mockParams = { folderId: "f1", photoId: "p2", recursive: "true" };
  let resolveSet!: (items: unknown) => void;
  (fetchRecursivePhotos as jest.Mock).mockReturnValueOnce(new Promise((resolve) => (resolveSet = resolve)));
  (fetchItemDetails as jest.Mock).mockResolvedValueOnce(mockPhotos[1]);

  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(counter(tree)).toContain("Two");
  expect(tree.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);

  await act(async () => {
    resolveSet([mockPhotos[0], mockPhotos[1], { Id: "p3", Name: "Three", Type: "Photo", Path: "/photos/three.png" }]);
  });
  expect(counter(tree)).toContain("Two");
  expect(counter(tree)).toMatch(/2\| \/ \|3/);
  tree.unmount();
});

test("a set that lands first mounts at the pressed index, and the late single result is ignored", async () => {
  mockParams = { folderId: "f1", photoId: "p2", recursive: "true" };
  let resolveSingle!: (item: unknown) => void;
  (fetchItemDetails as jest.Mock).mockReturnValueOnce(new Promise((resolve) => (resolveSingle = resolve)));

  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(counter(tree)).toMatch(/2\| \/ \|2/);

  await act(async () => {
    resolveSingle(mockPhotos[1]);
  });
  expect(counter(tree)).toMatch(/2\| \/ \|2/);
  tree.unmount();
});

test("a set that fails before the pressed photo lands still shows the photo, not the error screen", async () => {
  mockParams = { folderId: "f1", photoId: "p2", recursive: "true" };
  let failSet!: (reason: Error) => void;
  let resolveSingle!: (item: unknown) => void;
  (fetchRecursivePhotos as jest.Mock).mockReturnValueOnce(new Promise((_resolve, reject) => (failSet = reject)));
  (fetchItemDetails as jest.Mock).mockReturnValueOnce(new Promise((resolve) => (resolveSingle = resolve)));

  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  await act(async () => {
    failSet(new Error("server down"));
  });
  expect(counter(tree)).toContain("Unable to Load Photos");

  await act(async () => {
    resolveSingle(mockPhotos[1]);
  });
  expect(counter(tree)).not.toContain("Unable to Load Photos");
  expect(counter(tree)).toContain("Two");
  tree.unmount();
});

test("a plain open with no cached folder paints the pressed photo first, then the sweep widens it", async () => {
  mockParams = { folderId: "f1", photoId: "p2" };
  let resolveSet!: (items: unknown) => void;
  (fetchFolderPhotos as jest.Mock).mockReturnValueOnce(new Promise((resolve) => (resolveSet = resolve)));
  (fetchItemDetails as jest.Mock).mockResolvedValueOnce(mockPhotos[1]);

  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(counter(tree)).toContain("Two");

  await act(async () => {
    resolveSet(mockPhotos);
  });
  expect(counter(tree)).toContain("Two");
  expect(counter(tree)).toMatch(/2\| \/ \|2/);
  tree.unmount();
});

test("a set without the pressed photo leaves it shown alone", async () => {
  mockParams = { folderId: "f1", photoId: "px", recursive: "true" };
  let resolveSet!: (items: unknown) => void;
  (fetchRecursivePhotos as jest.Mock).mockReturnValueOnce(new Promise((resolve) => (resolveSet = resolve)));
  (fetchItemDetails as jest.Mock).mockResolvedValueOnce({ Id: "px", Name: "Stray", Type: "Photo", Path: "/photos/stray.png" });

  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(counter(tree)).toContain("Stray");

  await act(async () => {
    resolveSet(mockPhotos);
  });
  expect(counter(tree)).toContain("Stray");
  expect(counter(tree)).not.toMatch(/\| \/ \|/);
  tree.unmount();
});

async function mountViewer() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
}

/** The shuffled folder's pages, in the order the service reads them. */
function servePages(...pages: JellyfinItem[][]) {
  (fetchShuffledPage as jest.Mock).mockImplementation(async (_folderId: string, _filters: unknown, slot: number) => ({
    items: pages[slot] ?? [],
    total: pages.flat().length,
    more: slot + 1 < pages.length,
  }));
}
const slotsAsked = () => (fetchShuffledPage as jest.Mock).mock.calls.map((call) => call[2]);

describe("a shuffled library", () => {
  test("the viewer opens on the list the folder screen holds, at the pressed photo, with no set request", async () => {
    mockViews = { lib1: SHUFFLE };
    mockParams = { folderId: "f1", photoId: "p1", libraryId: "lib1" };
    setShuffledListing("f1", [two, one, three]);
    servePages([two, one, three]);

    const tree = await mountViewer();

    expect(counter(tree)).toContain("One");
    expect(counter(tree)).toMatch(/2\| \/ \|3/);
    expect(fetchFilteredVideos).not.toHaveBeenCalled();
    expect(fetchFolderPhotos).not.toHaveBeenCalled();
    await act(async () => mockTvHandler?.({ eventType: "right" }));
    expect(counter(tree)).toContain("Three");
    tree.unmount();
  });

  test("near the end of the held list it reads the pages after the ones the folder screen read, and steps on into them", async () => {
    mockViews = { lib1: SHUFFLE };
    mockParams = { folderId: "f1", photoId: "p2", libraryId: "lib1" };
    setShuffledListing("f1", [two, one]);
    servePages([one, two], [three], [four]);

    const tree = await mountViewer();

    expect((fetchShuffledPage as jest.Mock).mock.calls[0].slice(0, 2)).toEqual(["f1", expect.objectContaining({ shuffle: true })]);
    expect(slotsAsked()).toEqual([1, 2]);
    expect(counter(tree)).toMatch(/1\| \/ \|4/);
    for (const name of ["One", "Three", "Four"]) {
      await act(async () => mockTvHandler?.({ eventType: "right" }));
      expect(counter(tree)).toContain(name);
    }
    tree.unmount();
  });

  test("the slideshow waits on the last photo held while more are loading, then goes on", async () => {
    mockViews = { lib1: SHUFFLE };
    mockParams = { folderId: "f1", photoId: "p2", libraryId: "lib1" };
    setShuffledListing("f1", [two, one]);
    let resolveMore!: (page: unknown) => void;
    (fetchShuffledPage as jest.Mock).mockReturnValueOnce(new Promise((resolve) => (resolveMore = resolve)));
    let countdown: ((finished?: boolean) => void) | undefined;
    const timing = jest.spyOn(Reanimated, "withTiming").mockImplementation(((value: unknown, config?: { duration?: number }, callback?: (finished?: boolean) => void) => {
      if (config?.duration === 5000) countdown = callback;
      return value;
    }) as unknown as typeof Reanimated.withTiming);

    const tree = await mountViewer();
    await act(async () => mockTvHandler?.({ eventType: "playPause" }));
    await act(async () => countdown?.(true));
    expect(counter(tree)).toContain("One");
    await act(async () => countdown?.(true));
    expect(counter(tree)).toContain("One");

    await act(async () => resolveMore({ items: [three], total: 3, more: false }));
    await act(async () => countdown?.(true));
    expect(counter(tree)).toContain("Three");
    await act(async () => countdown?.(true));
    expect(counter(tree)).toContain("Two");
    tree.unmount();
    timing.mockRestore();
  });

  test("after a load fails the slideshow asks again on its next turn and goes on", async () => {
    mockViews = { lib1: SHUFFLE };
    mockParams = { folderId: "f1", photoId: "p2", libraryId: "lib1" };
    setShuffledListing("f1", [two, one]);
    (fetchShuffledPage as jest.Mock).mockRejectedValueOnce(new Error("server down")).mockResolvedValueOnce({ items: [three], total: 3, more: false });
    let countdown: ((finished?: boolean) => void) | undefined;
    const timing = jest.spyOn(Reanimated, "withTiming").mockImplementation(((value: unknown, config?: { duration?: number }, callback?: (finished?: boolean) => void) => {
      if (config?.duration === 5000) countdown = callback;
      return value;
    }) as unknown as typeof Reanimated.withTiming);

    const tree = await mountViewer();
    await act(async () => mockTvHandler?.({ eventType: "playPause" }));
    expect(slotsAsked()).toEqual([1]);
    await act(async () => countdown?.(true));
    expect(counter(tree)).toContain("One");
    expect(slotsAsked()).toEqual([1, 1]);
    await act(async () => countdown?.(true));
    expect(counter(tree)).toContain("Three");
    tree.unmount();
    timing.mockRestore();
  });

  test("once the last page is read the slideshow wraps to the first photo and asks for nothing more", async () => {
    mockViews = { lib1: SHUFFLE };
    mockParams = { folderId: "f1", photoId: "p2", libraryId: "lib1" };
    setShuffledListing("f1", [two, one]);
    servePages([one, two]);
    let countdown: ((finished?: boolean) => void) | undefined;
    const timing = jest.spyOn(Reanimated, "withTiming").mockImplementation(((value: unknown, config?: { duration?: number }, callback?: (finished?: boolean) => void) => {
      if (config?.duration === 5000) countdown = callback;
      return value;
    }) as unknown as typeof Reanimated.withTiming);

    const tree = await mountViewer();
    await act(async () => mockTvHandler?.({ eventType: "playPause" }));
    await act(async () => countdown?.(true));
    expect(counter(tree)).toContain("One");
    await act(async () => countdown?.(true));
    expect(counter(tree)).toContain("Two");
    expect(slotsAsked()).toEqual([1]);
    tree.unmount();
    timing.mockRestore();
  });

  test("a photo opened with no list from a folder screen shows first, then the folder's pages follow it without repeating it", async () => {
    mockViews = { lib1: SHUFFLE };
    mockParams = { folderId: "f1", photoId: "p2", libraryId: "lib1" };
    (fetchItemDetails as jest.Mock).mockResolvedValueOnce(two);
    servePages([three, two, one]);

    const tree = await mountViewer();

    expect(counter(tree)).toContain("Two");
    expect(counter(tree)).toMatch(/1\| \/ \|3/);
    tree.unmount();
  });

  test("the saved view is read under the library the push names, not the folder", async () => {
    mockViews = { lib1: SHUFFLE };
    mockParams = { folderId: "album1", recursive: "true", slideshow: "true", libraryId: "lib1" };
    (fetchRecursivePhotos as jest.Mock).mockResolvedValueOnce([one, two, three]);

    const tree = await mountViewer();

    expect(counter(tree)).toContain("Three");
    tree.unmount();
  });

  test("a slideshow pushed with no library reads the folder's own view, which has no shuffle", async () => {
    mockViews = { lib1: SHUFFLE };
    mockParams = { folderId: "album1", recursive: "true", slideshow: "true" };
    (fetchRecursivePhotos as jest.Mock).mockResolvedValueOnce([one, two, three]);

    const tree = await mountViewer();

    expect(counter(tree)).toContain("One");
    tree.unmount();
  });

  test("with a status filter the held list comes first and the rest of the filtered set follows", async () => {
    mockViews = { lib1: { shuffle: true, favorite: true } };
    mockParams = { folderId: "f1", photoId: "p2", libraryId: "lib1" };
    setShuffledListing("f1", [two]);
    (fetchFilteredVideos as jest.Mock).mockResolvedValueOnce([one, two, three]);

    const tree = await mountViewer();

    expect(fetchShuffledPage).not.toHaveBeenCalled();
    expect(counter(tree)).toMatch(/1\| \/ \|3/);
    await act(async () => mockTvHandler?.({ eventType: "right" }));
    expect(counter(tree)).toContain("Three");
    tree.unmount();
  });

  test("with a status filter a held photo the filtered set leaves out is dropped", async () => {
    mockViews = { lib1: { shuffle: true, favorite: true } };
    mockParams = { folderId: "f1", photoId: "p2", libraryId: "lib1" };
    setShuffledListing("f1", [two, four]);
    (fetchFilteredVideos as jest.Mock).mockResolvedValueOnce([one, two, three]);

    const tree = await mountViewer();

    expect(counter(tree)).toMatch(/Two.*1\| \/ \|3/);
    for (const name of ["Three", "One"]) {
      await act(async () => mockTvHandler?.({ eventType: "right" }));
      expect(counter(tree)).toContain(name);
    }
    tree.unmount();
  });
});

describe("a library with a changed sort", () => {
  test("the viewer steps the folder's own photos in that sort, not every photo under it", async () => {
    mockViews = { lib1: { sortBy: "DateCreated", sortOrder: "Descending" } };
    mockParams = { folderId: "f1", photoId: "p2", libraryId: "lib1" };
    (fetchItemDetails as jest.Mock).mockResolvedValueOnce(two);
    (fetchFolderPhotos as jest.Mock).mockResolvedValueOnce([three, two, one]);

    const tree = await mountViewer();

    expect(fetchFolderPhotos).toHaveBeenCalledWith("f1", expect.objectContaining({ sortBy: "DateCreated", sortOrder: "Descending" }));
    expect(fetchFilteredVideos).not.toHaveBeenCalled();
    expect(counter(tree)).toMatch(/Two.*2\| \/ \|3/);
    tree.unmount();
  });

  test("the default sort asks for the folder's photos with no sort named", async () => {
    const tree = await mountViewer();

    expect(fetchFolderPhotos).toHaveBeenCalledWith("f1", undefined);
    tree.unmount();
  });

  test("the Slideshow button's whole subtree is read in that sort", async () => {
    mockViews = { lib1: { sortBy: "DateCreated" } };
    mockParams = { folderId: "album1", recursive: "true", slideshow: "true", libraryId: "lib1" };

    const tree = await mountViewer();

    expect(fetchFilteredVideos).toHaveBeenCalledWith("album1", expect.objectContaining({ sortBy: "DateCreated" }));
    expect(fetchRecursivePhotos).not.toHaveBeenCalled();
    tree.unmount();
  });
});

describe("a saved view that arrives while the viewer is open", () => {
  test("a filter that leaves out the photo on screen moves the viewer to the pressed photo, with its own name and count", async () => {
    mockParams = { folderId: "f1", photoId: "p1" };
    (fetchFolderPhotos as jest.Mock).mockResolvedValueOnce([one, two, three]);
    const tree = await mountViewer();
    await act(async () => mockTvHandler?.({ eventType: "right" }));
    await act(async () => mockTvHandler?.({ eventType: "right" }));
    expect(counter(tree)).toMatch(/Three.*3\| \/ \|3/);

    mockViews = { f1: { favorite: true } };
    (fetchFilteredVideos as jest.Mock).mockResolvedValueOnce([two, one]);
    await act(async () => {
      tree.update(<PhotoViewerScreen />);
    });

    expect(counter(tree)).toMatch(/One.*2\| \/ \|2/);
    expect(tree.root.findAllByType(Image).some((node) => node.props.source.uri === "http://server/p1")).toBe(true);
    tree.unmount();
  });

  test("a filter that leaves out the pressed photo replaces the list and keeps the photo on screen", async () => {
    mockParams = { folderId: "f1", photoId: "p1" };
    (fetchFolderPhotos as jest.Mock).mockResolvedValueOnce([one, two, three]);
    const tree = await mountViewer();
    await act(async () => mockTvHandler?.({ eventType: "right" }));
    expect(counter(tree)).toMatch(/Two.*2\| \/ \|3/);

    mockViews = { f1: { favorite: true } };
    (fetchFilteredVideos as jest.Mock).mockResolvedValueOnce([two, three]);
    await act(async () => {
      tree.update(<PhotoViewerScreen />);
    });

    expect(counter(tree)).toMatch(/Two.*1\| \/ \|2/);
    tree.unmount();
  });

  test("a changed filter reads the set again", async () => {
    mockViews = { f1: { genres: ["Space"] } };
    const tree = await mountViewer();
    expect(fetchFilteredVideos).toHaveBeenCalledTimes(1);

    mockViews = { f1: { genres: ["Space"], favorite: true } };
    await act(async () => {
      tree.update(<PhotoViewerScreen />);
    });

    expect(fetchFilteredVideos).toHaveBeenCalledTimes(2);
    expect((fetchFilteredVideos as jest.Mock).mock.calls[1][1]).toEqual(expect.objectContaining({ favorite: true }));
    tree.unmount();
  });

  test("the photo stepped to stays on screen with its own name and count", async () => {
    mockViews = { lib1: SHUFFLE };
    mockParams = { folderId: "f1", photoId: "p2", libraryId: "lib1" };
    setShuffledListing("f1", [two, one]);
    servePages([two, one]);
    const tree = await mountViewer();
    await act(async () => mockTvHandler?.({ eventType: "right" }));
    expect(counter(tree)).toMatch(/One.*2\| \/ \|2/);

    mockViews = { lib1: { shuffle: true, sortBy: "DateCreated" } };
    await act(async () => {
      tree.update(<PhotoViewerScreen />);
    });

    expect(counter(tree)).toMatch(/One.*2\| \/ \|2/);
    tree.unmount();
  });
});
