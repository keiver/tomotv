/**
 * The panel's left/right neighbours: a video's or song's are Play's queue (SeriesId ?? ParentId, SortName,
 * its own kind), a folder's, photo's or book's the same kind in the folder, a library's the libraries, a
 * channel's the guide's channels. The opened panel keeps the route's params; a sibling shares only the folder.
 */
import VideoInfoScreen from "@/app/video-info";
import type { VideoInfoPanelProps } from "@/components/video-info-panel";
import { fetchChannelRing, fetchFolderContents, fetchRecursiveVideos, fetchUserViews } from "@/services/jellyfinApi";
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
  fetchFolderContents: jest.fn(),
  fetchUserViews: jest.fn(),
  fetchChannelRing: jest.fn(),
  isAudioItem: (item: { Type?: string }) => item.Type === "Audio",
  isFolder: (item: { IsFolder?: boolean }) => item.IsFolder === true,
  isPhoto: (item: { Type?: string }) => item.Type === "Photo",
  isBook: (item: { Type?: string }) => item.Type === "Book",
  isLiveChannel: (item: { Type?: string }) => item.Type === "TvChannel",
}));
jest.mock("@/services/playedCache", () => ({ getPlayedOverrides: () => new Map() }));
const mockPreferences = { filter: "all", sort: "number", favorites: [], groups: [] };
jest.mock("@/services/liveTvPreferences", () => ({ getLiveTvPreferences: () => mockPreferences }));

const mockParams = useLocalSearchParams as jest.Mock;
const mockFetchRecursive = fetchRecursiveVideos as jest.Mock;
const mockFetchFolderContents = fetchFolderContents as jest.Mock;
const mockFetchUserViews = fetchUserViews as jest.Mock;
const mockFetchChannelRing = fetchChannelRing as jest.Mock;

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

  it("walks a song through its album's songs, past a video the album also holds", async () => {
    const song = { Id: "t2", Name: "Two", Type: "Audio", ParentId: "album" } as unknown as JellyfinItem;
    mockItems.t2 = song;
    mockFetchRecursive.mockResolvedValue([{ Id: "t1", Type: "Audio" }, { Id: "clip", Type: "Video" }, song, { Id: "t3", Type: "Audio" }]);

    const panels = await mountOn({ videoId: "t2" });

    expect(mockFetchRecursive).toHaveBeenCalledWith("album");
    expect(panels.map((panel) => panel.videoId)).toEqual(["t1", "t2", "t3"]);
  });

  it("walks a photo through the photos of the folder the press came from, past its subfolders", async () => {
    const photo = { Id: "p2", Name: "Two", Type: "Photo", ParentId: "album" } as unknown as JellyfinItem;
    mockItems.p2 = photo;
    mockFetchFolderContents.mockResolvedValue({ items: [{ Id: "p1", Type: "Photo" }, { Id: "sub", Type: "PhotoAlbum", IsFolder: true }, photo], total: 3 });

    const panels = await mountOn({ videoId: "p2", inFolderId: "shown-folder" });

    expect(mockFetchFolderContents).toHaveBeenCalledWith("shown-folder", expect.anything());
    expect(panels.map((panel) => panel.videoId)).toEqual(["p1", "p2"]);
  });

  it("walks a book through its folder's books", async () => {
    const book = { Id: "b1", Name: "One", Type: "Book", ParentId: "shelf" } as unknown as JellyfinItem;
    mockItems.b1 = book;
    mockFetchFolderContents.mockResolvedValue({ items: [book, { Id: "cover", Type: "Photo" }, { Id: "b2", Type: "Book" }], total: 3 });

    const panels = await mountOn({ videoId: "b1" });

    expect(mockFetchFolderContents).toHaveBeenCalledWith("shelf", expect.anything());
    expect(panels.map((panel) => panel.videoId)).toEqual(["b1", "b2"]);
  });

  it("puts a folder beside its parent's other folders, past the videos listed with them", async () => {
    const season = { Id: "s2", Name: "Season 2", Type: "Season", IsFolder: true, ParentId: "show" } as unknown as JellyfinItem;
    mockItems.s2 = season;
    mockFetchFolderContents.mockResolvedValue({
      items: [{ Id: "s1", Type: "Season", IsFolder: true }, { Id: "trailer", Type: "Video" }, season, { Id: "s3", Type: "Season", IsFolder: true }],
      total: 4,
    });

    const panels = await mountOn({ videoId: "s2" });

    expect(mockFetchFolderContents).toHaveBeenCalledWith("show", expect.objectContaining({ startIndex: 0 }));
    expect(mockFetchRecursive).not.toHaveBeenCalled();
    expect(panels.map((panel) => panel.videoId)).toEqual(["s1", "s2", "s3"]);
  });

  it("reads the folder the press came from over the item's own parent", async () => {
    const show = { Id: "show-b", Name: "B", Type: "Series", IsFolder: true, ParentId: "physical-folder" } as unknown as JellyfinItem;
    mockItems["show-b"] = show;
    mockFetchFolderContents.mockResolvedValue({ items: [{ Id: "show-a", Type: "Series", IsFolder: true }, show], total: 2 });

    const panels = await mountOn({ videoId: "show-b", inFolderId: "tv-library" });

    expect(mockFetchFolderContents).toHaveBeenCalledWith("tv-library", expect.anything());
    expect(panels.map((panel) => panel.videoId)).toEqual(["show-a", "show-b"]);
  });

  it("puts a library beside the other libraries, in the Home row's order", async () => {
    const tv = { Id: "tv", Name: "Shows", Type: "CollectionFolder", IsFolder: true } as unknown as JellyfinItem;
    mockItems.tv = tv;
    mockFetchUserViews.mockResolvedValue({ items: [{ Id: "movies", Type: "CollectionFolder", IsFolder: true }, tv, { Id: "live", Type: "UserView", IsFolder: true }], total: 3 });

    const panels = await mountOn({ videoId: "tv" });

    expect(mockFetchFolderContents).not.toHaveBeenCalled();
    expect(panels.map((panel) => panel.videoId)).toEqual(["movies", "tv", "live"]);
  });

  it("puts a channel beside the guide's channels, in the order the guide lists them", async () => {
    const news = { Id: "ch-2", Name: "News", Type: "TvChannel" } as unknown as JellyfinItem;
    mockItems["ch-2"] = news;
    mockFetchChannelRing.mockResolvedValue([{ Id: "ch-1", Type: "TvChannel" }, news, { Id: "ch-3", Type: "TvChannel" }]);

    const panels = await mountOn({ videoId: "ch-2", name: "News" });

    expect(mockFetchChannelRing).toHaveBeenCalledWith(mockPreferences);
    expect(panels.map((panel) => panel.videoId)).toEqual(["ch-1", "ch-2", "ch-3"]);
  });

  it("puts a channel found outside the guide's filter after the guide's last, as a flip from it does", async () => {
    const outside = { Id: "ch-9", Name: "Outside", Type: "TvChannel" } as unknown as JellyfinItem;
    mockItems["ch-9"] = outside;
    mockFetchChannelRing.mockResolvedValue([
      { Id: "ch-1", Type: "TvChannel" },
      { Id: "ch-2", Type: "TvChannel" },
    ]);

    const panels = await mountOn({ videoId: "ch-9" });

    expect(panels.map((panel) => panel.videoId)).toEqual(["ch-2", "ch-9"]);
  });

  it("stays a single panel when the queue load fails", async () => {
    mockItems.s1e1 = episode("s1e1", 1);
    mockFetchRecursive.mockRejectedValue(new Error("offline"));

    const panels = await mountOn({ videoId: "s1e1" });

    expect(panels.map((panel) => panel.videoId)).toEqual(["s1e1"]);
  });
});
