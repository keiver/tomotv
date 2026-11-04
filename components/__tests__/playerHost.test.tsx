/**
 * PlayerHost owns one player for the whole app session, so its job is session bookkeeping:
 * adopt a request for the live item, queue a request for a different one behind the current
 * teardown, and ignore a release from a route it has already moved on from.
 *
 * useVideoPlayback is mocked: what is under test is which videoId the host asks for and when,
 * not what the hook does with it.
 */
import React from "react";
import { StyleSheet } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import Video from "react-native-video";
import { DismissPan } from "@/components/dismiss-pan";
import { PlayerHost } from "@/components/player-host";
import type { PlayerHostBridge } from "@/contexts/PlayerSessionContext";
import { useVideoPlayback } from "@/hooks/useVideoPlayback";
import { t } from "@/services/i18n";

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/services/playbackHold", () => ({ setPlaybackHold: jest.fn(), isPlaybackHeld: jest.fn(() => false), onPlaybackHoldChange: jest.fn(() => () => {}) }));
const mockAutoPlay = { enabled: true };
jest.mock("@/services/jellyfinApi", () => ({
  getPosterUrl: jest.fn(() => "https://server/poster.jpg"),
  hasPoster: jest.fn(() => false),
  subscribeAuthChange: jest.fn(() => () => {}),
  fetchNextEpisodeAutoPlay: jest.fn(async () => mockAutoPlay.enabled),
  isLiveChannel: (item: { Type?: string } | null) => item?.Type === "TvChannel",
}));
const mockQueue = { queue: [] as { Id: string; Name: string }[], currentIndex: -1 };
jest.mock("@/services/playQueueManager", () => ({
  playQueueManager: {
    getState: () => ({ queue: mockQueue.queue, currentIndex: mockQueue.currentIndex }),
    hasNext: () => mockQueue.currentIndex >= 0 && mockQueue.currentIndex < mockQueue.queue.length - 1,
    advanceToNext: () => {
      if (mockQueue.currentIndex < 0 || mockQueue.currentIndex >= mockQueue.queue.length - 1) return null;
      mockQueue.currentIndex += 1;
      return mockQueue.queue[mockQueue.currentIndex];
    },
  },
}));
jest.mock("@/services/syncPlayManager", () => ({ isJoined: () => false }));
jest.mock("@/components/image-subtitle-overlay", () => ({ ImageSubtitleOverlay: () => null }));
const mockUseItemPoster = jest.fn((..._args: unknown[]) => undefined);
jest.mock("@/hooks/useItemPoster", () => ({ useItemPoster: (...args: unknown[]) => mockUseItemPoster(...args) }));
const mockHotChannels = new Set<string>();
const mockOneConnectionChannels = new Set<string>();
jest.mock("@/services/liveRing", () => ({ isHotChannel: (id: string) => mockHotChannels.has(id), channelOnOneConnection: (id: string) => mockOneConnectionChannels.has(id) }));
jest.mock("@/components/dismiss-pan", () => {
  const { View } = require("react-native");
  return { DismissPan: ({ children, ...rest }: { children?: React.ReactNode }) => <View {...rest}>{children}</View> };
});

let registeredBridge: PlayerHostBridge | null = null;
const handlersRef = {
  current: null as { onPlaybackEnd: () => void; onLiveChannelFailed?: (fallbackId: string) => boolean; onPipStarted?: () => void; onRequestBack?: () => void } | null,
};
jest.mock("@/contexts/PlayerSessionContext", () => ({
  usePlayerSessionHost: () => ({
    registerHost: (bridge: PlayerHostBridge | null) => {
      registeredBridge = bridge;
    },
    publish: jest.fn(),
    handlersRef,
    inlineScale: { get: () => 1, set: jest.fn(), value: 1 },
  }),
}));

jest.mock("@/hooks/useVideoPlayback", () => ({ useVideoPlayback: jest.fn() }));

/** Counts <Video> mounts: a remount is what takes a PiP window's AVPlayer down. */
const mockVideoMounts = { count: 0 };
jest.mock("react-native-video", () => {
  const React = require("react");
  const MockVideo = React.forwardRef(() => {
    React.useEffect(() => {
      mockVideoMounts.count += 1;
    }, []);
    return null;
  });
  MockVideo.displayName = "Video";
  return MockVideo;
});

const mockUseVideoPlayback = useVideoPlayback as jest.Mock;

/** What the hook hands back; sourceUri is the flag the host reads as "a player exists". */
let sourceUri: string | null = null;
/** Overrides the state the hook reports; null derives it from sourceUri. */
let stateType: string | null = null;
/** Whether a reported ERROR still has a rung left. */
let canRetry = false;
/** The hook's loading overlay, which a loaded item still shows until it plays. */
let loadingOverlay = false;
/** The item details the hook has fetched. */
let details: { Id: string; Name: string; Type?: string } | null = null;
const hookCalls: { videoId: string; skip?: boolean }[] = [];
/** Stable across renders, so a test can assert the bridge never reached it. */
const hookPause = jest.fn();
const videoCallbacks = {
  onLoad: jest.fn(),
  onProgress: jest.fn(),
  onError: jest.fn(),
  onEnd: jest.fn(),
  onSeek: jest.fn(),
  onBuffer: jest.fn(),
  onAudioTracks: jest.fn(),
  onTextTracks: jest.fn(),
  onPlaybackStateChanged: jest.fn(),
  onBandwidthUpdate: jest.fn(),
  onReadyForDisplay: jest.fn(),
};

function hookResult() {
  return {
    videoRef: { current: null },
    sourceUri,
    startPositionMs: null,
    paused: false,
    maxBitRate: null,
    videoCallbacks,
    state: stateType === "ERROR" ? { type: "ERROR", error: "failed", canRetryWithTranscode: canRetry } : { type: stateType ?? (sourceUri ? "PLAYING" : "IDLE") },
    showLoadingOverlay: loadingOverlay,
    pause: hookPause,
    retry: jest.fn(),
    videoDetails: details,
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

/** IS_MAC is read once at load, so a Mac host is a fresh module graph. */
function loadMacHost(): typeof PlayerHost {
  let MacHost!: typeof PlayerHost;
  const shared = { react: React, rn: require("react-native"), video: Video, hook: require("@/hooks/useVideoPlayback") };
  jest.isolateModules(() => {
    jest.doMock("react", () => shared.react);
    jest.doMock("react-native", () => shared.rn);
    jest.doMock("react-native-video", () => shared.video);
    jest.doMock("@/hooks/useVideoPlayback", () => shared.hook);
    jest.doMock("@/utils/hostEnvironment", () => ({ ...jest.requireActual("@/utils/hostEnvironment"), IS_MAC: true }));
    MacHost = require("@/components/player-host").PlayerHost;
  });
  return MacHost;
}

/** Whether the opaque cover over the inline player is rendered. */
const covered = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => node.props.testID === "player-curtain").length > 0;

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
    stateType = null;
    canRetry = false;
    loadingOverlay = false;
    details = null;
    mockVideoMounts.count = 0;
    mockQueue.queue = [];
    mockQueue.currentIndex = -1;
    mockAutoPlay.enabled = true;
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

  it.each([
    ["a channel opened without the live flag", { Id: "ch-9", Name: "MLB", Type: "TvChannel" }, false, true],
    ["a live session", { Id: "ch-9", Name: "MLB", Type: "TvChannel" }, true, true],
    ["a movie", { Id: "movie-1", Name: "Film", Type: "Movie" }, false, undefined],
  ])("marks the artwork as a logo for %s", async (_name, item, isLive, logo) => {
    details = item;
    await act(async () => {
      bridge().requestSession({ videoId: item.Id, sessionKey: "k1", isLive });
    });
    sourceUri = "http://stream/1";
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
    expect(renderer.root.findByType(Video).props.source.metadata.logo).toBe(logo);
  });

  it("registers its bridge and sits idle with no session", () => {
    expect(registeredBridge).not.toBeNull();
    expect(hookCalls[0]).toEqual({ videoId: "", skip: true });
  });

  it("holds back a device-made poster while a video plays, so a frame landing mid-play never rebuilds the source", () => {
    expect(mockUseItemPoster).toHaveBeenCalledWith(null, 600, { deferWhileVideo: true });
  });

  it("holds the outgoing channel's player through a flip until the new one plays", async () => {
    await act(async () => {
      bridge().requestSession({ videoId: "ch-1", sessionKey: "k1", isLive: true });
    });
    sourceUri = "http://stream/ch1";
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
    expect(renderer.root.findAllByType(Video)).toHaveLength(1);
    // The flip commit still reports the outgoing channel PLAYING.
    await act(async () => {
      bridge().switchLiveChannel({ videoId: "ch-2", videoName: "Two" });
    });
    // The hook's reset lands next: no stream, IDLE. The held URL keeps the player up.
    sourceUri = null;
    stateType = "IDLE";
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
    expect(renderer.root.findAllByType(Video)).toHaveLength(1);
    expect(renderer.root.findByType(Video).props.source.uri).toBe("http://stream/ch1");
    renderer.root.findByType(Video).props.onBandwidthUpdate({ bitrate: 260_000 });
    expect(videoCallbacks.onBandwidthUpdate).not.toHaveBeenCalled();
    renderer.root.findByType(Video).props.onReadyForDisplay();
    expect(videoCallbacks.onReadyForDisplay).not.toHaveBeenCalled();
    sourceUri = "http://stream/ch2";
    stateType = "PLAYING";
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
    expect(renderer.root.findByType(Video).props.source.uri).toBe("http://stream/ch2");
    renderer.root.findByType(Video).props.onBandwidthUpdate({ bitrate: 6_256_603 });
    expect(videoCallbacks.onBandwidthUpdate).toHaveBeenCalledWith({ bitrate: 6_256_603 });
    renderer.root.findByType(Video).props.onReadyForDisplay();
    expect(videoCallbacks.onReadyForDisplay).toHaveBeenCalledTimes(1);
  });

  it("opens only the channel a burst of swipes settles on", async () => {
    jest.useFakeTimers();
    try {
      await act(async () => {
        bridge().requestSession({ videoId: "ch-1", sessionKey: "k1", isLive: true });
      });
      sourceUri = "http://stream/ch1";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      await act(async () => {
        bridge().switchLiveChannel({ videoId: "ch-2" });
      });
      await act(async () => {
        bridge().switchLiveChannel({ videoId: "ch-3" });
      });
      expect(requestedVideoId()).toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(requestedVideoId()).toBe("ch-3");
      expect(hookCalls.some((call) => call.videoId === "ch-2" && !call.skip)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("waits 3 s after the last swipe before opening a channel whose provider allows one connection", async () => {
    mockOneConnectionChannels.add("ch-2");
    mockOneConnectionChannels.add("ch-3");
    jest.useFakeTimers();
    try {
      await act(async () => {
        bridge().requestSession({ videoId: "ch-1", sessionKey: "k1", isLive: true });
      });
      sourceUri = "http://stream/ch1";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      await act(async () => {
        bridge().switchLiveChannel({ videoId: "ch-2" });
      });
      await act(async () => {
        jest.advanceTimersByTime(2_000);
      });
      await act(async () => {
        bridge().switchLiveChannel({ videoId: "ch-3" });
      });
      await act(async () => {
        jest.advanceTimersByTime(2_999);
      });
      expect(requestedVideoId()).toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(requestedVideoId()).toBe("ch-3");
      expect(hookCalls.some((call) => call.videoId === "ch-2" && !call.skip)).toBe(false);
    } finally {
      jest.useRealTimers();
      mockOneConnectionChannels.clear();
    }
  });

  it("opens a channel picked from the panel after the short wait, whatever its provider allows", async () => {
    mockOneConnectionChannels.add("ch-2");
    jest.useFakeTimers();
    try {
      await act(async () => {
        bridge().requestSession({ videoId: "ch-1", sessionKey: "k1", isLive: true });
      });
      sourceUri = "http://stream/ch1";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      await act(async () => {
        bridge().switchLiveChannel({ videoId: "ch-2", picked: true });
      });
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(requestedVideoId()).toBe("ch-2");
    } finally {
      jest.useRealTimers();
      mockOneConnectionChannels.clear();
    }
  });

  it("binds a hot neighbour at once instead of waiting for the swipes to settle", async () => {
    mockHotChannels.add("ch-2");
    try {
      await act(async () => {
        bridge().requestSession({ videoId: "ch-1", sessionKey: "k1", isLive: true });
      });
      sourceUri = "http://stream/ch1";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      await act(async () => {
        bridge().switchLiveChannel({ videoId: "ch-2" });
      });
      expect(requestedVideoId()).toBe("ch-2");
    } finally {
      mockHotChannels.clear();
    }
  });

  it("keeps a live channel's player on stage through a retried failure, and parks it when no rung is left", async () => {
    await act(async () => {
      bridge().requestSession({ videoId: "ch-1", sessionKey: "k1", isLive: true });
    });
    sourceUri = "http://stream/ch1";
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
    sourceUri = null;
    stateType = "ERROR";
    canRetry = true;
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
    const video = renderer.root.findByType(Video);
    expect(video.props.source.uri).toBe("http://stream/ch1");
    // The held stream dying is not the retry's failure.
    await act(async () => {
      video.props.onError({ error: { errorString: "gone" } });
    });
    expect(videoCallbacks.onError).not.toHaveBeenCalled();
    canRetry = false;
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
    expect(renderer.root.findAllByType(Video)).toHaveLength(0);
  });

  /** Play ch-1, flip to ch-2, and let the hook restart for it. */
  async function flipFromPlayingChannel() {
    await act(async () => {
      bridge().requestSession({ videoId: "ch-1", sessionKey: "k1", isLive: true });
    });
    sourceUri = "http://stream/ch1";
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
    await act(async () => {
      bridge().switchLiveChannel({ videoId: "ch-2" });
    });
    sourceUri = null;
    stateType = "IDLE";
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
  }

  it("never re-applies the held source while the next channel loads", async () => {
    await flipFromPlayingChannel();
    const held = renderer.root.findByType(Video).props.source;
    details = { Id: "ch-2", Name: "Two" };
    stateType = "CREATING_STREAM";
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
    expect(renderer.root.findByType(Video).props.source).toBe(held);
    expect(held.uri).toBe("http://stream/ch1");
  });

  it("parks the player when the channel flipped to fails for good, so its error shows", async () => {
    await flipFromPlayingChannel();
    stateType = "ERROR";
    canRetry = false;
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
    expect(renderer.root.findAllByType(Video)).toHaveLength(0);
  });

  describe("tvOS channel swipe onto a dead channel", () => {
    const rn = require("react-native");
    const onRequestBack = jest.fn();
    beforeEach(() => {
      Object.defineProperty(rn.Platform, "isTV", { configurable: true, value: true });
      onRequestBack.mockClear();
    });
    afterEach(() => Object.defineProperty(rn.Platform, "isTV", { configurable: true, value: false }));

    /** Play ch-1, swipe (AVKit's interstitial goes up), flip to ch-2 and let it fail for good. */
    async function swipeOntoDeadChannel() {
      await act(async () => {
        bridge().requestSession({ videoId: "ch-1", sessionKey: "k1", isLive: true });
      });
      handlersRef.current = { onPlaybackEnd: jest.fn(), onSkipChannel: () => bridge().switchLiveChannel({ videoId: "ch-2" }), onRequestBack } as never;
      sourceUri = "http://stream/ch1";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      mockHotChannels.add("ch-2");
      await act(async () => {
        renderer.root.findByType(Video).props.onSkipToNextChannel();
      });
      sourceUri = null;
      stateType = "IDLE";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      stateType = "ERROR";
      canRetry = false;
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
    }

    afterEach(() => mockHotChannels.clear());

    it("holds AVKit and its interstitial, which says why and stops loading", async () => {
      await swipeOntoDeadChannel();
      const video = renderer.root.findByType(Video);
      expect(video.props.source.uri).toBe("http://stream/ch1");
      expect(video.props.liveChannelFailed).toBe(true);
      expect(video.props.liveChannelStage).toBe(t("player.unableToPlay"));
    });

    it("a swipe from the held interstitial flips on to the next channel", async () => {
      await swipeOntoDeadChannel();
      handlersRef.current = { onPlaybackEnd: jest.fn(), onSkipChannel: () => bridge().switchLiveChannel({ videoId: "ch-3" }), onRequestBack } as never;
      mockHotChannels.add("ch-3");
      stateType = "IDLE";
      await act(async () => {
        renderer.root.findByType(Video).props.onSkipToNextChannel();
      });
      expect(requestedVideoId()).toBe("ch-3");
      expect(renderer.root.findByType(Video).props.liveChannelFailed).toBe(false);
    });

    it("Menu on the held interstitial leaves the player", async () => {
      await swipeOntoDeadChannel();
      await act(async () => {
        renderer.root.findByType(Video).props.onChannelSkipAbandoned({ reason: "menu" });
      });
      expect(onRequestBack).toHaveBeenCalledTimes(1);
    });

    it("parks a channel picked from the info panel that fails, as no interstitial is up", async () => {
      await flipFromPlayingChannel();
      stateType = "ERROR";
      canRetry = false;
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      expect(renderer.root.findAllByType(Video)).toHaveLength(0);
    });
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

  // Escape on a mac with no route left to leave (mac-key-commands.tsx's endSession branch).
  // Routing this through leaveRoute swallows it, and Escape goes dead app-wide.
  it("ends a detached window when there is no route left to leave", async () => {
    await playWithPipUp();
    await act(async () => {
      bridge().stopSession();
      bridge().releaseRoute({ videoId: "movie-1", sessionKey: "key-1" });
    });
    expect(requestedVideoId()).toBe("movie-1");

    await act(async () => {
      bridge().stopSession();
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

  it("routes a stream error to the ladder while a route is attached", async () => {
    handlersRef.current = { onPlaybackEnd: jest.fn() };
    await act(async () => {
      bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
    });
    sourceUri = "http://stream/1";
    await act(async () => {
      renderer.update(<PlayerHost />);
    });

    await act(async () => {
      renderer.root.findByType(Video).props.onError({ error: { errorString: "gone" } });
    });

    expect(videoCallbacks.onError).toHaveBeenCalledTimes(1);
    expect(requestedVideoId()).toBe("movie-1");
  });

  it("ends a routeless session when its stream errors, instead of retrying it", async () => {
    await playWithPipUp();
    await act(async () => {
      bridge().stopSession();
      bridge().releaseRoute({ videoId: "movie-1", sessionKey: "key-1" });
    });

    await act(async () => {
      renderer.root.findByType(Video).props.onError({ error: { errorString: "Could not connect to the server." } });
    });

    expect(videoCallbacks.onError).not.toHaveBeenCalled();
    expect(requestedVideoId()).toBeNull();
  });

  it("carries a PiP window into the next queue item instead of remounting its player", async () => {
    await playWithPipUp();
    // The outgoing route's release can land before the incoming request.
    await act(async () => {
      bridge().releaseRoute({ videoId: "movie-1", sessionKey: "key-1" });
      bridge().requestSession({ videoId: "movie-2", sessionKey: "key-1", advance: true });
    });
    expect(requestedVideoId()).toBe("movie-2");

    sourceUri = null;
    stateType = "IDLE";
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
    expect(renderer.root.findByType(Video).props.source.uri).toBe("http://stream/1");
    renderer.root.findByType(Video).props.onEnd();
    expect(videoCallbacks.onEnd).not.toHaveBeenCalled();

    sourceUri = "http://stream/2";
    stateType = "PLAYING";
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
    expect(renderer.root.findByType(Video).props.source.uri).toBe("http://stream/2");
    expect(mockVideoMounts.count).toBe(1);

    // The window stays owned by the route that advanced into it.
    await act(async () => {
      bridge().releaseRoute({ videoId: "movie-1", sessionKey: "key-1" });
    });
    expect(requestedVideoId()).toBe("movie-2");
  });

  it("never presents the next item over a PiP window", async () => {
    const videoRef = { current: { setFullScreen: jest.fn() } };
    mockUseVideoPlayback.mockImplementation((config: { videoId: string; skip?: boolean }) => {
      hookCalls.push({ videoId: config.videoId, skip: config.skip });
      return { ...hookResult(), videoRef };
    });
    await playWithPipUp();
    await act(async () => {
      bridge().requestSession({ videoId: "movie-2", sessionKey: "key-1", advance: true });
    });
    sourceUri = "http://stream/2";
    await act(async () => {
      renderer.update(<PlayerHost />);
    });

    await act(async () => {
      renderer.root.findByType(Video).props.onLoad({ naturalSize: { width: 1920, height: 1080 } });
    });

    expect(videoRef.current.setFullScreen).not.toHaveBeenCalled();
  });

  describe("a PiP window taking over", () => {
    const video = () => renderer.root.findByType(Video);
    const lastConfig = () => mockUseVideoPlayback.mock.calls[mockUseVideoPlayback.mock.calls.length - 1][0];

    /** A queue session whose window is up and whose route has left, the way onPipStarted leaves it. */
    async function detachedQueueWindow() {
      mockQueue.queue = [
        { Id: "ep-1", Name: "One" },
        { Id: "ep-2", Name: "Two" },
      ];
      mockQueue.currentIndex = 0;
      await act(async () => {
        bridge().requestSession({ videoId: "ep-1", sessionKey: "key-1", queueMode: true });
      });
      sourceUri = "http://stream/1";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      await act(async () => {
        video().props.onPictureInPictureStatusChanged({ isActive: true });
      });
      await act(async () => {
        bridge().stopSession();
        bridge().releaseRoute({ videoId: "ep-1", sessionKey: "key-1" });
      });
    }

    it("on tvOS, sends the route back as soon as the window starts", async () => {
      const rn = require("react-native");
      Object.defineProperty(rn.Platform, "isTV", { configurable: true, value: true });
      try {
        const onPipStarted = jest.fn();
        handlersRef.current = { onPlaybackEnd: jest.fn(), onPipStarted };
        await playWithPipUp();
        expect(onPipStarted).toHaveBeenCalledTimes(1);
      } finally {
        Object.defineProperty(rn.Platform, "isTV", { configurable: true, value: false });
      }
    });

    it("on a Mac, sends the route back once AVKit's dismissal for the window lands", async () => {
      const MacHost = loadMacHost();
      const onPipStarted = jest.fn();
      const onRequestBack = jest.fn();
      handlersRef.current = { onPlaybackEnd: jest.fn(), onPipStarted, onRequestBack };
      let macRenderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        macRenderer = TestRenderer.create(<MacHost />);
      });
      await act(async () => {
        bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
      });
      sourceUri = "http://stream/1";
      await act(async () => {
        macRenderer.update(<MacHost />);
      });
      await act(async () => {
        macRenderer.root.findByType(Video).props.onFullscreenPlayerDidPresent();
        macRenderer.root.findByType(Video).props.onPictureInPictureStatusChanged({ isActive: true });
      });
      expect(onPipStarted).not.toHaveBeenCalled();

      await act(async () => {
        macRenderer.root.findByType(Video).props.onFullscreenPlayerDidDismiss();
      });

      expect(onPipStarted).toHaveBeenCalledTimes(1);
      expect(onRequestBack).not.toHaveBeenCalled();
      await act(async () => macRenderer.unmount());
    });

    it("on the phone, sends the route back once AVKit's dismissal for the window lands", async () => {
      const onPipStarted = jest.fn();
      const onRequestBack = jest.fn();
      handlersRef.current = { onPlaybackEnd: jest.fn(), onPipStarted, onRequestBack };
      await act(async () => {
        bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
      });
      sourceUri = "http://stream/1";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      await act(async () => {
        video().props.onFullscreenPlayerDidPresent();
        video().props.onPictureInPictureStatusChanged({ isActive: true });
      });
      expect(onPipStarted).not.toHaveBeenCalled();

      await act(async () => {
        video().props.onFullscreenPlayerDidDismiss();
      });

      expect(onPipStarted).toHaveBeenCalledTimes(1);
      expect(onRequestBack).not.toHaveBeenCalled();
    });

    it("rolls a queue into its next item inside a window with no route", async () => {
      await detachedQueueWindow();

      await act(async () => {
        lastConfig().onPlaybackEnd();
      });

      expect(requestedVideoId()).toBe("ep-2");
      expect(mockVideoMounts.count).toBe(1);
    });

    it("ends a routeless window at its item's end when autoplay is off", async () => {
      mockAutoPlay.enabled = false;
      await detachedQueueWindow();

      await act(async () => {
        lastConfig().onPlaybackEnd();
      });

      expect(requestedVideoId()).toBeNull();
    });

    it("ends a routeless window at its item's end when it plays no queue", async () => {
      await playWithPipUp();
      await act(async () => {
        bridge().stopSession();
        bridge().releaseRoute({ videoId: "movie-1", sessionKey: "key-1" });
      });

      await act(async () => {
        lastConfig().onPlaybackEnd();
      });

      expect(requestedVideoId()).toBeNull();
    });

    it("reopens a restored window's route with its queue", async () => {
      const { router } = require("expo-router");
      await detachedQueueWindow();

      await act(async () => {
        video().props.onRestoreUserInterfaceForPictureInPictureStop();
      });

      expect(router.push).toHaveBeenCalledWith({ pathname: "/player", params: expect.objectContaining({ videoId: "ep-1", adopt: "1", queueMode: "true" }) });
    });

    it("presents the phone player again once a restored window stops", async () => {
      const videoRef = { current: { setFullScreen: jest.fn(), restoreUserInterfaceForPictureInPictureStopCompleted: jest.fn() } };
      mockUseVideoPlayback.mockImplementation((config: { videoId: string; skip?: boolean }) => {
        hookCalls.push({ videoId: config.videoId, skip: config.skip });
        return { ...hookResult(), videoRef };
      });
      await detachedQueueWindow();
      await act(async () => {
        video().props.onRestoreUserInterfaceForPictureInPictureStop();
      });
      handlersRef.current = { onPlaybackEnd: jest.fn() };
      await act(async () => {
        bridge().requestSession({ videoId: "ep-1", sessionKey: "key-2", adopt: true, queueMode: true });
      });

      await act(async () => {
        video().props.onPictureInPictureStatusChanged({ isActive: false });
      });

      expect(videoRef.current.setFullScreen).toHaveBeenCalledWith(true);
      expect(requestedVideoId()).toBe("ep-1");
    });
  });

  describe("the inline player under AVKit's presentation", () => {
    const video = () => renderer.root.findByType(Video);
    const stageOnScreen = () => renderer.root.findByType(DismissPan).props.pointerEvents === "auto";

    async function playOnPhone(videoRef: { current: { setFullScreen: jest.Mock; restoreUserInterfaceForPictureInPictureStopCompleted: jest.Mock } }) {
      mockUseVideoPlayback.mockImplementation((config: { videoId: string; skip?: boolean }) => {
        hookCalls.push({ videoId: config.videoId, skip: config.skip });
        return { ...hookResult(), videoRef };
      });
      await act(async () => {
        bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
      });
      sourceUri = "http://stream/1";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      await act(async () => {
        video().props.onLoad({ naturalSize: { width: 1920, height: 1080 } });
      });
    }

    it("on the phone, covers the inline player on the stage before AVKit's presentation lands", async () => {
      const videoRef = { current: { setFullScreen: jest.fn(), restoreUserInterfaceForPictureInPictureStopCompleted: jest.fn() } };
      await playOnPhone(videoRef);

      expect(videoRef.current.setFullScreen).toHaveBeenCalledWith(true);
      expect(stageOnScreen()).toBe(true);
      expect(covered(renderer)).toBe(true);
    });

    it("on the phone, covers the inline player on the stage from a PiP restore until AVKit presents it again", async () => {
      const videoRef = { current: { setFullScreen: jest.fn(), restoreUserInterfaceForPictureInPictureStopCompleted: jest.fn() } };
      handlersRef.current = { onPlaybackEnd: jest.fn(), onPipStarted: () => bridge().stopSession() };
      await playOnPhone(videoRef);
      await act(async () => {
        video().props.onFullscreenPlayerDidPresent();
        video().props.onPictureInPictureStatusChanged({ isActive: true });
      });
      await act(async () => {
        video().props.onFullscreenPlayerDidDismiss();
      });
      await act(async () => {
        bridge().releaseRoute({ videoId: "movie-1", sessionKey: "key-1" });
      });
      handlersRef.current = null;
      await act(async () => {
        video().props.onRestoreUserInterfaceForPictureInPictureStop();
      });

      handlersRef.current = { onPlaybackEnd: jest.fn() };
      await act(async () => {
        bridge().requestSession({ videoId: "movie-1", sessionKey: "key-2", adopt: true });
      });
      expect(stageOnScreen()).toBe(true);
      expect(covered(renderer)).toBe(true);

      videoRef.current.setFullScreen.mockClear();
      await act(async () => {
        video().props.onPictureInPictureStatusChanged({ isActive: false });
      });
      expect(videoRef.current.setFullScreen).toHaveBeenCalledWith(true);
      expect(covered(renderer)).toBe(true);
    });

    it("on a Mac, presents the player on load and covers the inline player", async () => {
      const MacHost = loadMacHost();
      const videoRef = { current: { setFullScreen: jest.fn(), restoreUserInterfaceForPictureInPictureStopCompleted: jest.fn() } };
      mockUseVideoPlayback.mockImplementation((config: { videoId: string; skip?: boolean }) => {
        hookCalls.push({ videoId: config.videoId, skip: config.skip });
        return { ...hookResult(), videoRef };
      });
      let macRenderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        macRenderer = TestRenderer.create(<MacHost />);
      });
      await act(async () => {
        bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
      });
      sourceUri = "http://stream/1";
      await act(async () => {
        macRenderer.update(<MacHost />);
      });
      await act(async () => {
        macRenderer.root.findByType(Video).props.onLoad({ naturalSize: { width: 1920, height: 1080 } });
      });

      expect(videoRef.current.setFullScreen).toHaveBeenCalledWith(true);
      expect(covered(macRenderer)).toBe(true);
      await act(async () => macRenderer.unmount());
    });
  });

  describe("an inline session in Live TV's pinned band", () => {
    const video = () => renderer.root.findByType(Video);
    const stage = () => renderer.root.findByType(DismissPan);
    const card = { x: 0, y: 300, width: 160, height: 90 };
    const videoRef = {
      current: {
        setFullScreen: jest.fn(),
        restoreUserInterfaceForPictureInPictureStopCompleted: jest.fn(),
        enterPictureInPicture: jest.fn(),
        exitPictureInPicture: jest.fn(),
        resume: jest.fn(),
      },
    };

    async function playInline() {
      mockUseVideoPlayback.mockImplementation((config: { videoId: string; skip?: boolean }) => {
        hookCalls.push({ videoId: config.videoId, skip: config.skip });
        return { ...hookResult(), videoRef };
      });
      handlersRef.current = { onPlaybackEnd: jest.fn(), onRequestBack: jest.fn(), onPipStarted: jest.fn() };
      await act(async () => {
        bridge().setInlineFrame(card);
        bridge().requestSession({ videoId: "channel-1", sessionKey: "live-tv:1", isLive: true, inline: true });
      });
      sourceUri = "http://stream/channel-1";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      await act(async () => {
        video().props.onLoad({ naturalSize: { width: 1920, height: 1080 } });
      });
    }
    const pipStatus = async (isActive: boolean) => {
      await act(async () => {
        video().props.onPictureInPictureStatusChanged({ isActive });
      });
    };

    beforeEach(() => {
      Object.values(videoRef.current).forEach((fn) => fn.mockClear());
    });

    it("plays the picture with sound and no controls in the band's slot, leaving its touches to the band, never presented and never starting PiP", async () => {
      await playInline();

      expect(videoRef.current.setFullScreen).not.toHaveBeenCalled();
      expect(video().props.muted).toBeUndefined();
      expect(video().props.controls).toBe(false);
      expect(video().props.enterPictureInPictureOnLeave).toBeUndefined();
      expect(covered(renderer)).toBe(false);
      expect(stage().props.pointerEvents).toBe("none");
      expect(StyleSheet.flatten(stage().props.style)).toMatchObject({ position: "absolute", left: 0, top: 300, width: 160, height: 90 });
      expect(videoRef.current.enterPictureInPicture).not.toHaveBeenCalled();
    });

    it("parks through a channel switch, keeping the session, and comes back to the slot once the new channel plays", async () => {
      await playInline();
      await act(async () => {
        bridge().switchLiveChannel({ videoId: "channel-2", videoName: "Two", picked: true });
      });
      sourceUri = null;
      stateType = "IDLE";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      expect(StyleSheet.flatten(stage().props.style)).not.toMatchObject({ top: 300, width: 160 });
      expect(handlersRef.current?.onRequestBack).not.toHaveBeenCalled();
      expect(videoRef.current.exitPictureInPicture).not.toHaveBeenCalled();

      sourceUri = "http://stream/channel-2";
      stateType = "PLAYING";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      expect(StyleSheet.flatten(stage().props.style)).toMatchObject({ top: 300, width: 160 });
      expect(videoRef.current.enterPictureInPicture).not.toHaveBeenCalled();
    });

    it("parks while the band has no slot, the closed column's audio-only state, and keeps playing", async () => {
      await playInline();
      await act(async () => {
        bridge().setInlineFrame(null);
      });

      expect(StyleSheet.flatten(stage().props.style)).not.toMatchObject({ top: 300, width: 160 });
      expect(requestedVideoId()).toBe("channel-1");
      expect(handlersRef.current?.onRequestBack).not.toHaveBeenCalled();
    });

    it("opens the presented player once the channel loads when full screen was asked for while it opened, instead of a window", async () => {
      mockUseVideoPlayback.mockImplementation((config: { videoId: string; skip?: boolean }) => {
        hookCalls.push({ videoId: config.videoId, skip: config.skip });
        return { ...hookResult(), videoRef };
      });
      handlersRef.current = { onPlaybackEnd: jest.fn(), onRequestBack: jest.fn(), onPipStarted: jest.fn() };
      stateType = "FETCHING_METADATA";
      await act(async () => {
        bridge().setInlineFrame(card);
        bridge().requestSession({ videoId: "channel-1", sessionKey: "live-tv:1", isLive: true, inline: true });
      });
      await act(async () => {
        bridge().presentFullscreen();
      });
      expect(videoRef.current.setFullScreen).not.toHaveBeenCalled();

      sourceUri = "http://stream/channel-1";
      stateType = "PLAYING";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      await act(async () => {
        video().props.onLoad({ naturalSize: { width: 1920, height: 1080 } });
      });

      expect(videoRef.current.setFullScreen).toHaveBeenCalledWith(true);
      expect(videoRef.current.enterPictureInPicture).not.toHaveBeenCalled();
    });

    it("opens the presented player once the channel plays when full screen was asked for after it loaded but before it played", async () => {
      mockUseVideoPlayback.mockImplementation((config: { videoId: string; skip?: boolean }) => {
        hookCalls.push({ videoId: config.videoId, skip: config.skip });
        return { ...hookResult(), videoRef };
      });
      handlersRef.current = { onPlaybackEnd: jest.fn(), onRequestBack: jest.fn(), onPipStarted: jest.fn() };
      stateType = "FETCHING_METADATA";
      loadingOverlay = true;
      await act(async () => {
        bridge().setInlineFrame(card);
        bridge().requestSession({ videoId: "channel-1", sessionKey: "live-tv:1", isLive: true, inline: true });
      });
      sourceUri = "http://stream/channel-1";
      stateType = "READY";
      await act(async () => {
        renderer.update(<PlayerHost />);
      });
      await act(async () => {
        video().props.onLoad({ naturalSize: { width: 1920, height: 1080 } });
      });
      await act(async () => {
        bridge().presentFullscreen();
      });
      expect(videoRef.current.setFullScreen).not.toHaveBeenCalled();

      stateType = "PLAYING";
      loadingOverlay = false;
      await act(async () => {
        renderer.update(<PlayerHost />);
      });

      expect(videoRef.current.setFullScreen).toHaveBeenCalledWith(true);
      expect(videoRef.current.enterPictureInPicture).not.toHaveBeenCalled();
    });

    it("leaves the slot while AVKit's own PiP window has the picture, and comes back to it when the window closes, keeping the session", async () => {
      await playInline();
      await pipStatus(true);
      expect(StyleSheet.flatten(stage().props.style)).not.toMatchObject({ top: 300, width: 160 });

      await pipStatus(false);

      expect(StyleSheet.flatten(stage().props.style)).toMatchObject({ top: 300, width: 160 });
      expect(handlersRef.current?.onRequestBack).not.toHaveBeenCalled();
      expect(videoRef.current.setFullScreen).not.toHaveBeenCalled();
    });

    it("answers AVKit's return button so the picture goes back to the slot", async () => {
      await playInline();
      await pipStatus(true);

      await act(async () => {
        video().props.onRestoreUserInterfaceForPictureInPictureStop();
      });

      expect(videoRef.current.restoreUserInterfaceForPictureInPictureStopCompleted).toHaveBeenCalledWith(true);
      expect(videoRef.current.setFullScreen).not.toHaveBeenCalled();
    });

    it("goes back to its band when the viewer closes the presented player, keeping the session", async () => {
      await playInline();
      await act(async () => {
        bridge().presentFullscreen();
      });
      expect(videoRef.current.setFullScreen).toHaveBeenCalledWith(true);
      await act(async () => {
        video().props.onFullscreenPlayerDidPresent();
      });

      await act(async () => {
        video().props.onFullscreenPlayerDidDismiss();
      });

      expect(handlersRef.current?.onRequestBack).not.toHaveBeenCalled();
      expect(requestedVideoId()).toBe("channel-1");
      expect(videoRef.current.enterPictureInPicture).not.toHaveBeenCalled();
    });

    it("ignores a full screen ask for a session that is not inline", async () => {
      await act(async () => {
        bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
      });

      await act(async () => {
        bridge().presentFullscreen();
      });

      expect(videoRef.current.setFullScreen).not.toHaveBeenCalled();
    });
  });

  it("tears down as usual for an advance with no PiP window up", async () => {
    await act(async () => {
      bridge().requestSession({ videoId: "movie-1", sessionKey: "key-1" });
    });
    sourceUri = "http://stream/1";

    await act(async () => {
      bridge().requestSession({ videoId: "movie-2", sessionKey: "key-1", advance: true });
    });
    expect(requestedVideoId()).toBeNull();

    sourceUri = null;
    await act(async () => {
      renderer.update(<PlayerHost />);
    });
    expect(requestedVideoId()).toBe("movie-2");
  });
});
