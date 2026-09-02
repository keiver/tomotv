/**
 * Remove Progress arms a write that the play paths commit. The press has to wait for it:
 * openItem reads the resume ticks off the item object it is handed, and a DELETE still in
 * flight resets the position the player has already begun reporting.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useLocalSearchParams } from "expo-router";
import VideoInfoScreen from "@/app/video-info";
import { clearResumePosition, fetchItemDetails } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";

const RESUME_TICKS = 6_000_000_000;

const item = {
  Id: "item-1",
  Name: "Arrival",
  Type: "Movie",
  Path: "/media/arrival.mkv",
  RunTimeTicks: 60_000_000_000,
  MediaStreams: [],
  UserData: { PlaybackPositionTicks: RESUME_TICKS, Played: false },
} as unknown as JellyfinItem;

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/services/localRemux", () => ({
  predictPlaybackLane: jest.fn(async () => null),
  posterFrameIfCached: jest.fn(() => undefined),
  requestPosterFrame: jest.fn(async () => null),
  cancelPosterFrame: jest.fn(),
}));
jest.mock("@/hooks/useFolderPlay", () => ({ useFolderPlay: () => jest.fn() }));
jest.mock("@/hooks/useShowInFolder", () => ({ useShowInFolder: () => jest.fn() }));
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

/** The play CTA, captured so a test can press it without walking the tree. */
/** handlePlay is async, so the press is awaited rather than left to a timer to flush. */
let playPress: (() => void | Promise<void>) | null = null;
jest.mock("@/components/progress-button", () => ({
  ProgressButton: (props: { onPress: () => void | Promise<void> }) => {
    playPress = props.onPress;
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
  isPhoto: () => false,
  notifyResumeChange: jest.fn(),
  setVideoFavorite: jest.fn(async () => {}),
  setVideoPlayed: jest.fn(async () => {}),
}));

/** What handlePlay hands the player. */
const opened: JellyfinItem[] = [];
/** Call order, so "the DELETE landed first" is asserted rather than assumed. */
const order: string[] = [];
jest.mock("@/hooks/useOpenShelfItem", () => ({
  useOpenShelfItem: () => (item: JellyfinItem) => {
    order.push("open");
    opened.push(item);
  },
}));

const mockFetchItemDetails = fetchItemDetails as jest.Mock;
const mockClearResumePosition = clearResumePosition as jest.Mock;
const mockParams = useLocalSearchParams as jest.Mock;

/** Mount the panel on `item` and arm the removal the way the action row does. */
async function mountArmed(arm: boolean) {
  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VideoInfoScreen />);
  });
  if (arm) {
    const row = tree!.root.findByType(require("@/components/info-action-row").InfoActionRow);
    await act(async () => {
      row.props.onToggleProgress();
    });
  }
  return tree!;
}

describe("Video info: play after Remove Progress", () => {
  beforeEach(() => {
    playPress = null;
    opened.length = 0;
    order.length = 0;
    jest.clearAllMocks();
    mockParams.mockReturnValue({ videoId: "item-1", fromResume: "true" });
    mockFetchItemDetails.mockResolvedValue(item);
    // Resolves a tick late, so "the DELETE finished first" is what the order asserts
    // rather than "the call was made first" (which an un-awaited call satisfies too).
    mockClearResumePosition.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      order.push("delete");
    });
  });

  it("clears the server before opening the player, and opens at zero", async () => {
    await mountArmed(true);
    await act(async () => {
      await playPress!();
    });

    expect(mockClearResumePosition).toHaveBeenCalledWith("item-1");
    expect(order).toEqual(["delete", "open"]);
    expect(opened).toHaveLength(1);
    expect(opened[0].UserData?.PlaybackPositionTicks).toBe(0);
    expect(opened[0].UserData?.Played).toBe(false);
  });

  it("keeps the resume point when the clear is refused", async () => {
    mockClearResumePosition.mockRejectedValue(new Error("500"));
    await mountArmed(true);
    await act(async () => {
      await playPress!();
    });

    expect(opened).toHaveLength(1);
    expect(opened[0].UserData?.PlaybackPositionTicks).toBe(RESUME_TICKS);
  });

  it("writes nothing and resumes when the removal was never armed", async () => {
    await mountArmed(false);
    await act(async () => {
      await playPress!();
    });

    expect(mockClearResumePosition).not.toHaveBeenCalled();
    expect(opened[0].UserData?.PlaybackPositionTicks).toBe(RESUME_TICKS);
  });
});
