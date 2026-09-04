/**
 * The mini player is the only in-app transport for a queue whose native UI was dismissed, so
 * what is under test is when it appears and which manager call each control makes. The
 * toolbar chrome is mocked to a plain View: its gesture rule has its own suite.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { AudioMiniPlayer, transportReach } from "@/components/audio-mini-player";
import { audioPlayerManager, type AudioPlayerUIState } from "@/services/audioPlayerManager";
import { playbackArtworkUri } from "@/services/downloads/localSource";

jest.mock("@/components/draggable-toolbar", () => {
  const { View } = require("react-native");
  return { DraggableToolbar: ({ children }: { children?: React.ReactNode }) => <View>{children}</View> };
});

jest.mock("@/services/downloads/localSource", () => ({ playbackArtworkUri: jest.fn(() => "https://server/poster.jpg") }));

let mockPathname = "/";
jest.mock("expo-router", () => ({ usePathname: () => mockPathname }));

let listener: ((state: AudioPlayerUIState) => void) | null = null;
jest.mock("@/services/audioPlayerManager", () => {
  const state = {
    active: false,
    uiVisible: false,
    index: 0,
    queueLength: 0,
    loop: false,
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
  return { active: true, uiVisible: false, index: 1, queueLength: 3, loop: false, track: TRACK, playing: true, position: 12, ...overrides };
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
function find(tree: TestRenderer.ReactTestRenderer, label: string) {
  const target = tree.root.findAll((node) => node.props?.accessibilityLabel === label && typeof node.props?.onPress === "function")[0];
  if (!target) throw new Error(`No pressable labelled "${label}"`);
  return target;
}

/** The artwork tile: the only image sourced from a URI, the brand placeholder is a bundled asset. */
function artworkImage(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll((node) => typeof node.props?.source?.uri === "string")[0] ?? null;
}

function press(tree: TestRenderer.ReactTestRenderer, label: string) {
  act(() => find(tree, label).props.onPress());
}

/** accessibilityState rather than the disabled prop: it is the one both Pressable and its host view carry. */
function disabled(tree: TestRenderer.ReactTestRenderer, label: string) {
  return find(tree, label).props.accessibilityState?.disabled === true;
}

/** The artwork is the only long-press target, and it is how playback is stopped. */
function longPressArtwork(tree: TestRenderer.ReactTestRenderer) {
  const target = tree.root.findAll((node) => typeof node.props?.onLongPress === "function")[0];
  if (!target) throw new Error("Nothing on the bar accepts a long press");
  act(() => target.props.onLongPress());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPathname = "/";
  listener = null;
  (playbackArtworkUri as jest.Mock).mockReturnValue("https://server/poster.jpg");
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

    longPressArtwork(tree);
    expect(manager.stop).toHaveBeenCalled();

    press(tree, "Open the player");
    expect(manager.present).toHaveBeenCalled();
  });

  it("stops offering a skip the queue cannot make", () => {
    const tree = render();
    push(playingState({ index: 0, queueLength: 3 }));
    expect(disabled(tree, "Previous track")).toBe(true);
    expect(disabled(tree, "Next track")).toBe(false);

    push(playingState({ index: 2, queueLength: 3 }));
    expect(disabled(tree, "Previous track")).toBe(false);
    expect(disabled(tree, "Next track")).toBe(true);
  });

  it("keeps the skip forward alive at the end of a queue that wraps", () => {
    const tree = render();
    push(playingState({ index: 2, queueLength: 3, loop: true }));
    expect(disabled(tree, "Next track")).toBe(false);
  });

  it("never disables play or pause", () => {
    const tree = render();
    push(playingState({ index: 0, queueLength: 1 }));
    expect(disabled(tree, "Previous track")).toBe(true);
    expect(disabled(tree, "Next track")).toBe(true);
    expect(disabled(tree, "Pause")).toBe(false);
  });
});

describe("the artwork target", () => {
  it("stops playback on a long press and opens the player on a tap", () => {
    const tree = render();
    push(playingState());

    press(tree, "Open the player");
    expect(manager.present).toHaveBeenCalled();
    expect(manager.stop).not.toHaveBeenCalled();

    longPressArtwork(tree);
    expect(manager.stop).toHaveBeenCalled();
  });

  it("keeps the same target when the item has no poster", () => {
    (playbackArtworkUri as jest.Mock).mockReturnValue(null);
    const tree = render();
    push(playingState());

    longPressArtwork(tree);
    expect(manager.stop).toHaveBeenCalled();
  });

  it("draws the picture the player resolves for the track", () => {
    (playbackArtworkUri as jest.Mock).mockReturnValue("file:///downloads/track-1/poster.jpg");
    const tree = render();
    push(playingState());

    expect(playbackArtworkUri).toHaveBeenCalledWith(TRACK, 200);
    expect(artworkImage(tree)?.props.source.uri).toBe("file:///downloads/track-1/poster.jpg");
  });

  it("falls back to the placeholder when the poster fails to load, never a blank tile", () => {
    const tree = render();
    push(playingState());
    expect(artworkImage(tree)?.props.source.uri).toBe("https://server/poster.jpg");

    act(() => artworkImage(tree)!.props.onError());
    expect(artworkImage(tree)).toBeNull();
    longPressArtwork(tree);
    expect(manager.stop).toHaveBeenCalled();
  });

  it("offers the long press to assistive tech, which has no gesture for it", () => {
    const tree = render();
    push(playingState());
    const target = tree.root.findAll((node) => typeof node.props?.onAccessibilityAction === "function")[0];

    act(() => target.props.onAccessibilityAction({ nativeEvent: { actionName: "longpress" } }));
    expect(manager.stop).toHaveBeenCalled();

    manager.stop.mockClear();
    act(() => target.props.onAccessibilityAction({ nativeEvent: { actionName: "activate" } }));
    expect(manager.stop).not.toHaveBeenCalled();
  });
});

/**
 * The rule on its own. The native skip is what these mirror: forward stops at the last track
 * unless the queue wraps, and back never leaves index 0, where the native call restarts the
 * track rather than moving (AudioQueuePlayer.skipBackward).
 */
describe("transportReach", () => {
  it("opens both ends in the middle of a queue", () => {
    expect(transportReach({ index: 1, queueLength: 3, loop: false })).toEqual({ canPrevious: true, canNext: true });
  });

  it("closes the end it is standing on", () => {
    expect(transportReach({ index: 0, queueLength: 3, loop: false }).canPrevious).toBe(false);
    expect(transportReach({ index: 2, queueLength: 3, loop: false }).canNext).toBe(false);
  });

  it("wraps forward and not back when the queue loops", () => {
    const reach = transportReach({ index: 0, queueLength: 3, loop: true });
    expect(reach.canNext).toBe(true);
    expect(reach.canPrevious).toBe(false);
    expect(transportReach({ index: 2, queueLength: 3, loop: true }).canNext).toBe(true);
  });

  it("closes both ends on a queue of one, looping or not", () => {
    expect(transportReach({ index: 0, queueLength: 1, loop: false })).toEqual({ canPrevious: false, canNext: false });
    expect(transportReach({ index: 0, queueLength: 1, loop: true })).toEqual({ canPrevious: false, canNext: false });
  });
});
