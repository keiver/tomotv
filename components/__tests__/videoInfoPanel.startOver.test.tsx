/** The Play button of a part-watched film also offers Start Over by name, since its press-and-hold has no VoiceOver gesture. */
import { VideoInfoPanel } from "@/components/video-info-panel";
import { ProgressButton } from "@/components/progress-button";
import { fetchItemDetails } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import React from "react";
import { Alert } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const film = { Id: "m-1", Name: "A Film", Type: "Movie", ImageTags: {}, MediaStreams: [] } as unknown as JellyfinItem;
const started = { ...film, UserData: { PlaybackPositionTicks: 600_000_000 } } as unknown as JellyfinItem;
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };

jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
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
jest.mock("@/hooks/useSubtitlePanel", () => ({ useSubtitlePanel: () => ({ available: true, open: jest.fn(), offsetMs: 0 }) }));
jest.mock("@/hooks/useLiveFrame", () => ({ useLiveFrame: () => undefined, useLiveClip: () => undefined, useLiveFrameSeenAt: () => 0 }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ autoUpdate: false }) }));
jest.mock("@/hooks/usePlaybackHeld", () => ({ usePlaybackHeld: () => false }));
jest.mock("@/hooks/useChannelHealth", () => ({ useChannelHealth: () => "unknown" }));
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
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/jellyfin/channelEdits", () => ({ invalidateChannelListReads: jest.fn(), withChannelEdits: (item: unknown) => item }));
jest.mock("@/services/liveTvPreferences", () => ({ ...jest.requireActual("@/services/liveTvPreferences"), hideChannel: jest.fn(), renameChannel: jest.fn() }));
jest.mock("@/services/jellyfinApi", () => ({
  subscribeAuthChange: jest.fn(() => () => {}),
  subscribeSubtitlesChanged: jest.fn(() => () => {}),
  clearResumePosition: jest.fn(async () => {}),
  deleteItem: jest.fn(async () => {}),
  fetchIsAdministrator: jest.fn(async () => false),
  isLiveChannel: (item: { Type?: string }) => item.Type === "TvChannel",
  fetchItemDetails: jest.fn(),
  fetchVideoDetails: jest.fn(async () => null),
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

async function playButtonFor(item: JellyfinItem) {
  (fetchItemDetails as jest.Mock).mockResolvedValue(item);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VideoInfoPanel videoId={item.Id} active />);
  });
  const [button] = tree.root.findAllByType(ProgressButton);
  return { props: button.props, unmount: () => act(async () => tree.unmount()) };
}

describe("Video info panel: Start Over by name", () => {
  beforeEach(() => jest.clearAllMocks());

  it("a part-watched film's Play button offers Start Over, which asks before starting over", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { props, unmount } = await playButtonFor(started);
    expect(props.accessibilityActions).toEqual([{ name: "startOver", label: "info.startOver" }]);
    props.onAccessibilityAction({ nativeEvent: { actionName: "startOver" } });
    expect(alert).toHaveBeenCalledWith("A Film", "info.startOverConfirm", expect.any(Array));
    await unmount();
  });

  it("an unwatched film's Play button offers no named action", async () => {
    const { props, unmount } = await playButtonFor(film);
    expect(props.accessibilityActions).toBeUndefined();
    await unmount();
  });
});
