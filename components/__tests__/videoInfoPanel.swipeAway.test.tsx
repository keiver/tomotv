/**
 * Remove Progress is performed by leaving the panel. Dragging to a sibling leaves it too, while
 * the pager keeps it mounted beside the shown one.
 */
import { VideoInfoPanel } from "@/components/video-info-panel";
import { clearResumePosition, fetchItemDetails } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const item = {
  Id: "item-1",
  Name: "Arrival",
  Type: "Movie",
  MediaStreams: [],
  UserData: { PlaybackPositionTicks: 6_000_000_000, Played: false },
} as unknown as JellyfinItem;

jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }) }));
jest.mock("react-native-gesture-handler", () => {
  const chain: any = new Proxy(() => chain, { get: () => () => chain, apply: () => chain });
  return { Gesture: { Native: () => chain }, GestureDetector: ({ children }: { children: React.ReactNode }) => children };
});
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
jest.mock("@/components/info-action-row", () => ({ InfoActionRow: () => null }));
jest.mock("@/components/info-focus-row", () => ({ InfoFocusRow: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/progress-button", () => ({ ProgressButton: () => null }));
jest.mock("expo-image", () => ({ Image: Object.assign(() => null, { loadAsync: async () => ({ width: 16, height: 9 }) }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/jellyfinApi", () => ({
  subscribeAuthChange: jest.fn(() => () => {}),
  clearResumePosition: jest.fn(async () => {}),
  deleteItem: jest.fn(async () => {}),
  fetchIsAdministrator: jest.fn(async () => false),
  isLiveChannel: () => false,
  fetchItemDetails: jest.fn(),
  fetchFolderMediaKinds: jest.fn(async () => null),
  fetchItemFolderPath: jest.fn(async () => []),
  getBackdropUrl: () => null,
  getLogoUrl: () => null,
  getPersonImageUrl: () => null,
  getPosterUrl: () => null,
  hasPoster: () => false,
  isAudioItem: () => false,
  isFolder: () => false,
  isPhoto: () => false,
  isBook: () => false,
  notifyResumeChange: jest.fn(),
  setVideoFavorite: jest.fn(async () => {}),
  setVideoPlayed: jest.fn(async () => {}),
}));

const mockFetchItemDetails = fetchItemDetails as jest.Mock;
const mockClearResumePosition = clearResumePosition as jest.Mock;

async function mount(arm: boolean) {
  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VideoInfoPanel videoId="item-1" active />);
  });
  if (arm) {
    const row = tree!.root.findByType(require("@/components/info-action-row").InfoActionRow);
    await act(async () => {
      row.props.onToggleProgress();
    });
  }
  return tree!;
}

describe("Video info panel: dragged away", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchItemDetails.mockResolvedValue(item);
  });

  it("performs an armed Remove Progress once the panel is no longer the shown one", async () => {
    const tree = await mount(true);
    expect(mockClearResumePosition).not.toHaveBeenCalled();

    await act(async () => {
      tree.update(<VideoInfoPanel videoId="item-1" active={false} />);
    });

    expect(mockClearResumePosition).toHaveBeenCalledTimes(1);
    expect(mockClearResumePosition).toHaveBeenCalledWith("item-1");
    await act(async () => {
      tree.unmount();
    });
    expect(mockClearResumePosition).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the removal was never armed", async () => {
    const tree = await mount(false);
    await act(async () => {
      tree.update(<VideoInfoPanel videoId="item-1" active={false} />);
    });
    expect(mockClearResumePosition).not.toHaveBeenCalled();
  });
});
