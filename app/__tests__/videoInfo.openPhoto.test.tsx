/**
 * The panel's Open CTA on a photo. fetchItemDetails does not ask for ParentId, so off a shelf
 * card (no inFolderId) the only trustworthy parent is the ancestor walk's leaf. Reading
 * ParentId first opened the viewer with no folder it could find the photo in, which showed the
 * library's first photo instead of the pressed one.
 */
import VideoInfoScreen from "@/app/video-info";
import { fetchItemDetails, fetchItemFolderPath } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const photo = {
  Id: "photo-1",
  Name: "reference_00011_",
  Type: "Photo",
  Path: "/Users/x/Pictures/reference_00011_.png",
  Container: "png",
} as unknown as JellyfinItem;

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
jest.mock("@/components/info-focus-row", () => ({ InfoFocusRow: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

let openPress: (() => void) | null = null;
jest.mock("@/components/progress-button", () => ({
  ProgressButton: (props: { onPress: () => void }) => {
    openPress = props.onPress;
    return null;
  },
}));

jest.mock("@/services/jellyfinApi", () => ({
  subscribeAuthChange: jest.fn(() => () => {}),
  clearResumePosition: jest.fn(async () => {}),
  fetchItemDetails: jest.fn(),
  fetchFolderMediaKinds: jest.fn(async () => null),
  fetchItemFolderPath: jest.fn(async () => []),
  formatDuration: () => "",
  getBackdropUrl: () => null,
  getLogoUrl: () => null,
  getPersonImageUrl: () => null,
  getPosterUrl: () => null,
  hasPoster: () => false,
  isAudioItem: () => false,
  isFolder: () => false,
  isPhoto: (candidate: JellyfinItem) => candidate.Type === "Photo",
  notifyResumeChange: jest.fn(),
  setVideoFavorite: jest.fn(async () => {}),
  setVideoPlayed: jest.fn(async () => {}),
}));

const mockParams = useLocalSearchParams as jest.Mock;
const mockDetails = fetchItemDetails as jest.Mock;
const mockFolderPath = fetchItemFolderPath as jest.Mock;

async function mountAndOpen() {
  await act(async () => {
    TestRenderer.create(<VideoInfoScreen />);
  });
  await act(async () => {
    openPress!();
  });
}

describe("Video info: Open on a photo", () => {
  beforeEach(() => {
    openPress = null;
    jest.clearAllMocks();
    mockDetails.mockResolvedValue(photo);
    mockParams.mockReturnValue({ videoId: "photo-1" });
    mockFolderPath.mockResolvedValue([
      { id: "library-1", name: "Pictures", type: "folder" },
      { id: "folder-1", name: "Pictures", type: "folder" },
    ]);
  });

  it("opens the viewer on the ancestor leaf when the card carried no folder", async () => {
    await mountAndOpen();

    expect(mockPush).toHaveBeenCalledWith({ pathname: "/photo-viewer", params: { photoId: "photo-1", folderId: "folder-1" } });
  });

  it("prefers the folder the press came from", async () => {
    mockParams.mockReturnValue({ videoId: "photo-1", inFolderId: "browsed-folder" });
    await mountAndOpen();

    expect(mockPush).toHaveBeenCalledWith({ pathname: "/photo-viewer", params: { photoId: "photo-1", folderId: "browsed-folder" } });
  });

  it("still opens the photo when no parent can be resolved at all", async () => {
    mockFolderPath.mockResolvedValue([]);
    await mountAndOpen();

    expect(mockPush).toHaveBeenCalledWith({ pathname: "/photo-viewer", params: { photoId: "photo-1" } });
  });
});
