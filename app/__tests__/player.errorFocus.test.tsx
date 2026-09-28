/** The error screen claims focus for Retry until a button holds it, whichever order focus and blur arrive in. */
import VideoPlayerScreen from "@/app/player";
import { fetchMediaSegments, fetchNextEpisodeAutoPlay } from "@/services/jellyfinApi";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native", () => {
  const rn = jest.requireActual("react-native");
  Object.defineProperty(rn.Platform, "isTV", { configurable: true, value: true });
  return rn;
});
let mockParams: Record<string, string> = { videoId: "one", videoName: "First" };
const mockRouter = { replace: jest.fn(), setParams: jest.fn() };
const mockNavigation = { canGoBack: jest.fn(() => true), goBack: jest.fn() };
jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockParams, useRouter: () => mockRouter, useNavigation: () => mockNavigation }));
jest.mock("expo-linking", () => ({ addEventListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock("@/components/dismiss-pan", () => ({ DismissPan: () => null }));
const mockRequestTVFocus = jest.fn();
jest.mock("@/components/FocusableButton", () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual("react");
  return {
    FocusableButton: forwardRef((_props: unknown, ref: unknown) => {
      useImperativeHandle(ref, () => ({ requestTVFocus: mockRequestTVFocus }));
      return null;
    }),
  };
});
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
  fetchChannels: jest.fn(async () => ({ items: [] })),
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
  playbackState: { type: "ERROR", error: "boom", canRetryWithTranscode: false } as Record<string, unknown>,
  showLoadingOverlay: false,
  hasStream: true,
  sessionVideoId: "one",
  hostMode: "video",
};
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: () => mockSession }));

const { FocusableButton } = jest.requireMock("@/components/FocusableButton") as { FocusableButton: React.ComponentType };
type ButtonProps = { title: string; onFocus: () => void; onBlur: () => void };
const button = (renderer: TestRenderer.ReactTestRenderer, title: string) =>
  renderer.root.findAllByType(FocusableButton).find((node) => (node.props as ButtonProps).title === title)!.props as ButtonProps;

describe("error screen focus claim", () => {
  let renderer: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockParams = { videoId: "one", videoName: "First" };
    jest.mocked(fetchNextEpisodeAutoPlay).mockResolvedValue(true);
    jest.mocked(fetchMediaSegments).mockResolvedValue({ intro: null, outro: null });
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    jest.useRealTimers();
  });
  const mount = async () => {
    await act(async () => {
      renderer = TestRenderer.create(<VideoPlayerScreen />);
    });
  };
  const claimsAfter = async (move: () => void) => {
    await act(async () => move());
    mockRequestTVFocus.mockClear();
    await act(async () => jest.advanceTimersByTime(1_000));
    return mockRequestTVFocus.mock.calls.length;
  };

  it("claims Retry until a button takes focus", async () => {
    await mount();
    await act(async () => jest.advanceTimersByTime(300));
    expect(mockRequestTVFocus).toHaveBeenCalled();
    expect(await claimsAfter(() => button(renderer, "common.retry").onFocus())).toBe(0);
  });

  it("leaves Go Back alone when its focus lands before Retry's blur", async () => {
    await mount();
    const moved = await claimsAfter(() => {
      button(renderer, "common.retry").onFocus();
      button(renderer, "common.goBack").onFocus();
      button(renderer, "common.retry").onBlur();
    });
    expect(moved).toBe(0);
  });

  it("leaves Go Back alone when Retry's blur lands first", async () => {
    await mount();
    const moved = await claimsAfter(() => {
      button(renderer, "common.retry").onFocus();
      button(renderer, "common.retry").onBlur();
      button(renderer, "common.goBack").onFocus();
    });
    expect(moved).toBe(0);
  });
});
