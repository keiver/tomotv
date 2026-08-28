import AudioPlayerScreen from "@/app/audio-player";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { audioPlayerManager, type AudioPlayerUIState } from "@/services/audioPlayerManager";
import React from "react";
import { Platform } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockHideGlobalLoader = jest.fn();
const mockShowGlobalLoader = jest.fn();
let audioStateListener: ((state: AudioPlayerUIState) => void) | null = null;

jest.mock("react-native", () => {
  const reactNative = jest.requireActual("react-native");
  Object.defineProperty(reactNative.Platform, "isTV", { configurable: true, value: true });
  return reactNative;
});

const mockNavigation = {
  addListener: jest.fn(() => jest.fn()),
  canGoBack: jest.fn(() => true),
  goBack: jest.fn(),
  setOptions: jest.fn(),
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ videoId: "track-1" }),
  useNavigation: () => mockNavigation,
}));

jest.mock("@/contexts/LoadingContext", () => ({
  useLoadingActions: jest.fn(),
}));

jest.mock("@/services/audioPlayerManager", () => ({
  audioPlayerManager: {
    startQueue: jest.fn(async () => {}),
    subscribe: jest.fn(),
  },
}));

jest.mock("@/services/jellyfinApi", () => ({
  fetchVideoDetails: jest.fn(async () => ({ Id: "track-1", Name: "Track 1" })),
  JELLYFIN_TIME: { TICKS_PER_SECOND: 10_000_000 },
}));

jest.mock("@/services/playQueueManager", () => ({
  playQueueManager: {
    getState: jest.fn(() => ({ isLoading: false, queue: [], loop: false })),
    subscribe: jest.fn(),
  },
}));

jest.mock("@/utils/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn() },
}));

const audioState = (uiVisible: boolean): AudioPlayerUIState => ({
  active: true,
  uiVisible,
  index: 0,
  queueLength: 1,
  track: null,
  playing: true,
  position: 0,
});

describe("AudioPlayerScreen", () => {
  let renderer: TestRenderer.ReactTestRenderer;

  beforeEach(() => {
    jest.clearAllMocks();
    audioStateListener = null;
    jest.mocked(useLoadingActions).mockReturnValue({ hideGlobalLoader: mockHideGlobalLoader, showGlobalLoader: mockShowGlobalLoader });
    jest.mocked(audioPlayerManager.subscribe).mockImplementation((listener) => {
      audioStateListener = listener;
      listener(audioState(false));
      return jest.fn();
    });
  });

  afterEach(async () => {
    await act(async () => renderer.unmount());
  });

  it("keeps the tvOS focus target and pops immediately when AVKit starts dismissing", async () => {
    await act(async () => {
      renderer = TestRenderer.create(<AudioPlayerScreen />);
    });

    expect(Platform.isTV).toBe(true);
    expect(renderer.root.findAllByProps({ isTVSelectable: true, hasTVPreferredFocus: true })).toHaveLength(1);

    await act(async () => audioStateListener?.(audioState(true)));
    expect(mockNavigation.goBack).not.toHaveBeenCalled();

    await act(async () => audioStateListener?.(audioState(false)));
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  });
});
