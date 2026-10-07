/** tvOS: focus leaving the panel's left or right edge shows the neighbouring item's panel. */
import VideoInfoScreen from "@/app/video-info";
import type { VideoInfoPanelProps } from "@/components/video-info-panel";
import { fetchRecursiveVideos } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native", () => {
  const rn = jest.requireActual("react-native");
  Object.defineProperty(rn.Platform, "isTV", { configurable: true, value: true });
  return rn;
});
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const chain: any = new Proxy(() => chain, { get: () => () => chain, apply: () => chain });
  return { Gesture: { Pan: () => chain, Native: () => chain }, GestureDetector: ({ children }: { children: React.ReactNode }) => children, GestureHandlerRootView: View };
});
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/components/close-overlay-button", () => ({ CloseOverlayButton: () => null }));

const mockItems: Record<string, JellyfinItem> = {};
jest.mock("@/components/video-info-panel", () => ({
  VideoInfoPanel: (props: VideoInfoPanelProps) => {
    require("react").useEffect(() => {
      props.onReady?.(mockItems[props.videoId]);
    }, []);
    return null;
  },
}));
jest.mock("@/services/jellyfinApi", () => ({
  fetchRecursiveVideos: jest.fn(),
  fetchFolderContents: jest.fn(),
  fetchUserViews: jest.fn(),
  fetchChannelRing: jest.fn(),
  isAudioItem: (item: { Type?: string }) => item.Type === "Audio",
  isFolder: (item: { IsFolder?: boolean }) => item.IsFolder === true,
  isPhoto: (item: { Type?: string }) => item.Type === "Photo",
  isBook: (item: { Type?: string }) => item.Type === "Book",
  isLiveChannel: (item: { Type?: string }) => item.Type === "TvChannel",
}));
jest.mock("@/services/liveTvPreferences", () => ({ getLiveTvPreferences: () => ({}) }));

const song = (id: string) => ({ Id: id, Name: `Song ${id}`, Type: "Audio", ParentId: "album" }) as unknown as JellyfinItem;

async function mountOn(params: Record<string, string>) {
  mockParams = params;
  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VideoInfoScreen />);
  });
  return tree!;
}

const panels = (tree: TestRenderer.ReactTestRenderer) => {
  const { VideoInfoPanel } = require("@/components/video-info-panel");
  return tree.root.findAllByType(VideoInfoPanel).map((node) => node.props as VideoInfoPanelProps);
};
const edge = (tree: TestRenderer.ReactTestRenderer, side: "previous" | "next") =>
  tree.root.findAll((node) => node.props.testID === `sibling-edge-${side}` && typeof node.props.onFocus === "function")[0];

describe("Video info on tvOS: step to a sibling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const album = [song("t1"), song("t2"), song("t3")];
    for (const item of album) mockItems[item.Id] = item;
    (fetchRecursiveVideos as jest.Mock).mockResolvedValue(album);
  });

  it("shows the next song's panel when focus reaches the right edge, and offers both edges there", async () => {
    const tree = await mountOn({ videoId: "t1", fromResume: "1" });
    expect(edge(tree, "previous")).toBeUndefined();

    await act(async () => {
      edge(tree, "next")!.props.onFocus();
    });

    expect(panels(tree)).toEqual([expect.objectContaining({ videoId: "t2", name: "Song t2", active: true })]);
    expect(panels(tree)[0].fromResume).toBeUndefined();
    expect(edge(tree, "previous")).toBeDefined();
    expect(edge(tree, "next")).toBeDefined();
  });

  it("returns to the opened panel with the route's params from the left edge", async () => {
    const tree = await mountOn({ videoId: "t1", fromResume: "1" });
    await act(async () => {
      edge(tree, "next")!.props.onFocus();
    });
    await act(async () => {
      edge(tree, "previous")!.props.onFocus();
    });

    expect(panels(tree)).toEqual([expect.objectContaining({ videoId: "t1", fromResume: "1" })]);
    expect(edge(tree, "previous")).toBeUndefined();
  });

  it("offers no edge while the item has no siblings", async () => {
    (fetchRecursiveVideos as jest.Mock).mockResolvedValue([song("t1")]);
    const tree = await mountOn({ videoId: "t1" });

    expect(edge(tree, "previous")).toBeUndefined();
    expect(edge(tree, "next")).toBeUndefined();
  });
});
