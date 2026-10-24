/**
 * The playing item's card: the id selector that picks it, and its position, from the queue for a
 * track and from the card's own progress for a video.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { nowPlayingItemId } from "@/hooks/useNowPlaying";
import { useNowPlayingProgress } from "@/hooks/useNowPlayingProgress";
import { audioPlayerManager, type AudioPlayerUIState } from "@/services/audioPlayerManager";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: () => ({ sessionVideoId: null, hostMode: "idle", playbackState: { type: "IDLE" } }) }));
jest.mock("@/services/jellyfinApi", () => ({ JELLYFIN_TIME: { TICKS_PER_SECOND: 10_000_000 } }));

let listener: ((state: AudioPlayerUIState) => void) | null = null;
jest.mock("@/services/audioPlayerManager", () => {
  const state = { active: true, uiVisible: false, index: 1, queueLength: 3, loop: false, track: null, playing: true, position: 60 };
  return { audioPlayerManager: { getUIState: () => state, subscribe: jest.fn() } };
});

const manager = audioPlayerManager as jest.Mocked<typeof audioPlayerManager>;

/** Four minutes long. */
const TRACK = { Id: "track-1", Name: "Bloom", RunTimeTicks: 240 * 10_000_000 } as never;

function playingState(overrides: Partial<AudioPlayerUIState> = {}): AudioPlayerUIState {
  return { active: true, uiVisible: false, index: 1, queueLength: 3, loop: false, track: TRACK, playing: true, position: 60, ...overrides };
}

type Args = Parameters<typeof useNowPlayingProgress>;

function render(...args: Args) {
  const result: { current: ReturnType<typeof useNowPlayingProgress> | null } = { current: null };
  function Probe() {
    result.current = useNowPlayingProgress(...args);
    return null;
  }
  act(() => {
    TestRenderer.create(<Probe />);
  });
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  listener = null;
  manager.subscribe.mockImplementation((next) => {
    listener = next;
    return () => {
      listener = null;
    };
  });
});

describe("nowPlayingItemId", () => {
  it("names the track only for a live queue whose native UI is dismissed", () => {
    expect(nowPlayingItemId(playingState())).toBe("track-1");
    expect(nowPlayingItemId(playingState({ active: false }))).toBeNull();
    expect(nowPlayingItemId(playingState({ uiVisible: true }))).toBeNull();
    expect(nowPlayingItemId(playingState({ track: null }))).toBeNull();
  });
});

describe("audio", () => {
  it("follows the queue's position and play state", () => {
    const result = render(TRACK, "audio");
    expect(result.current).toEqual({ fraction: 0.25, playing: true });
    act(() => listener?.(playingState({ position: 180, playing: false })));
    expect(result.current).toEqual({ fraction: 0.75, playing: false });
  });

  it("reaches the whole track on its last tick", () => {
    const result = render(TRACK, "audio");
    act(() => listener?.(playingState({ position: 239 })));
    expect(result.current?.fraction).toBe(1);
  });
});

describe("video", () => {
  it("keeps the progress its card was given and never subscribes to the queue", () => {
    const result = render(TRACK, "video", 0.4, true);
    expect(manager.subscribe).not.toHaveBeenCalled();
    expect(result.current).toEqual({ fraction: 0.4, playing: true });
  });

  it("has no position to show at 0", () => {
    expect(render(TRACK, "video", 0, false).current?.fraction).toBeNull();
  });
});

describe("a card that is not playing", () => {
  it("never subscribes", () => {
    render(TRACK, null);
    expect(manager.subscribe).not.toHaveBeenCalled();
  });
});
