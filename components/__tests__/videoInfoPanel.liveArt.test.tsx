/**
 * A channel's info panel shows the channel's last grabbed picture in the art area, with its preview
 * clip over it while the panel is the shown one.
 */
import { VideoInfoPanel } from "@/components/video-info-panel";
import { fetchItemDetails } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import { formatClock } from "@/utils/guide";
import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const MOCK_SEEN_AT = Date.UTC(2026, 9, 19, 20, 42);
const channel = { Id: "ch-1", Name: "Channel One", Type: "TvChannel", ImageTags: {} } as unknown as JellyfinItem;
const frame = { uri: "file:///frames/ch-1.jpg", cacheKey: "ch-1-1" };
const clip = { uri: "file:///frames/ch-1.mp4", cacheKey: "ch-1-clip-1" };

let mockFrame: typeof frame | undefined;
let mockClip: typeof clip | undefined;
let mockAutoUpdate = true;
let mockHeld = false;

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
jest.mock("@/hooks/useLiveFrame", () => ({
  useLiveFrame: (id: string) => (id ? mockFrame : undefined),
  useLiveClip: (id: string) => (id ? mockClip : undefined),
  useLiveFrameSeenAt: (id: string) => (id && mockFrame ? MOCK_SEEN_AT : 0),
}));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ autoUpdate: mockAutoUpdate }) }));
jest.mock("@/hooks/usePlaybackHeld", () => ({ usePlaybackHeld: () => mockHeld }));
jest.mock("@/services/nextUp", () => ({ containerKey: () => null, dismissNextUpContainer: jest.fn() }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn(), hideGlobalLoader: jest.fn() }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/info-action-row", () => ({ InfoActionRow: () => null }));
jest.mock("@/components/info-focus-row", () => ({ InfoFocusRow: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/progress-button", () => ({ ProgressButton: () => null }));
jest.mock("@/components/live-tv/channel-group-band", () => ({ ChannelGroupBand: () => null }));
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

const { Image } = require("expo-image");
const { LiveClip } = require("@/components/live-tv/live-clip");

async function mount(active = true) {
  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VideoInfoPanel videoId="ch-1" active={active} />);
  });
  return tree!;
}

const shownSources = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Image).map((node) => node.props.source);
const texts = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Text).map((node) => node.props.children);

describe("Video info panel: a channel's live picture", () => {
  beforeEach(() => {
    (fetchItemDetails as jest.Mock).mockResolvedValue(channel);
    mockFrame = frame;
    mockClip = clip;
    mockAutoUpdate = true;
    mockHeld = false;
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

  it("plays no clip on a panel waiting beside the shown one", async () => {
    const tree = await mount(false);
    expect(shownSources(tree)).toContainEqual(frame);
    expect(tree.root.findAllByType(LiveClip)).toHaveLength(0);
  });

  it("plays no clip with auto update off or while playback holds the link", async () => {
    mockAutoUpdate = false;
    expect((await mount()).root.findAllByType(LiveClip)).toHaveLength(0);
    mockAutoUpdate = true;
    mockHeld = true;
    expect((await mount()).root.findAllByType(LiveClip)).toHaveLength(0);
  });

  it("shows the channel's groups as the footer band, rounded to the card's corners on iPhone", async () => {
    const tree = await mount();
    const band = tree.root.findByType(require("@/components/live-tv/channel-group-band").ChannelGroupBand);
    expect(band.props.channel).toEqual(expect.objectContaining({ Id: "ch-1", Name: "Channel One" }));
    expect(band.props.cornerRadius).toBe(require("@/components/pad-sheet").PAD_CARD_RADIUS);
  });

  it("keeps the brand face when no picture was grabbed", async () => {
    mockFrame = undefined;
    mockClip = undefined;
    const tree = await mount();
    expect(shownSources(tree)).not.toContainEqual(frame);
    expect(tree.root.findAllByType(Image)).toHaveLength(1);
  });

  it("names when the picture was seen after the channel number", async () => {
    (fetchItemDetails as jest.Mock).mockResolvedValue({ ...channel, ChannelNumber: "4" });
    expect(texts(await mount())).toContain(`CH 4 · Seen at ${formatClock(MOCK_SEEN_AT)}`);
  });

  it("names when the picture was seen alone when the channel has no number", async () => {
    expect(texts(await mount())).toContain(`Seen at ${formatClock(MOCK_SEEN_AT)}`);
  });

  it("says no seen time when no picture was grabbed", async () => {
    mockFrame = undefined;
    (fetchItemDetails as jest.Mock).mockResolvedValue({ ...channel, ChannelNumber: "4" });
    const shown = texts(await mount());
    expect(shown).toContain("CH 4");
    expect(shown.some((text) => typeof text === "string" && text.includes("Seen at"))).toBe(false);
  });
});
