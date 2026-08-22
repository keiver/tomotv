/**
 * PlayerHost owns one player for the whole app session, so its job is session bookkeeping:
 * adopt a request for the live item, queue a request for a different one behind the current
 * teardown, and ignore a release from a route it has already moved on from.
 *
 * useVideoPlayback is mocked: what is under test is which videoId the host asks for and when,
 * not what the hook does with it.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import Video from "react-native-video";
import { PlayerHost } from "@/components/player-host";
import type { PlayerHostBridge } from "@/contexts/PlayerSessionContext";
import { useVideoPlayback } from "@/hooks/useVideoPlayback";

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/services/playbackHold", () => ({ setPlaybackHold: jest.fn() }));
jest.mock("@/utils/backkeyProbe", () => ({ backkeyProbe: jest.fn() }));
jest.mock("@/services/jellyfinApi", () => ({ getPosterUrl: jest.fn(() => "https://server/poster.jpg"), hasPoster: jest.fn(() => false) }));
jest.mock("@/components/image-subtitle-overlay", () => ({ ImageSubtitleOverlay: () => null }));
jest.mock("@/components/dismiss-pan", () => {
  const { View } = require("react-native");
  return { DismissPan: ({ children, ...rest }: { children?: React.ReactNode }) => <View {...rest}>{children}</View> };
});

let registeredBridge: PlayerHostBridge | null = null;
const handlersRef = { current: null as { onPlaybackEnd: () => void } | null };
jest.mock("@/contexts/PlayerSessionContext", () => ({
  usePlayerSessionHost: () => ({
    registerHost: (bridge: PlayerHostBridge | null) => {
      registeredBridge = bridge;
    },
    publish: jest.fn(),
    handlersRef,
  }),
}));

jest.mock("@/hooks/useVideoPlayback", () => ({ useVideoPlayback: jest.fn() }));

const mockUseVideoPlayback = useVideoPlayback as jest.Mock;

/** What the hook hands back; sourceUri is the flag the host reads as "a player exists". */
let sourceUri: string | null = null;
const hookCalls: { videoId: string; skip?: boolean }[] = [];
/** Stable across renders, so a test can assert the bridge never reached it. */
const hookPause = jest.fn();

function hookResult() {
  return {
    videoRef: { current: null },
    sourceUri,
    startPositionMs: null,
    paused: false,
    maxBitRate: null,
    videoCallbacks: { onLoad: jest.fn(), onProgress: jest.fn(), onError: jest.fn(), onEnd: jest.fn(), onSeek: jest.fn(), onAudioTracks: jest.fn(), onTextTracks: jest.fn() },
    state: { type: sourceUri ? "PLAYING" : "IDLE" },
    showLoadingOverlay: false,
    pause: hookPause,
    retry: jest.fn(),
    videoDetails: null,
    imageSubtitleSessionUrl: null,
    activeImageSubtitleStream: null,
    currentTimeRef: { current: 0 },
    selectedTextTrack: { type: "system" },
  };
}

const bridge = () => {
  if (!registeredBridge) throw new Error("host never registered its bridge");
  return registeredBridge;
};

/** Play an item and put a PiP window up, the way AVKit reports one. */
async function playWithPipUp() {
  await act(async () => {
    bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
  });
  sourceUri = "http://stream/1";
  await act(async () => {
    renderer.update(<PlayerHost />);
  });
  await act(async () => {
    renderer.root.findByType(Video).props.onPictureInPictureStatusChanged({ isActive: true });
  });
}

let renderer: TestRenderer.ReactTestRenderer;

/** The videoId the host last asked the hook for, or null while it is idle. */
const requestedVideoId = () => {
  const last = hookCalls[hookCalls.length - 1];
  return last.skip ? null : last.videoId;
};

describe("PlayerHost", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    registeredBridge = null;
    handlersRef.current = null;
    hookCalls.length = 0;
    sourceUri = null;
    mockUseVideoPlayback.mockImplementation((config: { videoId: string; skip?: boolean }) => {
      hookCalls.push({ videoId: config.videoId, skip: config.skip });
      return hookResult();
    });
    await act(async () => {
      renderer = TestRenderer.create(<PlayerHost />);
    });
  });

  afterEach(async () => {
    await act(async () => renderer.unmount());
  });

  it("registers its bridge and sits idle with no session", () => {
    expect(registeredBridge).not.toBeNull();
    expect(hookCalls[0]).toEqual({ videoId: "", skip: true });
  });

  it("starts the requested item", async () => {
    await act(async () => {
      bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
    });

    expect(requestedVideoId()).toBe("movie-1");
  });

  it("adopts a repeat request for the live item instead of restarting it", async () => {
    await act(async () => {
      bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
    });
    sourceUri = "http://stream/1";
    const teardownsBefore = hookCalls.filter((call) => call.skip).length;

    await act(async () => {
      bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
    });

    // No new skip render, so the player was never torn down and rebuilt.
    expect(hookCalls.filter((call) => call.skip).length).toBe(teardownsBefore);
    expect(requestedVideoId()).toBe("movie-1");
  });

  it("queues a different item behind the current teardown", async () => {
    await act(async () => {
      bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
    });
    sourceUri = "http://stream/1";

    await act(async () => {
      bridge().requestSession({ videoId: "movie-2", sessionKey: "key-2" });
    });
    // The old player has not gone yet, so the new item must not have started.
    expect(requestedVideoId()).toBeNull();

    // Teardown completes: <Video> unmounts and the hook stops handing back a URL.
    sourceUri = null;
    await act(async () => {
      renderer.update(<PlayerHost />);
    });

    expect(requestedVideoId()).toBe("movie-2");
  });

  it("ignores a release from a route it has already moved on from", async () => {
    await act(async () => {
      bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
    });

    await act(async () => {
      bridge().releaseRoute({ videoId: "movie-0", sessionKey: "key-0" });
    });

    expect(requestedVideoId()).toBe("movie-1");
  });

  it("ends the session when the owning route releases it", async () => {
    await act(async () => {
      bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
    });

    await act(async () => {
      bridge().releaseRoute({ videoId: "movie-1", sessionKey: "key-1" });
    });

    expect(requestedVideoId()).toBeNull();
  });

  it("drops a queued item when the session is stopped outright", async () => {
    await act(async () => {
      bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
    });
    sourceUri = "http://stream/1";
    await act(async () => {
      bridge().requestSession({ videoId: "movie-2", sessionKey: "key-2" });
    });

    await act(async () => {
      bridge().stopSession();
    });
    sourceUri = null;
    await act(async () => {
      renderer.update(<PlayerHost />);
    });

    expect(requestedVideoId()).toBeNull();
  });

  // A PiP window outlives the route that started it. handleBack stops the session and
  // THEN pops, so both commands arrive for one departure and neither may end it.
  it("keeps a live PiP window playing when the route leaves", async () => {
    await playWithPipUp();

    await act(async () => {
      bridge().stopSession();
    });
    expect(requestedVideoId()).toBe("movie-1");

    await act(async () => {
      bridge().releaseRoute({ videoId: "movie-1", sessionKey: "key-1" });
    });
    expect(requestedVideoId()).toBe("movie-1");
  });

  it("ends the detached session when the window is closed", async () => {
    await playWithPipUp();
    await act(async () => {
      bridge().stopSession();
      bridge().releaseRoute({ videoId: "movie-1", sessionKey: "key-1" });
    });

    await act(async () => {
      renderer.root.findByType(Video).props.onPictureInPictureStatusChanged({ isActive: false });
    });

    expect(requestedVideoId()).toBeNull();
  });

  it("never pauses the player a PiP window is showing", async () => {
    await playWithPipUp();

    await act(async () => {
      bridge().pause();
    });

    expect(hookPause).not.toHaveBeenCalled();
  });

  it("pauses normally with no window up", async () => {
    await act(async () => {
      bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
    });

    await act(async () => {
      bridge().pause();
    });

    expect(hookPause).toHaveBeenCalledTimes(1);
  });

  it("routes playback end to the route's handler when one is registered", async () => {
    const onPlaybackEnd = jest.fn();
    handlersRef.current = { onPlaybackEnd };

    await act(async () => {
      bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
    });
    const config = mockUseVideoPlayback.mock.calls[mockUseVideoPlayback.mock.calls.length - 1][0];
    await act(async () => {
      config.onPlaybackEnd();
    });

    expect(onPlaybackEnd).toHaveBeenCalledTimes(1);
    expect(requestedVideoId()).toBe("movie-1");
  });

  it("ends the session itself when no route handler is registered", async () => {
    await act(async () => {
      bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
    });
    const config = mockUseVideoPlayback.mock.calls[mockUseVideoPlayback.mock.calls.length - 1][0];
    await act(async () => {
      config.onPlaybackEnd();
    });

    expect(requestedVideoId()).toBeNull();
  });
});
