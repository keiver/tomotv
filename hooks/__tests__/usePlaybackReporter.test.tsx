/**
 * Tests for usePlaybackReporter: the session lifecycle around the Jellyfin Sessions
 * reports. Rendered with react-test-renderer (the project's hook-testing pattern)
 * through a null-rendering harness that exposes the hook's return value via a ref.
 *
 * Covers: markStarted idempotency, pause reporting gating, markEnded reporting the
 * full duration exactly once, resetSession closing only an in-flight session, the
 * 8s polling loop's dedup, Stopped on unmount, and backgrounding via AppState.
 */
import React, { forwardRef, useImperativeHandle } from "react";
import { AppState } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import type { VideoRef } from "react-native-video";
import { usePlaybackReporter } from "@/hooks/usePlaybackReporter";

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/services/jellyfinApi", () => ({
  JELLYFIN_TIME: { TICKS_PER_SECOND: 10000000 },
  reportPlaybackStart: jest.fn().mockResolvedValue(undefined),
  reportPlaybackProgress: jest.fn().mockResolvedValue(undefined),
  reportPlaybackStopped: jest.fn().mockResolvedValue(undefined),
  updateUserItemData: jest.fn().mockResolvedValue(undefined),
}));

import { reportPlaybackStart, reportPlaybackProgress, reportPlaybackStopped, updateUserItemData } from "@/services/jellyfinApi";

const mockStart = reportPlaybackStart as jest.Mock;
const mockProgress = reportPlaybackProgress as jest.Mock;
const mockStopped = reportPlaybackStopped as jest.Mock;
const mockUserData = updateUserItemData as jest.Mock;

const TICKS = 10000000;

type Hook = ReturnType<typeof usePlaybackReporter>;
type HookRef = { get: () => Hook };

interface HarnessProps {
  videoId: string;
  videoRef: React.RefObject<VideoRef | null>;
  durationRef: React.RefObject<number>;
  mediaSourceIdRef: React.RefObject<string | null>;
  playSessionIdRef: React.RefObject<string>;
  isPlayingRef: React.RefObject<boolean>;
  currentModeRef: React.RefObject<"direct" | "transcode">;
  audioStreamIndexRef: React.RefObject<number | null>;
  wasPlayedAtStartRef: React.RefObject<boolean | null>;
  positionSecondsRef: React.RefObject<number>;
}

const Harness = forwardRef<HookRef, HarnessProps>((props, ref) => {
  const result = usePlaybackReporter(props);
  useImperativeHandle(ref, () => ({ get: () => result }), [result]);
  return null;
});
Harness.displayName = "Harness";

function makeProps(overrides: Partial<HarnessProps> = {}): HarnessProps {
  return {
    videoId: "video-1",
    videoRef: { current: { getCurrentPosition: jest.fn().mockResolvedValue(0) } as unknown as VideoRef },
    durationRef: { current: 3600 },
    mediaSourceIdRef: { current: "source-1" },
    playSessionIdRef: { current: "session-1" },
    isPlayingRef: { current: true },
    currentModeRef: { current: "transcode" },
    audioStreamIndexRef: { current: 2 },
    wasPlayedAtStartRef: { current: false },
    // 0 = "clock never ticked": event reports fall back to the poll sample/seed,
    // matching these tests' pre-existing sampled-position expectations.
    positionSecondsRef: { current: 0 },
    ...overrides,
  };
}

function renderReporter(props: HarnessProps) {
  const ref = React.createRef<HookRef>();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Harness ref={ref} {...props} />);
  });
  return { renderer, hook: () => ref.current!.get(), ref };
}

/** Advance the 8s polling interval and flush the async sampling + report + persist chain. */
async function tickPoll() {
  await act(async () => {
    jest.advanceTimersByTime(8_000);
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
  });
}

describe("usePlaybackReporter", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("markStarted reports Playing once and is idempotent within a session", () => {
    const { hook } = renderReporter(makeProps());

    act(() => hook().markStarted(120 * TICKS));
    act(() => hook().markStarted(0));

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({
        ItemId: "video-1",
        MediaSourceId: "source-1",
        PlaySessionId: "session-1",
        PositionTicks: 120 * TICKS,
        IsPaused: false,
        PlayMethod: "Transcode",
        AudioStreamIndex: 2,
        CanSeek: true,
      }),
    );
  });

  it("reportPauseChange is a no-op before the session starts and reports IsPaused after", () => {
    const { hook } = renderReporter(makeProps());

    act(() => hook().reportPauseChange(true));
    expect(mockProgress).not.toHaveBeenCalled();

    act(() => hook().markStarted());
    act(() => hook().reportPauseChange(true));

    expect(mockProgress).toHaveBeenCalledTimes(1);
    expect(mockProgress).toHaveBeenCalledWith(expect.objectContaining({ IsPaused: true }));
  });

  it("polling reports Progress while the position advances and skips stalled ticks", async () => {
    const getCurrentPosition = jest.fn().mockResolvedValueOnce(100).mockResolvedValueOnce(100).mockResolvedValueOnce(108);
    const props = makeProps({ videoRef: { current: { getCurrentPosition } as unknown as VideoRef } });
    const { hook } = renderReporter(props);
    act(() => hook().markStarted());

    await tickPoll(); // 100s — reported
    await tickPoll(); // 100s again (paused/buffering) — skipped
    await tickPoll(); // 108s — reported

    expect(mockProgress).toHaveBeenCalledTimes(2);
    expect(mockProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ PositionTicks: 100 * TICKS, IsPaused: false }));
    expect(mockProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ PositionTicks: 108 * TICKS }));
  });

  it("does not poll before the session starts", async () => {
    const getCurrentPosition = jest.fn().mockResolvedValue(100);
    renderReporter(makeProps({ videoRef: { current: { getCurrentPosition } as unknown as VideoRef } }));

    await tickPoll();

    expect(mockProgress).not.toHaveBeenCalled();
  });

  it("markEnded reports Stopped at the full duration, exactly once, and stops the poll", async () => {
    const getCurrentPosition = jest.fn().mockResolvedValue(3590);
    const { hook } = renderReporter(makeProps({ videoRef: { current: { getCurrentPosition } as unknown as VideoRef } }));
    act(() => hook().markStarted());
    await tickPoll();

    act(() => hook().markEnded());
    act(() => hook().markEnded());
    await tickPoll();

    expect(mockStopped).toHaveBeenCalledTimes(1);
    expect(mockStopped).toHaveBeenCalledWith(expect.objectContaining({ PositionTicks: 3600 * TICKS }));
    expect(mockProgress).toHaveBeenCalledTimes(1); // only the pre-end poll
  });

  it("unmount reports Stopped at the last sampled position unless the video ended", async () => {
    const getCurrentPosition = jest.fn().mockResolvedValue(250);
    const { renderer, hook } = renderReporter(makeProps({ videoRef: { current: { getCurrentPosition } as unknown as VideoRef } }));
    act(() => hook().markStarted());
    await tickPoll();

    act(() => renderer.unmount());

    expect(mockStopped).toHaveBeenCalledTimes(1);
    expect(mockStopped).toHaveBeenCalledWith(expect.objectContaining({ PositionTicks: 250 * TICKS }));
  });

  it("unmount reports nothing when playback never started", () => {
    const { renderer } = renderReporter(makeProps());

    act(() => renderer.unmount());

    expect(mockStopped).not.toHaveBeenCalled();
  });

  it("resetSession closes only an in-flight session and re-arms markStarted", async () => {
    const getCurrentPosition = jest.fn().mockResolvedValue(250);
    const { hook } = renderReporter(makeProps({ videoRef: { current: { getCurrentPosition } as unknown as VideoRef } }));

    // Before start: no Stopped
    act(() => hook().resetSession());
    expect(mockStopped).not.toHaveBeenCalled();

    act(() => hook().markStarted());
    await tickPoll();
    act(() => hook().resetSession());

    expect(mockStopped).toHaveBeenCalledTimes(1);
    expect(mockStopped).toHaveBeenCalledWith(expect.objectContaining({ PositionTicks: 250 * TICKS }));

    // New session starts cleanly after the reset
    act(() => hook().markStarted());
    expect(mockStart).toHaveBeenCalledTimes(2);
  });

  describe("resume-position persistence (gate-free UserData writes)", () => {
    it("poll tick persists the position AFTER the Progress report, restoring the session-start Played state", async () => {
      const getCurrentPosition = jest.fn().mockResolvedValue(100);
      const { hook } = renderReporter(makeProps({ videoRef: { current: { getCurrentPosition } as unknown as VideoRef } }));
      act(() => hook().markStarted());

      await tickPoll();

      expect(mockUserData).toHaveBeenCalledTimes(1);
      expect(mockUserData).toHaveBeenCalledWith("video-1", { PlaybackPositionTicks: 100 * TICKS, Played: false });
      expect(mockProgress.mock.invocationCallOrder[0]).toBeLessThan(mockUserData.mock.invocationCallOrder[0]);
    });

    it("write carries Played: true when the item was already played before the session", async () => {
      const getCurrentPosition = jest.fn().mockResolvedValue(100);
      const { hook } = renderReporter(makeProps({ videoRef: { current: { getCurrentPosition } as unknown as VideoRef }, wasPlayedAtStartRef: { current: true } }));
      act(() => hook().markStarted());

      await tickPoll();

      expect(mockUserData).toHaveBeenCalledWith("video-1", { PlaybackPositionTicks: 100 * TICKS, Played: true });
    });

    it("does not persist at or past 95% of duration", async () => {
      const getCurrentPosition = jest.fn().mockResolvedValue(3500); // 3500/3600 ≈ 97%
      const { hook } = renderReporter(makeProps({ videoRef: { current: { getCurrentPosition } as unknown as VideoRef } }));
      act(() => hook().markStarted());

      await tickPoll();

      expect(mockProgress).toHaveBeenCalledTimes(1);
      expect(mockUserData).not.toHaveBeenCalled();
    });

    it("does not persist positions under 2 seconds (unmount after an early sample)", async () => {
      const getCurrentPosition = jest.fn().mockResolvedValue(1);
      const { renderer, hook } = renderReporter(makeProps({ videoRef: { current: { getCurrentPosition } as unknown as VideoRef } }));
      act(() => hook().markStarted());
      await tickPoll(); // samples 3s (below the 5s report delta, but sampled)

      act(() => renderer.unmount());
      await act(async () => {});

      expect(mockStopped).toHaveBeenCalledTimes(1);
      expect(mockUserData).not.toHaveBeenCalled();
    });

    it("does not persist when the duration is unknown", async () => {
      const getCurrentPosition = jest.fn().mockResolvedValue(100);
      const { hook } = renderReporter(makeProps({ videoRef: { current: { getCurrentPosition } as unknown as VideoRef }, durationRef: { current: 0 } }));
      act(() => hook().markStarted());

      await tickPoll();

      expect(mockProgress).toHaveBeenCalledTimes(1);
      expect(mockUserData).not.toHaveBeenCalled();
    });

    it("unmount mid-play persists after the Stopped report", async () => {
      const getCurrentPosition = jest.fn().mockResolvedValue(250);
      const { renderer, hook } = renderReporter(makeProps({ videoRef: { current: { getCurrentPosition } as unknown as VideoRef } }));
      act(() => hook().markStarted());
      await tickPoll();
      mockUserData.mockClear();

      act(() => renderer.unmount());
      await act(async () => {});

      expect(mockStopped).toHaveBeenCalledTimes(1);
      expect(mockUserData).toHaveBeenCalledWith("video-1", { PlaybackPositionTicks: 250 * TICKS, Played: false });
      expect(mockStopped.mock.invocationCallOrder[0]).toBeLessThan(mockUserData.mock.invocationCallOrder[0]);
    });

    it("markEnded never persists — the server's played marking is the final state", async () => {
      const getCurrentPosition = jest.fn().mockResolvedValue(1800);
      const { renderer, hook } = renderReporter(makeProps({ videoRef: { current: { getCurrentPosition } as unknown as VideoRef } }));
      act(() => hook().markStarted());
      await tickPoll();
      mockUserData.mockClear();

      act(() => hook().markEnded());
      act(() => renderer.unmount());
      await act(async () => {});

      expect(mockStopped).toHaveBeenCalledTimes(1);
      expect(mockUserData).not.toHaveBeenCalled();
    });
  });

  it("reports paused Progress when the app backgrounds mid-session", () => {
    const listeners: ((state: string) => void)[] = [];
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      listeners.push(handler as (state: string) => void);
      return { remove: jest.fn() } as never;
    });

    const { hook } = renderReporter(makeProps());
    act(() => hook().markStarted());

    act(() => listeners.forEach((listener) => listener("background")));

    expect(mockProgress).toHaveBeenCalledWith(expect.objectContaining({ IsPaused: true }));
    spy.mockRestore();
  });
});
