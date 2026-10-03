/** The transport bar favorite flips its title at the press, VOD and live, like the record CTA. */
import VideoPlayerScreen from "@/app/player";
import type { PlayerTvConfig } from "@/contexts/PlayerSessionContext";
import { fetchChannelRing, fetchChannelWindow, fetchLiveTvManagement, fetchMediaSegments, fetchNextEpisodeAutoPlay, fetchTimers, fetchVideoDetails } from "@/services/jellyfinApi";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native", () => {
  const rn = jest.requireActual("react-native");
  Object.defineProperty(rn.Platform, "isTV", { configurable: true, value: true });
  return rn;
});
let mockParams: Record<string, string> = { videoId: "one", videoName: "First" };
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
jest.mock("@/services/jellyfinApi", () => ({
  fetchMediaSegments: jest.fn(),
  fetchNextEpisodeAutoPlay: jest.fn(),
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
const mockQueue = {
  queue: [] as { Id: string; Name: string }[],
  currentIndex: -1,
  hasNext: false,
  nextVideo: null,
  advanceToNext: jest.fn(),
  jumpTo: jest.fn(),
  clear: jest.fn(),
};
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
  sessionVideoId: "one",
  hostMode: "video",
};
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: () => mockSession }));

const lastConfig = (): PlayerTvConfig => mockSession.setTvConfig.mock.calls.at(-1)![0];
const lastHandlers = () => mockSession.setHandlers.mock.calls.filter((c) => c[0]).at(-1)![0];
const favoriteButton = () => lastConfig().transportBarButtons?.find((b: { id: string }) => b.id === "favorite");

describe("transport bar favorite flip", () => {
  let renderer: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(fetchNextEpisodeAutoPlay).mockResolvedValue(true);
    jest.mocked(fetchMediaSegments).mockResolvedValue({ intro: null, outro: null, commercials: [] });
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
  });
  const mount = async () => {
    await act(async () => {
      renderer = TestRenderer.create(<VideoPlayerScreen />);
    });
  };

  it("VOD: the press flips the title to remove", async () => {
    mockParams = { videoId: "one", videoName: "First" };
    jest.mocked(fetchVideoDetails).mockResolvedValue({ Id: "one", UserData: { IsFavorite: false } } as never);
    await mount();
    expect(favoriteButton()).toMatchObject({ title: "info.addFavorite", sfSymbol: "heart" });
    await act(async () => lastHandlers().onTransportBarButtonSelected({ id: "favorite" }));
    expect(favoriteButton()).toMatchObject({ title: "info.removeFavorite", sfSymbol: "heart.fill" });
  });

  it("live: the press flips the title to remove", async () => {
    mockParams = { videoId: "ch1", videoName: "News", live: "1" };
    mockSession.sessionVideoId = "ch1";
    const names: Record<string, string> = { ch1: "News", ch2: "Sports" };
    jest.mocked(fetchChannelRing).mockResolvedValue([
      { Id: "ch1", Name: "News" },
      { Id: "ch2", Name: "Sports" },
    ] as never);
    jest.mocked(fetchChannelWindow).mockImplementation(async (ids) => ids.map((Id) => ({ Id, Name: names[Id] })) as never);
    jest.mocked(fetchLiveTvManagement).mockResolvedValue(false);
    jest.mocked(fetchTimers).mockResolvedValue([]);
    await mount();
    expect(fetchChannelWindow).toHaveBeenLastCalledWith(["ch2", "ch1"]);
    expect(favoriteButton()).toMatchObject({ title: "info.addFavorite", sfSymbol: "heart" });
    await act(async () => lastHandlers().onTransportBarButtonSelected({ id: "favorite" }));
    expect(favoriteButton()).toMatchObject({ title: "info.removeFavorite", sfSymbol: "heart.fill" });
  });

  it("live: the heart and Record come off the playing channel's own read, even when the lineup order fails", async () => {
    mockParams = { videoId: "ch9", videoName: "Weather", live: "1", ts: "1" };
    mockSession.sessionVideoId = "ch9";
    jest.mocked(fetchChannelRing).mockRejectedValue(new Error("timeout"));
    jest.mocked(fetchChannelWindow).mockResolvedValue([{ Id: "ch9", Name: "Weather" }] as never);
    jest.mocked(fetchLiveTvManagement).mockResolvedValue(true);
    jest.mocked(fetchTimers).mockResolvedValue([]);
    await mount();
    expect(fetchChannelWindow).toHaveBeenCalledWith(["ch9"]);
    expect(favoriteButton()).toMatchObject({ title: "info.addFavorite", sfSymbol: "heart" });
    expect(lastConfig().transportBarButtons?.find((b: { id: string }) => b.id === "record")).toMatchObject({ title: "liveTv.record" });
  });
});
