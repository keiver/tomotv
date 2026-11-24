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
let mockShuffle = false;
let mockFavorite = false;
jest.mock("@/contexts/LibraryFiltersContext", () => ({
  useLibraryFilters: () => ({
    getFilters: () => ({ genres: [], artistIds: [], years: [], favorite: mockFavorite, played: false, unplayed: false, shuffle: mockShuffle, sortBy: "SortName", sortOrder: "Ascending" }),
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
  getPhotoUrl: (id: string) => `http://server/${id}`,
  WEBP_ACCEPT: { Accept: "image/webp" },
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
import { clearFolderContentsCache, setPhotoViewerOrder } from "@/services/folderContentsCache";
import { fetchFilteredVideos, fetchFolderPhotos, fetchItemDetails, fetchRecursivePhotos } from "@/services/jellyfinApi";
import * as Reanimated from "react-native-reanimated";

beforeEach(() => {
  mockParams = { folderId: "f1", photoId: "p1" };
  mockShuffle = false;
  mockFavorite = false;
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

test("manual steps and slideshow follow the shuffled grid and remaining photos", async () => {
  mockShuffle = true;
  mockParams = { folderId: "f1", photoId: "p2", gridOrder: "true" };
  const third = { Id: "p3", Name: "Three", Type: "Photo", Path: "/photos/three.png" };
  const fourth = { Id: "p4", Name: "Four", Type: "Photo", Path: "/photos/four.png" };
  setPhotoViewerOrder("f1", [mockPhotos[1], mockPhotos[0]]);
  (fetchFolderPhotos as jest.Mock).mockResolvedValueOnce([mockPhotos[0], mockPhotos[1], third, fourth]);
  let countdown: ((finished?: boolean) => void) | undefined;
  const timing = jest.spyOn(Reanimated, "withTiming").mockImplementation((value, config, callback) => {
    if (config?.duration === 5000) countdown = callback;
    return value;
  });

  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  expect(counter(tree)).toContain("Two");
  expect(counter(tree)).toMatch(/1\| \/ \|4/);

  await act(async () => mockTvHandler?.({ eventType: "right" }));
  expect(counter(tree)).toContain("One");
  await act(async () => mockTvHandler?.({ eventType: "playPause" }));
  await act(async () => countdown?.(true));
  expect(counter(tree)).toContain("Four");
  await act(async () => countdown?.(true));
  expect(counter(tree)).toContain("Three");
  await act(async () => countdown?.(true));
  expect(counter(tree)).toContain("Two");
  tree.unmount();
  timing.mockRestore();
});

test("shuffle keeps the loaded photos if the full folder fetch fails", async () => {
  mockShuffle = true;
  mockParams = { folderId: "f1", photoId: "p2", gridOrder: "true" };
  setPhotoViewerOrder("f1", [mockPhotos[1], mockPhotos[0]]);
  (fetchFolderPhotos as jest.Mock).mockRejectedValueOnce(new Error("server down"));
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  await act(async () => mockTvHandler?.({ eventType: "right" }));
  expect(counter(tree)).toContain("One");
  tree.unmount();
});

test("the full shuffled set keeps the photo selected while it was loading", async () => {
  mockShuffle = true;
  mockParams = { folderId: "f1", photoId: "p2", gridOrder: "true" };
  setPhotoViewerOrder("f1", [mockPhotos[1], mockPhotos[0]]);
  let resolveSet!: (items: unknown) => void;
  (fetchFolderPhotos as jest.Mock).mockReturnValueOnce(new Promise((resolve) => (resolveSet = resolve)));
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  await act(async () => mockTvHandler?.({ eventType: "right" }));
  expect(counter(tree)).toContain("One");
  await act(async () => resolveSet([mockPhotos[0], mockPhotos[1], { Id: "p3", Name: "Three", Type: "Photo", Path: "/photos/three.png" }]));
  expect(counter(tree)).toContain("One");
  expect(counter(tree)).toMatch(/2\| \/ \|3/);
  tree.unmount();
});

test("shuffle with a content filter appends only the filtered photos", async () => {
  mockShuffle = true;
  mockFavorite = true;
  mockParams = { folderId: "f1", photoId: "p2", gridOrder: "true" };
  setPhotoViewerOrder("f1", [mockPhotos[1]]);
  (fetchFilteredVideos as jest.Mock).mockResolvedValueOnce([mockPhotos[0], mockPhotos[1]]);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  await act(async () => mockTvHandler?.({ eventType: "right" }));
  expect(counter(tree)).toContain("One");
  tree.unmount();
});

test("a recursive slideshow shuffles its full set", async () => {
  mockShuffle = true;
  mockParams = { folderId: "f1", recursive: "true", slideshow: "true" };
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PhotoViewerScreen />);
  });
  expect(counter(tree)).toContain("Two");
  await act(async () => mockTvHandler?.({ eventType: "right" }));
  expect(counter(tree)).toContain("One");
  tree.unmount();
});
