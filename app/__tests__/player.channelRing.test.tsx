/** The tvOS flip ring is the list the channel was tuned from, with that channel in it, and a swipe waits for it however long it takes. */
import VideoPlayerScreen from "@/app/player";
import { fetchChannelRing, fetchChannelWindow } from "@/services/jellyfinApi";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native", () => {
  const rn = jest.requireActual("react-native");
  Object.defineProperty(rn.Platform, "isTV", { configurable: true, value: true });
  return rn;
});
let mockParams: Record<string, string> = { videoId: "zz", videoName: "Stranger", live: "1" };
const mockRouter = { replace: jest.fn(), setParams: jest.fn() };
const mockNavigation = { dispatch: jest.fn(), getState: () => ({ key: "root" }) };
jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockParams, useRouter: () => mockRouter, useNavigation: () => mockNavigation }));
jest.mock("expo-linking", () => ({ addEventListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock("@/components/dismiss-pan", () => ({ DismissPan: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/player-loading-overlay", () => ({ PlayerLoadingOverlay: () => null }));
jest.mock("@/components/up-next-interstitial", () => ({ UpNextInterstitial: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/playbackProbe", () => ({ probeEmit: jest.fn() }));
jest.mock("@/services/itemArtwork", () => ({ posterUri: () => undefined, wantsPosterFrame: () => false }));
jest.mock("@/services/liveRing", () => ({ recenterLiveRing: jest.fn(), releaseLiveRing: jest.fn() }));
jest.mock("@/services/localRemux", () => ({ requestPosterFrame: jest.fn(), cancelPosterFrame: jest.fn() }));
jest.mock("@/services/syncPlayManager", () => ({ isJoined: () => false, requestNextItem: jest.fn() }));
jest.mock("@/services/libraryManager", () => ({ libraryManager: { getState: () => ({ videos: [] }) } }));
jest.mock("@/services/toast", () => ({ showToast: jest.fn() }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
const mockPreferences = { filter: "favorites", sort: "number", favorites: [{ name: "A", number: "1" }], groups: [] };
jest.mock("@/services/liveTvPreferences", () => ({
  ...jest.requireActual("@/services/liveTvPreferences"),
  getLiveTvPreferences: () => mockPreferences,
}));
jest.mock("@/services/jellyfinApi", () => ({
  fetchMediaSegments: jest.fn(async () => ({ intro: null, outro: null, commercials: [] })),
  fetchNextEpisodeAutoPlay: jest.fn(async () => true),
  fetchChannelRing: jest.fn(async () => []),
  fetchChannelWindow: jest.fn(async () => []),
  fetchVideoDetails: jest.fn(async () => null),
  setVideoFavorite: jest.fn(async () => {}),
  fetchLiveTvManagement: jest.fn(async () => false),
  fetchTimers: jest.fn(async () => []),
  fetchTimerDefaults: jest.fn(async () => ({})),
  createTimer: jest.fn(async () => {}),
  cancelTimer: jest.fn(async () => {}),
}));
const mockLoaders = { hideGlobalLoader: jest.fn(), showGlobalLoader: jest.fn() };
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => mockLoaders }));
const mockQueue = { queue: [] as { Id: string; Name: string }[], currentIndex: -1, hasNext: false, nextVideo: null, advanceToNext: jest.fn(), jumpTo: jest.fn(), clear: jest.fn() };
jest.mock("@/contexts/PlayQueueContext", () => ({ usePlayQueue: () => mockQueue }));
const mockSession = {
  requestSession: jest.fn(),
  switchLiveChannel: jest.fn(),
  releaseRoute: jest.fn(),
  stopSession: jest.fn(),
  signalRoutePresented: jest.fn(),
  setTvConfig: jest.fn(),
  setHandlers: jest.fn(),
  pause: jest.fn(),
  retry: jest.fn(),
  playbackState: { type: "PLAYING" },
  showLoadingOverlay: false,
  hasStream: true,
  sessionVideoId: "zz",
  hostMode: "video",
};
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: () => mockSession }));

const lastHandlers = () => mockSession.setHandlers.mock.calls.filter((c) => c[0]).at(-1)![0];
const list = [
  { Id: "a", Name: "A" },
  { Id: "b", Name: "B" },
];

describe("tvOS channel ring", () => {
  let renderer: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { videoId: "zz", videoName: "Stranger", live: "1" };
    jest.mocked(fetchChannelWindow).mockImplementation(async (ids) => ids.map((Id) => ({ Id, Name: Id })) as never);
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
  });
  const mount = async () => {
    await act(async () => {
      renderer = TestRenderer.create(<VideoPlayerScreen />);
    });
  };

  it("loads the ring for the list the channel was tuned from", async () => {
    jest.mocked(fetchChannelRing).mockResolvedValue(list as never);
    await mount();
    expect(fetchChannelRing).toHaveBeenCalledWith(mockPreferences);
  });

  it("a channel outside that list flips into it either way, and a flip inside it walks the list", async () => {
    jest.mocked(fetchChannelRing).mockResolvedValue(list as never);
    await mount();
    await act(async () => lastHandlers().onSkipChannel(1));
    expect(mockSession.switchLiveChannel).toHaveBeenLastCalledWith({ videoId: "a", videoName: "A" });
    await act(async () => lastHandlers().onSkipChannel(-1));
    expect(mockSession.switchLiveChannel).toHaveBeenLastCalledWith({ videoId: "b", videoName: "B" });
    mockParams = { videoId: "a", videoName: "A", live: "1" };
    await act(async () => renderer.update(<VideoPlayerScreen />));
    await act(async () => lastHandlers().onSkipChannel(1));
    expect(mockSession.switchLiveChannel).toHaveBeenLastCalledWith({ videoId: "b", videoName: "B" });
  });

  it("swipes queued before React re-renders each advance one channel", async () => {
    jest.mocked(fetchChannelRing).mockResolvedValue(list as never);
    await mount();
    const handlers = lastHandlers();
    await act(async () => {
      handlers.onSkipChannel(1);
      handlers.onSkipChannel(1);
      handlers.onSkipChannel(1);
    });
    expect(mockSession.switchLiveChannel.mock.calls.map((call) => call[0].videoId)).toEqual(["a", "b", "a"]);
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ videoId: "a", videoName: "A" });
  });

  it("swipes before the ring lands wait for it, with no deadline, and flip in order once it does", async () => {
    let land: (items: typeof list) => void = () => {};
    jest.mocked(fetchChannelRing).mockReturnValue(new Promise((resolve) => (land = resolve)) as never);
    await mount();
    await act(async () => {
      lastHandlers().onSkipChannel(1);
      lastHandlers().onSkipChannel(1);
    });
    expect(mockSession.switchLiveChannel).not.toHaveBeenCalled();
    await act(async () => land(list));
    expect(mockSession.switchLiveChannel.mock.calls.map((call) => call[0].videoId)).toEqual(["a", "b"]);
  });
});
