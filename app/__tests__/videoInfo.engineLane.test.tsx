/**
 * The one line on the panel that tells the viewer where playback will run. It states server
 * involvement, so "no server work" has to be false exactly when a server feed opens the session:
 * the engine's tier is only proved once playback starts, and the line promises nothing else.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { fetchItemDetails } from "@/services/jellyfinApi";
import { predictPlaybackLane } from "@/services/localRemux";
import type { JellyfinItem } from "@/types/jellyfin";
import VideoInfoScreen from "@/app/video-info";

const item = {
  Id: "item-1",
  Name: "Arrival",
  Type: "Movie",
  MediaStreams: [{ Type: "Video", Codec: "h264", Index: 0 }],
  UserData: { PlaybackPositionTicks: 0, Played: false },
} as unknown as JellyfinItem;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ videoId: "item-1" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
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
jest.mock("@/components/progress-button", () => ({ ProgressButton: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-blur", () => ({ BlurView: () => null }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

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

const mockFetchItemDetails = fetchItemDetails as jest.Mock;
const mockPredict = predictPlaybackLane as jest.Mock;

/** Every line the panel renders, so the assertion names the sentence, not a node path. */
async function laneLine(plan: unknown): Promise<string> {
  mockFetchItemDetails.mockResolvedValue(item);
  mockPredict.mockResolvedValue(plan);
  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VideoInfoScreen />);
  });
  const lines = tree!.root
    .findAllByType(Text)
    .flatMap((node) => (Array.isArray(node.props.children) ? node.props.children : [node.props.children]))
    .filter((child): child is string => typeof child === "string");
  return lines.find((line) => line.startsWith("Direct Play") || line.startsWith("Re-encoded") || line.startsWith("Transcoded")) ?? "";
}

describe("the engine line on the item panel", () => {
  beforeEach(() => jest.clearAllMocks());

  it("promises no server work for a file the device copies over a link that carries it", async () => {
    expect(await laneLine({ lane: "copy", smallFeedFirst: false })).toBe("Direct Play · no server work");
  });

  it("says a smaller server feed opens the session when the link cannot carry the file", async () => {
    expect(await laneLine({ lane: "copy", smallFeedFirst: true })).toBe("Direct Play · starts on a smaller server feed for your connection");
  });

  it("carries the same tail on the device's own re-encode", async () => {
    expect(await laneLine({ lane: "deviceTranscode", smallFeedFirst: false })).toBe("Re-encoded on this device · no server work");
    expect(await laneLine({ lane: "deviceTranscode", smallFeedFirst: true })).toBe("Re-encoded on this device · starts on a smaller server feed for your connection");
  });

  it("names the server outright when the whole file goes through it", async () => {
    expect(await laneLine({ lane: "server", smallFeedFirst: false })).toBe("Transcoded by the server");
  });

  it("says nothing at all until the lane is known", async () => {
    expect(await laneLine(null)).toBe("");
  });
});
