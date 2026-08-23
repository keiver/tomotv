/**
 * The mini player is the only in-app transport for a queue whose native UI was dismissed, so
 * what is under test is when it appears and which manager call each control makes. The
 * toolbar chrome is mocked to a plain View: its gesture rule has its own suite.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { AudioMiniPlayer } from "@/components/audio-mini-player";
import { audioPlayerManager, type AudioPlayerUIState } from "@/services/audioPlayerManager";

jest.mock("@/components/draggable-toolbar", () => {
  const { View } = require("react-native");
  return { DraggableToolbar: ({ children }: { children?: React.ReactNode }) => <View>{children}</View> };
});

jest.mock("@/services/jellyfinApi", () => ({
  getPosterUrl: jest.fn(() => "https://server/poster.jpg"),
  hasPoster: jest.fn(() => true),
}));

let mockPathname = "/";
jest.mock("expo-router", () => ({ usePathname: () => mockPathname }));

let listener: ((state: AudioPlayerUIState) => void) | null = null;
jest.mock("@/services/audioPlayerManager", () => {
  const state = {
    active: false,
    uiVisible: false,
    index: 0,
    queueLength: 0,
    track: null,
    playing: false,
    position: 0,
  };
  return {
    audioPlayerManager: {
      getUIState: () => state,
      subscribe: jest.fn(),
      setPlaying: jest.fn(),
      next: jest.fn(),
      previous: jest.fn(),
      stop: jest.fn(),
      present: jest.fn(),
    },
  };
});

const manager = audioPlayerManager as jest.Mocked<typeof audioPlayerManager>;

const TRACK = { Id: "track-1", Name: "Bloom", Album: "Veckatimest", Artists: ["Grizzly Bear"] } as never;

function playingState(overrides: Partial<AudioPlayerUIState> = {}): AudioPlayerUIState {
  return { active: true, uiVisible: false, index: 0, queueLength: 3, track: TRACK, playing: true, position: 12, ...overrides };
}

function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<AudioMiniPlayer />);
  });
  return tree;
}

function push(state: AudioPlayerUIState) {
  act(() => listener?.(state));
}

/** Every control carries its accessibility label; Pressable renders through several nodes. */
function press(tree: TestRenderer.ReactTestRenderer, label: string) {
  const target = tree.root.findAll((node) => node.props?.accessibilityLabel === label && typeof node.props?.onPress === "function")[0];
  if (!target) throw new Error(`No pressable labelled "${label}"`);
  act(() => target.props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPathname = "/";
  listener = null;
  manager.subscribe.mockImplementation((fn) => {
    listener = fn;
    return () => {
      listener = null;
    };
  });
});

describe("AudioMiniPlayer", () => {
  it("renders nothing until a queue is active", () => {
    expect(render().toJSON()).toBeNull();
  });

  it("renders nothing while the native player is on screen", () => {
    const tree = render();
    push(playingState({ uiVisible: true }));
    expect(tree.toJSON()).toBeNull();
  });

  it("renders nothing on the playback routes, which carry their own transport", () => {
    mockPathname = "/audio-player";
    const tree = render();
    push(playingState());
    expect(tree.toJSON()).toBeNull();

    mockPathname = "/player";
    const other = render();
    push(playingState());
    expect(other.toJSON()).toBeNull();
  });

  it("shows the track once the native player is dismissed", () => {
    const tree = render();
    push(playingState());
    expect(JSON.stringify(tree.toJSON())).toContain("Bloom");
    expect(JSON.stringify(tree.toJSON())).toContain("Grizzly Bear");
  });

  it("pauses a playing queue and resumes a paused one", () => {
    const tree = render();
    push(playingState());
    press(tree, "Pause");
    expect(manager.setPlaying).toHaveBeenCalledWith(false);

    push(playingState({ playing: false }));
    press(tree, "Play");
    expect(manager.setPlaying).toHaveBeenLastCalledWith(true);
  });

  it("wires the queue and session controls to the manager", () => {
    const tree = render();
    push(playingState());

    press(tree, "Next track");
    expect(manager.next).toHaveBeenCalled();

    press(tree, "Previous track");
    expect(manager.previous).toHaveBeenCalled();

    press(tree, "Stop playback");
    expect(manager.stop).toHaveBeenCalled();

    press(tree, "Open the player");
    expect(manager.present).toHaveBeenCalled();
  });
});
