/**
 * The bar marks the playing item's card. Under test: the id selector that picks the card, the
 * bars at its left end, and the fill following the queue's position for a track while a video
 * keeps the progress its card was given.
 */
import React from "react";
import { View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import { NowPlayingTitleBar } from "@/components/now-playing-title-bar";
import { nowPlayingItemId } from "@/hooks/useNowPlaying";
import { audioPlayerManager, type AudioPlayerUIState } from "@/services/audioPlayerManager";

jest.mock("@/components/level-bars", () => {
  const { View } = require("react-native");
  return { LevelBars: ({ playing }: { playing: boolean }) => <View testID={playing ? "bars-playing" : "bars-paused"} /> };
});
jest.mock("@/components/MarqueeText", () => {
  const { Text } = require("react-native");
  return { MarqueeText: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text> };
});
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

function render(props: Partial<React.ComponentProps<typeof NowPlayingTitleBar>> = {}) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<NowPlayingTitleBar video={TRACK} focused={false} kind="audio" {...props} />);
  });
  return tree;
}

function push(state: AudioPlayerUIState) {
  act(() => listener?.(state));
}

function fillWidth(tree: TestRenderer.ReactTestRenderer) {
  const fill = tree.root.findAll((node) => node.props?.testID === "now-playing-progress" && node.type === View)[0];
  return (fill.props.style as { width: string }[]).find((entry) => entry && "width" in entry)?.width;
}

function bars(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll((node) => typeof node.props?.testID === "string" && node.props.testID.startsWith("bars-") && node.type === View)[0]?.props.testID;
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
  it("shows the title with moving bars and fills by the queue's position", () => {
    const tree = render();
    expect(tree.root.findAll((node) => node.props?.children === "Bloom").length).toBeGreaterThan(0);
    expect(bars(tree)).toBe("bars-playing");
    expect(fillWidth(tree)).toBe("25%");
    push(playingState({ position: 180 }));
    expect(fillWidth(tree)).toBe("75%");
  });

  it("settles the bars while paused and floors the fill at 5%", () => {
    const tree = render();
    push(playingState({ position: 0, playing: false }));
    expect(bars(tree)).toBe("bars-paused");
    expect(fillWidth(tree)).toBe("5%");
  });
});

describe("video", () => {
  it("keeps the progress its card was given and never subscribes to the queue", () => {
    const tree = render({ kind: "video", progressPercent: 0.4, playing: true });
    expect(manager.subscribe).not.toHaveBeenCalled();
    expect(fillWidth(tree)).toBe("40%");
    expect(bars(tree)).toBe("bars-playing");
  });
});
