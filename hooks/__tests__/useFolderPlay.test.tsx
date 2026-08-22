/**
 * Tests for useFolderPlay: the info panel's Play CTAs. Covers what a failed fetch is allowed to
 * say (never "nothing to play"), that a playlist is queued from every page rather than the first
 * one, and the kind filter that decides which items reach the queue.
 *
 * Rendered with react-test-renderer through a null-rendering harness, the same pattern as
 * hooks/__tests__/useFolderContents.test.tsx.
 */
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Alert } from "react-native";
import { useFolderPlay, type FolderPlayKind } from "@/hooks/useFolderPlay";
import { JellyfinItem } from "@/types/jellyfin";
import { fetchAllPlaylistItems, fetchRecursiveVideos } from "@/services/jellyfinApi";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockBuildQueueFromItems = jest.fn();
const mockHideGlobalLoader = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
}));

jest.mock("@/contexts/LoadingContext", () => ({
  useLoadingActions: () => ({ showGlobalLoader: jest.fn(), hideGlobalLoader: mockHideGlobalLoader }),
}));

jest.mock("@/contexts/PlayQueueContext", () => ({
  usePlayQueue: () => ({ buildQueueFromItems: mockBuildQueueFromItems }),
}));

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

jest.mock("@/services/jellyfinApi", () => ({
  fetchAllPlaylistItems: jest.fn(),
  fetchRecursiveVideos: jest.fn(),
  isAudioItem: (item: JellyfinItem) => item.Type === "Audio",
  isPhoto: (item: JellyfinItem) => item.Type === "Photo",
}));

const mockAllPlaylistItems = fetchAllPlaylistItems as jest.Mock;
const mockRecursiveVideos = fetchRecursiveVideos as jest.Mock;

const FOLDER: JellyfinItem = { Id: "folder-1", Name: "Movies", Type: "Folder" } as JellyfinItem;
const PLAYLIST: JellyfinItem = { Id: "playlist-1", Name: "Favorites", Type: "Playlist" } as JellyfinItem;

const VIDEO = { Id: "v1", Name: "A Movie", Type: "Movie" } as JellyfinItem;
const SONG = { Id: "a1", Name: "A Song", Type: "Audio" } as JellyfinItem;

interface Handle {
  play: (folder: JellyfinItem, kind: FolderPlayKind) => Promise<void>;
}

const Harness = forwardRef<Handle>(function Harness(_props, ref) {
  const playFolder = useFolderPlay();
  useImperativeHandle(ref, () => ({ play: (folder, kind) => playFolder(folder, kind) }), [playFolder]);
  return null;
});

async function play(folder: JellyfinItem, kind: FolderPlayKind) {
  const ref = React.createRef<Handle>();
  await act(async () => {
    TestRenderer.create(<Harness ref={ref} />);
  });
  await act(async () => {
    await ref.current!.play(folder, kind);
  });
}

describe("useFolderPlay", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockRecursiveVideos.mockResolvedValue([VIDEO]);
    mockAllPlaylistItems.mockResolvedValue([VIDEO]);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  // A failed request used to fall through to the empty-folder branch, so a network
  // failure told the user their folder held nothing of that kind.
  it("reports a failed fetch as a failure, not an empty folder", async () => {
    mockRecursiveVideos.mockRejectedValueOnce(new Error("Network error"));

    await play(FOLDER, "video");

    expect(alertSpy).toHaveBeenCalledWith("Couldn't load folder", expect.any(String));
    expect(alertSpy).not.toHaveBeenCalledWith("Nothing to play", expect.any(String));
    expect(mockBuildQueueFromItems).not.toHaveBeenCalled();
    expect(mockHideGlobalLoader).toHaveBeenCalled();
  });

  it("still reports a genuinely empty folder as nothing to play", async () => {
    mockRecursiveVideos.mockResolvedValueOnce([]);

    await play(FOLDER, "video");

    expect(alertSpy).toHaveBeenCalledWith("Nothing to play", expect.any(String));
    expect(mockBuildQueueFromItems).not.toHaveBeenCalled();
  });

  // Every page, not the first 500.
  it("queues a playlist from the all-pages fetch", async () => {
    await play(PLAYLIST, "video");

    expect(mockAllPlaylistItems).toHaveBeenCalledWith("playlist-1");
    expect(mockBuildQueueFromItems).toHaveBeenCalledWith([VIDEO], "playlist-1", "Favorites", "v1");
  });

  it("keeps only the requested kind in the queue", async () => {
    mockRecursiveVideos.mockResolvedValueOnce([VIDEO, SONG]);

    await play(FOLDER, "audio");

    expect(mockBuildQueueFromItems).toHaveBeenCalledWith([SONG], "folder-1", "Movies", "a1");
  });
});
