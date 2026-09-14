import VideoPlayerScreen from "@/app/player";
import type { PlayerTvConfig } from "@/contexts/PlayerSessionContext";
import { fetchMediaSegments, fetchNextEpisodeAutoPlay, type ItemMediaSegments } from "@/services/jellyfinApi";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native", () => {
  const rn = jest.requireActual("react-native");
  Object.defineProperty(rn.Platform, "isTV", { configurable: true, value: true });
  return rn;
});
let mockParams = { videoId: "one", videoName: "First", queueMode: "true" };
const mockRouter = { replace: jest.fn(), setParams: jest.fn() };
const mockNavigation = { canGoBack: jest.fn(() => true), goBack: jest.fn() };
jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockParams, useRouter: () => mockRouter, useNavigation: () => mockNavigation }));
jest.mock("expo-linking", () => ({ addEventListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock("@/components/dismiss-pan", () => ({ DismissPan: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/player-loading-overlay", () => ({ PlayerLoadingOverlay: () => null }));
jest.mock("@/components/up-next-interstitial", () => ({ UpNextInterstitial: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/hooks/usePlaybackStage", () => ({ stageLabel: () => "" }));
jest.mock("@/services/playbackStage", () => ({ currentPlaybackStage: () => ({ stage: null }) }));
jest.mock("@/services/playbackProbe", () => ({ probeEmit: jest.fn() }));
jest.mock("@/services/itemArtwork", () => ({ posterUri: () => undefined, wantsPosterFrame: () => false }));
jest.mock("@/services/liveRing", () => ({ recenterLiveRing: jest.fn(), releaseLiveRing: jest.fn() }));
jest.mock("@/services/localRemux", () => ({ requestPosterFrame: jest.fn(), cancelPosterFrame: jest.fn() }));
jest.mock("@/services/syncPlayManager", () => ({ isJoined: () => false, requestNextItem: jest.fn() }));
jest.mock("@/services/libraryManager", () => ({ libraryManager: { getState: () => ({ videos: [] }) } }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
jest.mock("@/services/jellyfinApi", () => ({ fetchMediaSegments: jest.fn(), fetchNextEpisodeAutoPlay: jest.fn(), fetchChannels: jest.fn() }));
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

const markers = (startSeconds: number): ItemMediaSegments => ({ intro: null, outro: { startSeconds, endSeconds: 60 } });
const noMarkers: ItemMediaSegments = { intro: null, outro: null };
const lastConfig = (): PlayerTvConfig => mockSession.setTvConfig.mock.calls.at(-1)![0];

describe("tvOS Up Next timing", () => {
  let renderer: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { videoId: "one", videoName: "First", queueMode: "true" };
    jest.mocked(fetchNextEpisodeAutoPlay).mockResolvedValue(true);
    jest.mocked(fetchMediaSegments).mockResolvedValue(noMarkers);
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
  });
  const mount = async () => {
    await act(async () => {
      renderer = TestRenderer.create(<VideoPlayerScreen />);
    });
  };

  it.each([true, false])("uses the Outro start with autoplay=%s", async (enabled) => {
    jest.mocked(fetchNextEpisodeAutoPlay).mockResolvedValue(enabled);
    jest.mocked(fetchMediaSegments).mockResolvedValue(markers(47.25));
    await mount();
    expect(lastConfig().contentProposal).toEqual({ title: "Second", startTimeSeconds: 47.25, ...(enabled ? { autoAcceptSeconds: 5 } : {}) });
  });

  it("keeps a proposal at playback end without guessing credits from runtime", async () => {
    await mount();
    expect(lastConfig().contentProposal).toEqual({ title: "Second", autoAcceptSeconds: 5 });
  });

  it.each([0, -1, NaN, Infinity])("uses playback end for an unusable Outro start (%s)", async (start) => {
    jest.mocked(fetchMediaSegments).mockResolvedValue(markers(start));
    await mount();
    expect(lastConfig().contentProposal).not.toHaveProperty("startTimeSeconds");
  });

  it("drops the previous item's marker immediately while the new request is pending", async () => {
    let resolveSecond!: (value: ItemMediaSegments) => void;
    jest
      .mocked(fetchMediaSegments)
      .mockResolvedValueOnce(markers(47))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    await mount();
    expect(lastConfig().contentProposal?.startTimeSeconds).toBe(47);
    await act(async () => {
      mockParams = { ...mockParams, videoId: "two" };
      renderer.update(<VideoPlayerScreen />);
    });
    expect(lastConfig().contentProposal).not.toHaveProperty("startTimeSeconds");
    await act(async () => resolveSecond(markers(52)));
    expect(lastConfig().contentProposal?.startTimeSeconds).toBe(52);
  });

  it("ignores a late response for an item that has been left", async () => {
    let resolveFirst!: (value: ItemMediaSegments) => void;
    jest
      .mocked(fetchMediaSegments)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(markers(52));
    await mount();
    await act(async () => {
      mockParams = { ...mockParams, videoId: "two" };
      renderer.update(<VideoPlayerScreen />);
    });
    await act(async () => resolveFirst(markers(47)));
    expect(lastConfig().contentProposal?.startTimeSeconds).toBe(52);
  });
});
