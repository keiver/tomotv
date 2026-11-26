/**
 * The panel's Slideshow button on a folder of photos: it starts the slideshow under the library
 * whose sort and filters the folder screen was listed with.
 */
import VideoInfoScreen from "@/app/video-info";
import { fetchItemDetails } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const album = { Id: "album-1", Name: "Nebulae", Type: "Folder", DateCreated: "2026-08-27T00:00:00Z" } as unknown as JellyfinItem;

const mockPlayFolder = jest.fn();
const mockButtons: (() => void)[] = [];

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useNavigationContainerRef: () => ({ isReady: () => false }),
}));

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/hooks/useSubtitlePanel", () => ({ useSubtitlePanel: () => ({ available: true, open: jest.fn(), offsetMs: 0 }) }));
jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const chain: unknown = new Proxy(() => chain, { get: () => () => chain, apply: () => chain });
  return { Gesture: { Pan: () => chain, Native: () => chain }, GestureDetector: ({ children }: { children: React.ReactNode }) => children, GestureHandlerRootView: View };
});
jest.mock("@/services/localRemux", () => ({
  predictPlaybackLane: jest.fn(async () => null),
  posterFrameIfCached: jest.fn(() => undefined),
  posterFrameRevision: jest.fn(() => 0),
  requestPosterFrame: jest.fn(async () => null),
  cancelPosterFrame: jest.fn(),
}));
jest.mock("@/hooks/useFolderPlay", () => ({ useFolderPlay: () => mockPlayFolder }));
jest.mock("@/hooks/useShowInFolder", () => ({ useShowInFolder: () => jest.fn() }));
jest.mock("@/hooks/useOpenShelfItem", () => ({ useOpenShelfItem: () => jest.fn() }));
jest.mock("@/services/nextUp", () => ({ containerKey: () => null, dismissNextUpContainer: jest.fn() }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn(), hideGlobalLoader: jest.fn() }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/close-overlay-button", () => ({ CloseOverlayButton: () => null }));
jest.mock("@/components/info-action-row", () => ({ InfoActionRow: () => null }));
jest.mock("@/components/info-focus-row", () => ({ InfoFocusRow: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/FocusableButton", () => ({
  FocusableButton: (props: { onPress: () => void }) => {
    mockButtons.push(props.onPress);
    return null;
  },
}));
jest.mock("expo-image", () => ({ Image: Object.assign(() => null, { loadAsync: async () => ({ width: 16, height: 9 }) }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/progress-button", () => ({ ProgressButton: () => null }));

jest.mock("@/services/jellyfinApi", () => ({
  subscribeSubtitlesChanged: jest.fn(() => () => {}),
  subscribeAuthChange: jest.fn(() => () => {}),
  clearResumePosition: jest.fn(async () => {}),
  deleteItem: jest.fn(async () => {}),
  fetchIsAdministrator: jest.fn(async () => false),
  isLiveChannel: () => false,
  fetchItemDetails: jest.fn(),
  fetchFolderMediaKinds: jest.fn(async () => ({ video: false, audio: false, photo: true })),
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

describe("Video info: Slideshow on a folder of photos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockButtons.length = 0;
    (fetchItemDetails as jest.Mock).mockResolvedValue(album);
  });

  it("starts the slideshow under the library the folder screen was listed with", async () => {
    mockParams.mockReturnValue({ videoId: "album-1", inFolderId: "library-1", inLibraryId: "library-1" });
    await act(async () => {
      TestRenderer.create(<VideoInfoScreen />);
    });
    await act(async () => {
      mockButtons.at(-1)!();
    });

    expect(mockPlayFolder).toHaveBeenCalledWith(album, "photo", { replace: !Platform.isTV, libraryId: "library-1" });
  });
});
