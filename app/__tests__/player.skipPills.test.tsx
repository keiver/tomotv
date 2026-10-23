/** The Apple TV skip pills cover every segment kind the viewer has not asked playback to skip on its own, and the automatic skip windows cover the rest. */
import VideoPlayerScreen from "@/app/player";
import type { PlayerTvConfig } from "@/contexts/PlayerSessionContext";
import { fetchMediaSegments, fetchNextEpisodeAutoPlay, type ItemMediaSegments } from "@/services/jellyfinApi";
import { DEFAULT_UI_PREFERENCES, updateUiPreferences } from "@/services/uiPreferences";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native", () => {
  const rn = jest.requireActual("react-native");
  Object.defineProperty(rn.Platform, "isTV", { configurable: true, value: true });
  return rn;
});
const mockParams = { videoId: "one", videoName: "First" };
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
  fetchChannelOrder: jest.fn(),
  fetchChannelWindow: jest.fn(),
  fetchVideoDetails: jest.fn(async () => null),
  setVideoFavorite: jest.fn(async () => {}),
}));
const mockLoaders = { hideGlobalLoader: jest.fn(), showGlobalLoader: jest.fn() };
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => mockLoaders }));
const mockQueue = { queue: [], currentIndex: -1, hasNext: false, nextVideo: null, advanceToNext: jest.fn(), jumpTo: jest.fn(), clear: jest.fn() };
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

const intro = { startSeconds: 0, endSeconds: 90 };
const recap = { startSeconds: 90, endSeconds: 150 };
const preview = { startSeconds: 2500, endSeconds: 2530 };
const outro = { startSeconds: 2530, endSeconds: 2600 };
const commercial = { startSeconds: 1200, endSeconds: 1320 };
const segments: ItemMediaSegments = { intro, outro, recaps: [recap], previews: [preview], commercials: [commercial] };
const pill = (title: string, window: { startSeconds: number; endSeconds: number }) => ({
  title,
  startSeconds: window.startSeconds,
  endSeconds: window.endSeconds - 1,
  seekToSeconds: window.endSeconds,
});
const lastConfig = (): PlayerTvConfig => mockSession.setTvConfig.mock.calls.at(-1)![0];

describe("tvOS skip pills and automatic skips", () => {
  let renderer: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    jest.clearAllMocks();
    updateUiPreferences({ autoSkip: DEFAULT_UI_PREFERENCES.autoSkip });
    jest.mocked(fetchNextEpisodeAutoPlay).mockResolvedValue(true);
    jest.mocked(fetchMediaSegments).mockResolvedValue(segments);
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
  });
  const mount = async () => {
    await act(async () => {
      renderer = TestRenderer.create(<VideoPlayerScreen />);
    });
  };

  it("leaves the windows undefined until the item's markers are known", async () => {
    jest.mocked(fetchMediaSegments).mockReturnValue(new Promise(() => {}));
    await mount();
    expect(lastConfig().skipWindows).toBeUndefined();
    expect(lastConfig().contextualActions).toBeUndefined();
  });

  it("by default skips commercials itself and shows a pill for every other kind", async () => {
    await mount();
    expect(lastConfig().skipWindows).toEqual([commercial]);
    expect(lastConfig().contextualActions).toEqual([pill("player.skipIntro", intro), pill("player.skipRecap", recap), pill("player.skipPreview", preview), pill("player.skipCredits", outro)]);
  });

  it("with every kind on, skips them all in time order and keeps only Skip Credits", async () => {
    updateUiPreferences({ autoSkip: { intro: true, recap: true, preview: true, commercial: true } });
    await mount();
    expect(lastConfig().skipWindows).toEqual([intro, recap, commercial, preview]);
    expect(lastConfig().contextualActions).toEqual([pill("player.skipCredits", outro)]);
  });

  it("with every kind off, skips nothing itself and shows every pill", async () => {
    updateUiPreferences({ autoSkip: { intro: false, recap: false, preview: false, commercial: false } });
    await mount();
    expect(lastConfig().skipWindows).toEqual([]);
    expect(lastConfig().contextualActions).toEqual([
      pill("player.skipIntro", intro),
      pill("player.skipRecap", recap),
      pill("player.skipPreview", preview),
      pill("player.skipCredits", outro),
      pill("player.skipCommercial", commercial),
    ]);
  });

  it("follows a setting changed while the player is open", async () => {
    await mount();
    await act(async () => updateUiPreferences({ autoSkip: { ...DEFAULT_UI_PREFERENCES.autoSkip, intro: true } }));
    expect(lastConfig().skipWindows).toEqual([intro, commercial]);
    expect(lastConfig().contextualActions).toEqual([pill("player.skipRecap", recap), pill("player.skipPreview", preview), pill("player.skipCredits", outro)]);
  });
});
