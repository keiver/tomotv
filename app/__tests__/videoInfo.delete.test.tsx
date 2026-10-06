/**
 * An admin's Delete on the panel. The DELETE can outlast the panel, and router.back() from a
 * panel already gone would pop whatever screen is on top by then.
 */
import VideoInfoScreen from "@/app/video-info";
import { InfoActionRow } from "@/components/info-action-row";
import { deleteItem, fetchItemDetails } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { Alert, type AlertButton } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const folder = { Id: "folder-1", Name: "Holidays", Type: "Folder", CanDelete: true, DateCreated: "2026-08-27T00:00:00Z" } as unknown as JellyfinItem;

const mockBack = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({ push: jest.fn(), back: mockBack, replace: jest.fn() }),
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
  fetchIsAdministrator: jest.fn(async () => true),
  isLiveChannel: () => false,
  fetchItemDetails: jest.fn(),
  fetchFolderMediaKinds: jest.fn(async () => null),
  fetchItemFolderPath: jest.fn(async () => []),
  fetchLibraryRootCount: jest.fn(async () => null),
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

async function confirmDelete(): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VideoInfoScreen />);
  });
  await act(async () => {});
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const extras = tree.root.findByType(InfoActionRow).props.extras as { key: string; onPress: () => void }[];
  act(() => extras.find((extra) => extra.key === "delete")!.onPress());
  const buttons = alert.mock.calls[0][2] as AlertButton[];
  act(() => buttons.find((button) => button.style === "destructive")!.onPress!());
  return tree;
}

describe("Video info: delete", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchItemDetails as jest.Mock).mockResolvedValue(folder);
    (useLocalSearchParams as jest.Mock).mockReturnValue({ videoId: "folder-1" });
  });
  afterEach(() => jest.restoreAllMocks());

  it("goes back once the delete finishes on an open panel", async () => {
    (deleteItem as jest.Mock).mockResolvedValue(undefined);
    await confirmDelete();
    await act(async () => {});
    expect(deleteItem).toHaveBeenCalledWith("folder-1");
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("does not go back when the panel closed before the delete finished", async () => {
    let finish!: () => void;
    (deleteItem as jest.Mock).mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const tree = await confirmDelete();
    act(() => tree.unmount());
    await act(async () => finish());
    expect(deleteItem).toHaveBeenCalledWith("folder-1");
    expect(mockBack).not.toHaveBeenCalled();
  });
});
