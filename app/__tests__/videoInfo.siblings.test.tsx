/**
 * The panel's left/right neighbours are Play's queue: SeriesId ?? ParentId in SortName order,
 * videos only. The opened panel keeps the route's params; a sibling shares only the folder.
 */
import VideoInfoScreen from "@/app/video-info";
import type { VideoInfoPanelProps } from "@/components/video-info-panel";
import { fetchRecursiveVideos } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const chain: any = new Proxy(() => chain, { get: () => () => chain, apply: () => chain });
  return { Gesture: { Pan: () => chain, Native: () => chain }, GestureDetector: ({ children }: { children: React.ReactNode }) => children, GestureHandlerRootView: View };
});
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/components/close-overlay-button", () => ({ CloseOverlayButton: () => null }));

/** The panel's item, keyed by the id it is opened on; it reports ready on mount like the real one. */
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
  isAudioItem: (item: { Type?: string }) => item.Type === "Audio",
  isFolder: (item: { IsFolder?: boolean }) => item.IsFolder === true,
  isPhoto: (item: { Type?: string }) => item.Type === "Photo",
  isBook: (item: { Type?: string }) => item.Type === "Book",
  isLiveChannel: (item: { Type?: string }) => item.Type === "TvChannel",
}));
jest.mock("@/services/playedCache", () => ({ getPlayedOverrides: () => new Map() }));

const mockParams = useLocalSearchParams as jest.Mock;
const mockFetchRecursive = fetchRecursiveVideos as jest.Mock;

const episode = (id: string, season: number) => ({ Id: id, Name: `Episode ${id}`, Type: "Episode", SeriesId: "show", ParentId: `season-${season}` }) as unknown as JellyfinItem;

async function mountOn(params: Record<string, string>) {
  mockParams.mockReturnValue(params);
  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VideoInfoScreen />);
  });
  const { VideoInfoPanel } = require("@/components/video-info-panel");
  return tree!.root.findAllByType(VideoInfoPanel).map((node) => node.props as VideoInfoPanelProps);
}

describe("Video info: drag to a sibling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockItems)) delete mockItems[key];
  });

  it("puts the next season's first episode beside the last of this one, from the series' queue", async () => {
    const queue = [episode("s1e1", 1), episode("s1e2", 1), episode("s2e1", 2)];
    for (const item of queue) mockItems[item.Id] = item;
    mockFetchRecursive.mockResolvedValue(queue);

    const panels = await mountOn({ videoId: "s1e2", name: "Episode s1e2", inFolderId: "season-1", fromResume: "1" });

    expect(mockFetchRecursive).toHaveBeenCalledWith("show");
    expect(panels.map((panel) => panel.videoId)).toEqual(["s1e1", "s1e2", "s2e1"]);
    const opened = panels.find((panel) => panel.videoId === "s1e2")!;
    expect(opened).toMatchObject({ active: true, fromResume: "1", inFolderId: "season-1" });
    const next = panels.find((panel) => panel.videoId === "s2e1")!;
    expect(next).toMatchObject({ active: false, name: "Episode s2e1", inFolderId: "season-1" });
    expect(next.fromResume).toBeUndefined();
    expect(next.onReady).toBeUndefined();
  });

  it("walks videos only, past the audio a folder also holds", async () => {
    const movie = { Id: "m2", Name: "Two", Type: "Movie", ParentId: "movies" } as unknown as JellyfinItem;
    mockItems.m2 = movie;
    mockFetchRecursive.mockResolvedValue([{ Id: "m1", Type: "Movie" }, { Id: "song", Type: "Audio" }, movie, { Id: "m3", Type: "Movie" }]);

    const panels = await mountOn({ videoId: "m2" });

    expect(mockFetchRecursive).toHaveBeenCalledWith("movies");
    expect(panels.map((panel) => panel.videoId)).toEqual(["m1", "m2", "m3"]);
  });

  it("stays a single panel for a folder, which has no queue to walk", async () => {
    mockItems.season = { Id: "season", Name: "Season 1", Type: "Season", IsFolder: true, ParentId: "show" } as unknown as JellyfinItem;

    const panels = await mountOn({ videoId: "season" });

    expect(mockFetchRecursive).not.toHaveBeenCalled();
    expect(panels.map((panel) => panel.videoId)).toEqual(["season"]);
  });

  it("stays a single panel when the queue load fails", async () => {
    mockItems.s1e1 = episode("s1e1", 1);
    mockFetchRecursive.mockRejectedValue(new Error("offline"));

    const panels = await mountOn({ videoId: "s1e1" });

    expect(panels.map((panel) => panel.videoId)).toEqual(["s1e1"]);
  });
});
