/**
 * Show in Folder on an episode of a virtual season: the ancestor walk ends at the series, while
 * the season screen the press came from is the episode's ParentId.
 */
import VideoInfoScreen from "@/app/video-info";
import { fetchItemDetails, fetchItemFolderPath } from "@/services/jellyfinApi";
import { t } from "@/services/i18n";
import type { JellyfinItem } from "@/types/jellyfin";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const episode = {
  Id: "episode-15",
  Name: "Episode 15",
  Type: "Episode",
  ParentId: "season-3",
  SeasonId: "season-3",
  SeriesId: "series-1",
} as unknown as JellyfinItem;

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
jest.mock("@/components/info-focus-row", () => ({ InfoFocusRow: () => null }));
jest.mock("@/components/progress-button", () => ({ ProgressButton: () => null }));
jest.mock("expo-image", () => ({ Image: Object.assign(() => null, { loadAsync: async () => ({ width: 16, height: 9 }) }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const mockLabels: string[] = [];
jest.mock("@/components/FocusableButton", () => ({
  FocusableButton: (props: { title: string }) => {
    mockLabels.push(props.title);
    return null;
  },
}));
jest.mock("@/components/info-action-row", () => ({
  InfoActionRow: (props: { extras?: { label: string }[] }) => {
    mockLabels.push(...(props.extras ?? []).map((extra) => extra.label));
    return null;
  },
}));

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

const mockParams = useLocalSearchParams as jest.Mock;
const mockDetails = fetchItemDetails as jest.Mock;
const mockFolderPath = fetchItemFolderPath as jest.Mock;

async function offersShowInFolder(params: Record<string, string>): Promise<boolean> {
  mockParams.mockReturnValue(params);
  await act(async () => {
    TestRenderer.create(<VideoInfoScreen />);
  });
  return mockLabels.includes(t("info.showInFolder"));
}

describe("Video info: Show in Folder", () => {
  beforeEach(() => {
    mockLabels.length = 0;
    jest.clearAllMocks();
    mockDetails.mockResolvedValue(episode);
    mockFolderPath.mockResolvedValue([
      { id: "library-1", name: "Shows", type: "folder" },
      { id: "series-1", name: "Series", type: "folder" },
    ]);
  });

  it("hides it when opened from the season the episode belongs to, though the ancestor walk ends at the series", async () => {
    expect(await offersShowInFolder({ videoId: "episode-15", inFolderId: "season-3" })).toBe(false);
  });

  it("hides it when opened from the last folder of the ancestor walk", async () => {
    expect(await offersShowInFolder({ videoId: "episode-15", inFolderId: "series-1" })).toBe(false);
  });

  it("shows it when opened from another folder", async () => {
    expect(await offersShowInFolder({ videoId: "episode-15", inFolderId: "season-4" })).toBe(true);
  });

  it("shows it when opened from a shelf, with no folder, on an item without a ParentId", async () => {
    mockDetails.mockResolvedValue({ ...episode, ParentId: undefined });
    expect(await offersShowInFolder({ videoId: "episode-15" })).toBe(true);
  });
});
