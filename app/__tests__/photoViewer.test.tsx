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
jest.mock("@/services/folderContentsCache", () => ({ getFolderCache: () => null }));
jest.mock("@/contexts/LibraryFiltersContext", () => ({
  useLibraryFilters: () => ({ getFilters: () => ({ genres: [], artistIds: [], years: [], favorite: false, played: false, unplayed: false, shuffle: false }) }),
}));

const mockPhotos = [
  { Id: "p1", Name: "One", Type: "Photo", Path: "/photos/one.png" },
  { Id: "p2", Name: "Two", Type: "Photo", Path: "/photos/two.gif" },
];
jest.mock("@/services/jellyfinApi", () => ({
  fetchFolderPhotos: jest.fn(async () => mockPhotos),
  fetchFilteredVideos: jest.fn(async () => mockPhotos),
  fetchItemDetails: jest.fn(async () => mockPhotos[0]),
  fetchRecursivePhotos: jest.fn(async () => mockPhotos),
  getPhotoUrl: (id: string, _width?: number, format?: string) => `http://server/${id}${format ? `?format=${format}` : ""}`,
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
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ folderId: "f1", photoId: "p1" }), useRouter: () => mockRouter }));

import PhotoViewerScreen from "@/app/photo-viewer";
import { Image } from "expo-image";
import { fetchFolderPhotos } from "@/services/jellyfinApi";

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
  expect(page.props.source).toEqual({ uri: "http://server/p1?format=Jpg" });
  expect(page.props.placeholder).toEqual({ uri: "http://server/p1?preview" });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1);

  await act(async () => {
    page.props.onLoad();
  });
  expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  tree.unmount();
});

test("a GIF keeps its own format, so it can still animate", async () => {
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
  const uris = tree.root.findAllByType(Image).map((node) => node.props.source.uri);
  expect(uris).toContain("http://server/p2");
  tree.unmount();
});
