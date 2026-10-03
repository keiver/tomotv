import VideoPlayerScreen from "@/app/player";
import type { PlayerSessionHandlers } from "@/contexts/PlayerSessionContext";
import { fetchMediaSegments, fetchNextEpisodeAutoPlay } from "@/services/jellyfinApi";
import { StackRouter, type StackActionType, type StackNavigationState, type ParamListBase } from "expo-router/react-navigation";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native", () => {
  const rn = jest.requireActual("react-native");
  Object.defineProperty(rn.Platform, "isTV", { configurable: true, value: true });
  return rn;
});
let mockParams = { videoId: "one", videoName: "First", queueMode: "true" };
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
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
jest.mock("@/services/jellyfinApi", () => ({
  fetchMediaSegments: jest.fn(),
  fetchNextEpisodeAutoPlay: jest.fn(),
  fetchChannelRing: jest.fn(),
  fetchChannelWindow: jest.fn(),
  fetchVideoDetails: jest.fn(async () => null),
  setVideoFavorite: jest.fn(async () => {}),
}));
const mockLoaders = { hideGlobalLoader: jest.fn(), showGlobalLoader: jest.fn() };
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => mockLoaders }));
const mockQueue = {
  queue: [
    { Id: "one", Name: "First", RunTimeTicks: 600_000_000 },
    { Id: "two", Name: "Second" },
  ],
  currentIndex: 0,
  hasNext: true,
  nextVideo: { Id: "two", Name: "Second" },
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

const routeNames = ["(tabs)", "[folderId]", "player"];
const rootState = (keys: string[]) =>
  ({
    key: "root",
    type: "stack",
    stale: false,
    index: keys.length - 1,
    routeNames,
    preloadedRoutes: [],
    routes: keys.map((key) => ({ key, name: key === "player" ? "player" : key === "tabs" ? "(tabs)" : "[folderId]" })),
  }) as StackNavigationState<ParamListBase>;
const keysAfter = (action: StackActionType, keys: string[]) => {
  const next = StackRouter({}).getStateForAction(rootState(keys), action, { routeNames, routeParamList: {}, routeGetIdList: {} });
  return next ? next.routes.map((route) => route.key) : keys;
};

describe("Menu out of the player", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(fetchNextEpisodeAutoPlay).mockResolvedValue(true);
    jest.mocked(fetchMediaSegments).mockResolvedValue({ intro: null, outro: null, commercials: [] });
  });

  it("pops the player and never the folder beneath it, when UIKit already popped it", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<VideoPlayerScreen />);
    });
    const handlers: PlayerSessionHandlers = mockSession.setHandlers.mock.calls.at(-1)![0];
    await act(async () => handlers.onRequestBack());
    // The screen's own dispatch stamps `source` with its route key.
    const action = { ...mockNavigation.dispatch.mock.calls[0][0], source: "player" };

    expect(keysAfter(action, ["tabs", "library", "series", "season", "player"])).toEqual(["tabs", "library", "series", "season"]);
    expect(keysAfter(action, ["tabs", "library", "series", "season"])).toEqual(["tabs", "library", "series", "season"]);
    await act(async () => renderer.unmount());
  });
});
