/**
 * The panel's Contains row on a library root. The server answers a random 1-9 ChildCount for
 * a view, so the row shows the card badge's count, or nothing when that count fails.
 */
import VideoInfoScreen from "@/app/video-info";
import { fetchItemDetails, fetchLibraryRootCount } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const liveTvRoot = { Id: "livetv-view", Name: "Live TV", Type: "UserView", CollectionType: "livetv", ChildCount: 7, DateCreated: "2026-08-27T00:00:00Z" } as unknown as JellyfinItem;

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/services/localRemux", () => ({
  predictPlaybackLane: jest.fn(async () => null),
  posterFrameIfCached: jest.fn(() => undefined),
  posterFrameRevision: jest.fn(() => 0),
  requestPosterFrame: jest.fn(async () => null),
  cancelPosterFrame: jest.fn(),
}));
jest.mock("@/hooks/useFolderPlay", () => ({ useFolderPlay: () => jest.fn() }));
jest.mock("@/hooks/useShowInFolder", () => ({ useShowInFolder: () => jest.fn() }));
jest.mock("@/hooks/useOpenShelfItem", () => ({ useOpenShelfItem: () => jest.fn() }));
jest.mock("@/services/nextUp", () => ({ containerKey: () => null, dismissNextUpContainer: jest.fn() }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn(), hideGlobalLoader: jest.fn() }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/close-overlay-button", () => ({ CloseOverlayButton: () => null }));
jest.mock("@/components/info-action-row", () => ({ InfoActionRow: () => null }));
jest.mock("@/components/info-focus-row", () => ({ InfoFocusRow: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("expo-image", () => ({ Image: Object.assign(() => null, { loadAsync: async () => ({ width: 16, height: 9 }) }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("@/components/progress-button", () => ({ ProgressButton: () => null }));

jest.mock("@/services/jellyfinApi", () => ({
  subscribeAuthChange: jest.fn(() => () => {}),
  clearResumePosition: jest.fn(async () => {}),
  deleteItem: jest.fn(async () => {}),
  fetchIsAdministrator: jest.fn(async () => false),
  isLiveChannel: () => false,
  fetchItemDetails: jest.fn(),
  fetchFolderMediaKinds: jest.fn(async () => null),
  fetchItemFolderPath: jest.fn(async () => []),
  fetchLibraryRootCount: jest.fn(),
  fetchFolderPreviewItems: jest.fn(async () => []),
  getBackdropUrl: () => null,
  getLogoUrl: () => null,
  getPersonImageUrl: () => null,
  getPosterUrl: () => null,
  hasPoster: () => false,
  isAudioItem: () => false,
  isFolder: () => true,
  isPhoto: (candidate: JellyfinItem) => candidate.Type === "Photo",
  isBook: (candidate: JellyfinItem) => candidate.Type === "Book",
  notifyResumeChange: jest.fn(),
  setVideoFavorite: jest.fn(async () => {}),
  setVideoPlayed: jest.fn(async () => {}),
}));

const mockParams = useLocalSearchParams as jest.Mock;
const mockDetails = fetchItemDetails as jest.Mock;
const mockRootCount = fetchLibraryRootCount as jest.Mock;

async function renderedText(): Promise<string[]> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VideoInfoScreen />);
  });
  return tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(""));
}

describe("Video info: library root count", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDetails.mockResolvedValue(liveTvRoot);
    mockParams.mockReturnValue({ videoId: "livetv-view" });
  });

  it("shows the root's own count, never the server's ChildCount", async () => {
    mockRootCount.mockResolvedValue(10985);
    const text = await renderedText();

    expect(mockRootCount).toHaveBeenCalledWith("livetv-view", "livetv");
    expect(text).toContain("10985 items");
    expect(text).not.toContain("7 items");
  });

  it("drops the row when the count fails", async () => {
    mockRootCount.mockRejectedValue(new Error("down"));
    const text = await renderedText();

    expect(text).not.toContain("7 items");
    expect(text).toContain("Added");
    expect(text.some((line) => line.endsWith(" items"))).toBe(false);
  });
});
