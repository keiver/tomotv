/** On Apple TV a channel's info panel shows the channel's last grabbed picture in the art area, with its preview clip over it. */
import type { JellyfinItem } from "@/types/jellyfin";
import React from "react";
import { Platform } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const channel = { Id: "ch-1", Name: "Channel One", Type: "TvChannel", ImageTags: {} } as unknown as JellyfinItem;
const frame = { uri: "file:///frames/ch-1.jpg", cacheKey: "ch-1-1" };
const clip = { uri: "file:///frames/ch-1.mp4", cacheKey: "ch-1-clip-1" };

let mockFrame: typeof frame | undefined;
let mockClip: typeof clip | undefined;

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
jest.mock("@/hooks/useLiveTvManagement", () => ({ useLiveTvManagement: () => false }));
jest.mock("@/hooks/useLiveFrame", () => ({ useLiveFrame: (id: string) => (id ? mockFrame : undefined), useLiveClip: (id: string) => (id ? mockClip : undefined) }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ autoUpdate: true }) }));
jest.mock("@/hooks/usePlaybackHeld", () => ({ usePlaybackHeld: () => false }));
jest.mock("@/services/nextUp", () => ({ containerKey: () => null, dismissNextUpContainer: jest.fn() }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn(), hideGlobalLoader: jest.fn() }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/info-action-row", () => ({ InfoActionRow: () => null }));
jest.mock("@/components/info-focus-row", () => ({ InfoFocusRow: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/progress-button", () => ({ ProgressButton: () => null }));
jest.mock("@/components/live-tv/channel-group-band", () => ({ ChannelGroupBand: () => null }));
jest.mock("@/components/live-tv/channel-group-section", () => ({ ChannelGroupSection: () => null }));
jest.mock("@/components/live-tv/live-clip", () => ({ LiveClip: () => null }));
jest.mock("expo-image", () => ({ Image: Object.assign(() => null, { loadAsync: async () => ({ width: 16, height: 9 }) }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/jellyfinApi", () => ({
  subscribeAuthChange: jest.fn(() => () => {}),
  clearResumePosition: jest.fn(async () => {}),
  deleteItem: jest.fn(async () => {}),
  fetchIsAdministrator: jest.fn(async () => false),
  isLiveChannel: (item: { Type?: string }) => item.Type === "TvChannel",
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

Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
// Read after the flag: the panel fixes its platform at import.
const { VideoInfoPanel } = require("@/components/video-info-panel") as typeof import("@/components/video-info-panel");
const { fetchItemDetails } = require("@/services/jellyfinApi");
const { Image } = require("expo-image");
const { LiveClip } = require("@/components/live-tv/live-clip");

async function mount() {
  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VideoInfoPanel videoId="ch-1" />);
  });
  return tree!;
}

const shownSources = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Image).map((node) => node.props.source);

describe("Video info panel on Apple TV: a channel's live picture", () => {
  beforeEach(() => {
    (fetchItemDetails as jest.Mock).mockResolvedValue(channel);
    mockFrame = frame;
    mockClip = clip;
  });

  it("plays the clip over the grabbed picture", async () => {
    const tree = await mount();
    expect(shownSources(tree)).toContainEqual(frame);
    expect(tree.root.findByType(LiveClip).props.clip).toBe(clip);
  });

  it("shows the grabbed picture with no clip when the channel has none", async () => {
    mockClip = undefined;
    const tree = await mount();
    expect(shownSources(tree)).toContainEqual(frame);
    expect(tree.root.findAllByType(LiveClip)).toHaveLength(0);
  });

  it("keeps the brand face when no picture was grabbed", async () => {
    mockFrame = undefined;
    mockClip = undefined;
    const tree = await mount();
    expect(shownSources(tree)).not.toContainEqual(frame);
  });
});
