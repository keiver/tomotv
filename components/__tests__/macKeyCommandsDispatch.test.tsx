/**
 * What each key actually does once the rule has decided. macKeyAction is covered on its
 * own; this pins the half that reaches the router and the queue manager, where a wrong
 * route string or a wrong manager call is invisible until someone runs the Mac build.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { MacKeyCommands } from "@/components/mac-key-commands";
import { audioPlayerManager } from "@/services/audioPlayerManager";
import type { MacKey } from "@/services/macKeyCommands";
import { router } from "expo-router";

jest.mock("@/utils/hostEnvironment", () => ({ IS_MAC: true }));

let mockPress: ((key: MacKey) => void) | null = null;
const mockArrowClaims: string[] = [];
jest.mock("@/services/macKeyCommands", () => ({
  MAC_KEYS: ["escape", "playPause", "previousTrack", "nextTrack", "search", "settings", "previousPhoto", "nextPhoto", "seekBackward", "seekForward"],
  MAC_SEEK_SECONDS: 15,
  claimMacArrowKeys: (owner: string, context: string) => {
    mockArrowClaims.push(`${owner}:${context}`);
    return () => {
      const index = mockArrowClaims.indexOf(`${owner}:${context}`);
      if (index >= 0) mockArrowClaims.splice(index, 1);
    };
  },
  subscribeMacKeyCommand: (handler: (key: MacKey) => void) => {
    mockPress = handler;
    return () => {
      mockPress = null;
    };
  },
}));

// Built inside the factory: a const declared out here is still undefined when jest
// hoists the mock above it, and the module reads `router` at import time.
jest.mock("expo-router", () => ({
  router: { navigate: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
}));
const mockRouter = router as unknown as { navigate: jest.Mock; push: jest.Mock; back: jest.Mock; canGoBack: jest.Mock };

const mockAudioState = { active: false, uiVisible: false, index: 0, queueLength: 0, track: null, playing: false, position: 0 };
jest.mock("@/services/audioPlayerManager", () => ({
  audioPlayerManager: {
    getUIState: () => mockAudioState,
    subscribe: () => () => {},
    setPlaying: jest.fn(),
    next: jest.fn(),
    previous: jest.fn(),
    seekBy: jest.fn(),
  },
}));

const mockStopSession = jest.fn();
const mockSeekBy = jest.fn();
const mockHandlersRef = { current: null as { onRequestBack: () => void } | null };
const mockSession = { hostMode: "idle" as string };
jest.mock("@/contexts/PlayerSessionContext", () => ({
  usePlayerSession: () => ({ hostMode: mockSession.hostMode, stopSession: mockStopSession, seekBy: mockSeekBy }),
  usePlayerSessionHost: () => ({ handlersRef: mockHandlersRef }),
}));

function mount() {
  act(() => {
    TestRenderer.create(<MacKeyCommands />);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.hostMode = "idle";
  mockArrowClaims.length = 0;
  mockHandlersRef.current = null;
  mockAudioState.active = false;
  mockAudioState.playing = false;
});

describe("Mac key dispatch", () => {
  it("jumps to a tab rather than pushing one", () => {
    mount();
    act(() => mockPress?.("search"));
    act(() => mockPress?.("settings"));
    expect(mockRouter.navigate).toHaveBeenCalledWith("/(tabs)/search");
    expect(mockRouter.navigate).toHaveBeenCalledWith("/(tabs)/settings");
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it("leaves the navigator alone while a session owns the screen", () => {
    mockSession.hostMode = "video";
    mockHandlersRef.current = { onRequestBack: jest.fn() };
    mount();
    act(() => mockPress?.("search"));
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it("sends Escape to the live route rather than the navigator", () => {
    mockSession.hostMode = "video";
    const onRequestBack = jest.fn();
    mockHandlersRef.current = { onRequestBack };
    mount();
    act(() => mockPress?.("escape"));
    expect(onRequestBack).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it("ends the session itself when no route is listening", () => {
    mockSession.hostMode = "pip-detached";
    mount();
    act(() => mockPress?.("escape"));
    expect(mockStopSession).toHaveBeenCalledTimes(1);
  });

  it("toggles the queue from whatever it is doing", () => {
    mockAudioState.active = true;
    mockAudioState.playing = true;
    mount();
    act(() => mockPress?.("playPause"));
    expect(audioPlayerManager.setPlaying).toHaveBeenCalledWith(false);
  });

  it("changes track only while a queue is running", () => {
    mockAudioState.active = true;
    mount();
    act(() => mockPress?.("nextTrack"));
    act(() => mockPress?.("previousTrack"));
    expect(audioPlayerManager.next).toHaveBeenCalledTimes(1);
    expect(audioPlayerManager.previous).toHaveBeenCalledTimes(1);
  });

  it("seeks the audio queue when one is running, not the video session", () => {
    mockAudioState.active = true;
    mount();
    act(() => mockPress?.("seekForward"));
    act(() => mockPress?.("seekBackward"));
    expect(audioPlayerManager.seekBy).toHaveBeenNthCalledWith(1, 15);
    expect(audioPlayerManager.seekBy).toHaveBeenNthCalledWith(2, -15);
    expect(mockSeekBy).not.toHaveBeenCalled();
  });

  it("seeks the video session when no queue is running", () => {
    mockSession.hostMode = "route";
    mount();
    act(() => mockPress?.("seekForward"));
    expect(mockSeekBy).toHaveBeenCalledWith(15);
    expect(audioPlayerManager.seekBy).not.toHaveBeenCalled();
  });

  it("arms the bare arrows only while something wants them", () => {
    mount();
    expect(mockArrowClaims).toEqual([]);
  });

  it("leaves transport to AVKit when no queue is running", () => {
    mount();
    act(() => mockPress?.("playPause"));
    act(() => mockPress?.("nextTrack"));
    expect(audioPlayerManager.setPlaying).not.toHaveBeenCalled();
    expect(audioPlayerManager.next).not.toHaveBeenCalled();
  });
});
