/**
 * The panel's watched circle on a container: a series or season offers it, any other folder does not.
 */
import VideoInfoScreen from "@/app/video-info";
import { fetchItemDetails, setVideoPlayed } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockActionRow = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const chain: any = new Proxy(() => chain, { get: () => () => chain, apply: () => chain });
  return { Gesture: { Pan: () => chain, Native: () => chain }, GestureDetector: ({ children }: { children: React.ReactNode }) => children, GestureHandlerRootView: View };
});
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
jest.mock("@/components/info-action-row", () => ({
  InfoActionRow: (props: unknown) => {
    mockActionRow(props);
    return null;
  },
}));
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
  isPhoto: () => false,
  isBook: () => false,
  notifyResumeChange: jest.fn(),
  setVideoFavorite: jest.fn(async () => {}),
  setVideoPlayed: jest.fn(async () => {}),
}));

const mockParams = useLocalSearchParams as jest.Mock;
const mockDetails = fetchItemDetails as jest.Mock;

type RowProps = { isPlayed?: boolean; onToggleWatched?: () => Promise<boolean> };

async function lastRowProps(item: Partial<JellyfinItem>): Promise<RowProps | undefined> {
  mockDetails.mockResolvedValue({ Id: "folder-1", Name: "Folder", DateCreated: "2026-08-27T00:00:00Z", ...item });
  mockParams.mockReturnValue({ videoId: "folder-1" });
  await act(async () => {
    TestRenderer.create(<VideoInfoScreen />);
  });
  return mockActionRow.mock.calls.at(-1)?.[0];
}

describe("Video info: watched circle on a container", () => {
  beforeEach(() => jest.clearAllMocks());

  it("marks a partly watched season watched", async () => {
    const props = await lastRowProps({ Type: "Season", UserData: { Played: false, PlayedPercentage: 37.5 } } as Partial<JellyfinItem>);

    expect(props?.isPlayed).toBe(false);
    await act(async () => {
      await props?.onToggleWatched?.();
    });
    expect(setVideoPlayed).toHaveBeenCalledWith("folder-1", true);
  });

  it("marks a watched series unwatched", async () => {
    const props = await lastRowProps({ Type: "Series", UserData: { Played: true } } as Partial<JellyfinItem>);

    expect(props?.isPlayed).toBe(true);
    await act(async () => {
      await props?.onToggleWatched?.();
    });
    expect(setVideoPlayed).toHaveBeenCalledWith("folder-1", false);
  });

  it("offers no watched circle on a collection or a plain folder", async () => {
    for (const Type of ["BoxSet", "Folder"]) {
      mockActionRow.mockClear();
      const props = await lastRowProps({ Type } as Partial<JellyfinItem>);
      expect(props?.onToggleWatched).toBeUndefined();
    }
  });
});
