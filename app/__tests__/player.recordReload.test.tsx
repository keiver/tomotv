/** The transport bar record CTA: a write that lands keeps its flip even when the re-read fails, and a Stop on that stand-in reads first. */
import VideoPlayerScreen from "@/app/player";
import type { PlayerTvConfig } from "@/contexts/PlayerSessionContext";
import { cancelTimer, createTimer, fetchChannels, fetchLiveTvManagement, fetchMediaSegments, fetchNextEpisodeAutoPlay, fetchTimerDefaults, fetchTimers } from "@/services/jellyfinApi";
import { Alert } from "react-native";
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
  playbackState: { type: "PLAYING" },
  showLoadingOverlay: false,
  hasStream: true,
  sessionVideoId: "one",
  hostMode: "video",
};
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: () => mockSession }));

const lastConfig = (): PlayerTvConfig => mockSession.setTvConfig.mock.calls.at(-1)![0];
const lastHandlers = () => mockSession.setHandlers.mock.calls.filter((c) => c[0]).at(-1)![0];
const recordButton = () => lastConfig().transportBarButtons?.find((b: { id: string }) => b.id === "record");

describe("transport bar record after a failed re-read", () => {
  let renderer: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockParams = { videoId: "ch1", videoName: "News", live: "1" };
    mockSession.sessionVideoId = "ch1";
    jest.mocked(fetchNextEpisodeAutoPlay).mockResolvedValue(true);
    jest.mocked(fetchMediaSegments).mockResolvedValue({ intro: null, outro: null });
    jest.mocked(fetchChannels).mockResolvedValue({ items: [{ Id: "ch1", Name: "News" }] } as never);
    jest.mocked(fetchLiveTvManagement).mockResolvedValue(true);
    jest.mocked(fetchTimers).mockResolvedValue([]);
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
  });
  const press = async () => act(async () => lastHandlers().onTransportBarButtonSelected({ id: "record" }));

  it("keeps Stop when the timer was created but the re-read failed, and never cancels a timer without an id", async () => {
    await act(async () => {
      renderer = TestRenderer.create(<VideoPlayerScreen />);
    });
    expect(recordButton()).toMatchObject({ title: "liveTv.record" });
    jest.mocked(fetchTimers).mockRejectedValueOnce(new Error("offline"));
    await press();
    expect(createTimer).toHaveBeenCalledTimes(1);
    expect(recordButton()).toMatchObject({ title: "liveTv.stopRecording" });
    expect(Alert.alert).not.toHaveBeenCalled();
    // Stop on the stand-in reads the real timer first; the next press cancels it by its id.
    const now = Date.now();
    jest
      .mocked(fetchTimers)
      .mockResolvedValue([{ Id: "t1", ChannelId: "ch1", Status: "InProgress", StartDate: new Date(now - 60_000).toISOString(), EndDate: new Date(now + 3_600_000).toISOString() }] as never);
    await press();
    expect(cancelTimer).not.toHaveBeenCalled();
    await press();
    expect(cancelTimer).toHaveBeenCalledWith("t1");
  });
});

describe("transport bar record across a programme boundary", () => {
  let renderer: TestRenderer.ReactTestRenderer;
  const airing = (id: string, startMs: number, endMs: number) => ({ Id: id, StartDate: new Date(startMs).toISOString(), EndDate: new Date(endMs).toISOString() });
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockParams = { videoId: "ch1", videoName: "News", live: "1" };
    mockSession.sessionVideoId = "ch1";
    jest.mocked(fetchNextEpisodeAutoPlay).mockResolvedValue(true);
    jest.mocked(fetchMediaSegments).mockResolvedValue({ intro: null, outro: null });
    jest.mocked(fetchLiveTvManagement).mockResolvedValue(true);
    jest.mocked(fetchTimers).mockResolvedValue([]);
  });
  afterEach(async () => {
    await act(async () => renderer?.unmount());
    jest.useRealTimers();
  });

  it("records the programme on air now, not the one airing when the player opened", async () => {
    const now = Date.now();
    jest.mocked(fetchChannels).mockResolvedValue({ items: [{ Id: "ch1", Name: "News", CurrentProgram: airing("p1", now - 60_000, now + 60_000) }] } as never);
    await act(async () => {
      renderer = TestRenderer.create(<VideoPlayerScreen />);
    });
    expect(fetchChannels).toHaveBeenCalledTimes(1);
    jest.mocked(fetchChannels).mockResolvedValue({ items: [{ Id: "ch1", Name: "News", CurrentProgram: airing("p2", now + 60_000, now + 1_800_000) }] } as never);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(70_000);
    });
    expect(fetchChannels).toHaveBeenCalledTimes(2);
    await act(async () => lastHandlers().onTransportBarButtonSelected({ id: "record" }));
    expect(fetchTimerDefaults).toHaveBeenCalledWith("p2");
  });
});
