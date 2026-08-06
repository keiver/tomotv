/**
 * usePlaybackReporter — Stopped/Progress position regression tests.
 *
 * Renders the REAL hook (not a logic mirror — a mirror would just restate the fix).
 * Regression under test: a resumed session backed out before the first 8-second poll
 * tick used to report Stopped at position 0, and the server applies the Stopped
 * report's PositionTicks to playstate — wiping the resume point and dropping the
 * item from Continue Watching. The fix seeds the sampled position in markStarted and
 * prefers the live onProgress clock (positionSecondsRef) for event-driven reports.
 */

import React, { useRef } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { usePlaybackReporter } from "../usePlaybackReporter";

const TICKS_PER_SECOND = 10_000_000;

const mockReportStart = jest.fn().mockResolvedValue(undefined);
const mockReportProgress = jest.fn().mockResolvedValue(undefined);
const mockReportStopped = jest.fn().mockResolvedValue(undefined);
const mockUpdateUserItemData = jest.fn().mockResolvedValue(undefined);
const mockMarkItemPlayed = jest.fn();

jest.mock("@/services/jellyfinApi", () => ({
  JELLYFIN_TIME: { TICKS_PER_SECOND: 10_000_000 },
  reportPlaybackStart: (...args: unknown[]) => mockReportStart(...args),
  reportPlaybackProgress: (...args: unknown[]) => mockReportProgress(...args),
  reportPlaybackStopped: (...args: unknown[]) => mockReportStopped(...args),
  updateUserItemData: (...args: unknown[]) => mockUpdateUserItemData(...args),
  markItemPlayed: (...args: unknown[]) => mockMarkItemPlayed(...args),
}));

type ReporterApi = ReturnType<typeof usePlaybackReporter>;

/** Mounts the real hook with controllable refs and hands its API out. */
function Probe({
  positionSeconds,
  duration,
  onApi,
  pendingSeekTarget,
}: {
  positionSeconds: React.RefObject<number>;
  duration: number;
  onApi: (api: ReporterApi) => void;
  pendingSeekTarget?: React.RefObject<number | null>;
}) {
  const videoRef = useRef(null);
  const durationRef = useRef(duration);
  const mediaSourceIdRef = useRef<string | null>("source-1");
  const playSessionIdRef = useRef("session-1");
  const isPlayingRef = useRef(true);
  const currentModeRef = useRef<"direct" | "transcode" | "localRemux">("localRemux");
  const audioStreamIndexRef = useRef<number | null>(1);
  const wasPlayedAtStartRef = useRef<boolean | null>(false);
  const localPendingSeekTargetRef = useRef<number | null>(null);
  const pendingSeekTargetRef = pendingSeekTarget ?? localPendingSeekTargetRef;

  const api = usePlaybackReporter({
    videoId: "video-1",
    videoRef,
    durationRef,
    mediaSourceIdRef,
    playSessionIdRef,
    isPlayingRef,
    currentModeRef,
    audioStreamIndexRef,
    wasPlayedAtStartRef,
    positionSecondsRef: positionSeconds,
    pendingSeekTargetRef,
  });
  onApi(api);
  return null;
}

function mountReporter(positionSeconds: React.RefObject<number>, duration = 3323, pendingSeekTarget?: React.RefObject<number | null>) {
  let api: ReporterApi | undefined;
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Probe positionSeconds={positionSeconds} duration={duration} onApi={(a) => (api = a)} pendingSeekTarget={pendingSeekTarget} />);
  });
  return { api: api!, renderer: renderer! };
}

describe("usePlaybackReporter positions", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reports Stopped at the resume position when backing out before the first poll tick", async () => {
    const positionSeconds = { current: 0 };
    const { api, renderer } = mountReporter(positionSeconds);

    act(() => {
      api.markStarted(67.18 * TICKS_PER_SECOND);
    });

    // Back out immediately: no poll tick, no onProgress tick.
    await act(async () => {
      renderer.unmount();
    });

    expect(mockReportStopped).toHaveBeenCalledTimes(1);
    const body = mockReportStopped.mock.calls[0][0];
    expect(body.PositionTicks).toBe(Math.round(67.18 * TICKS_PER_SECOND));
    // The seeded position also persists through the gate-free UserData write.
    expect(mockUpdateUserItemData).toHaveBeenCalledWith("video-1", {
      PlaybackPositionTicks: Math.round(67.18 * TICKS_PER_SECOND),
      Played: false,
    });
  });

  it("prefers the live onProgress clock over the seed for Stopped", async () => {
    const positionSeconds = { current: 0 };
    const { api, renderer } = mountReporter(positionSeconds);

    act(() => {
      api.markStarted(67.18 * TICKS_PER_SECOND);
    });
    positionSeconds.current = 123.4;

    await act(async () => {
      renderer.unmount();
    });

    expect(mockReportStopped.mock.calls[0][0].PositionTicks).toBe(Math.round(123.4 * TICKS_PER_SECOND));
  });

  it("back-out during a pending auto-seek reports the seed, not the pre-seek clock", async () => {
    const positionSeconds = { current: 0 };
    const pendingSeekTarget = { current: null as number | null };
    const { api, renderer } = mountReporter(positionSeconds, 3323, pendingSeekTarget);

    act(() => {
      api.markStarted(2200 * TICKS_PER_SECOND);
    });
    // Resume seek issued but not yet completed: the live clock ticked with the
    // player's pre-seek position (~0). Without the guard this would become the
    // Stopped position and the server would wipe the resume point.
    pendingSeekTarget.current = 2200;
    positionSeconds.current = 0.04;

    await act(async () => {
      renderer.unmount();
    });

    expect(mockReportStopped.mock.calls[0][0].PositionTicks).toBe(Math.round(2200 * TICKS_PER_SECOND));
    expect(mockUpdateUserItemData).toHaveBeenCalledWith("video-1", {
      PlaybackPositionTicks: Math.round(2200 * TICKS_PER_SECOND),
      Played: false,
    });
  });

  it("still closes a from-scratch session at 0 without persisting a resume point", async () => {
    const positionSeconds = { current: 0 };
    const { api, renderer } = mountReporter(positionSeconds);

    act(() => {
      api.markStarted();
    });

    await act(async () => {
      renderer.unmount();
    });

    expect(mockReportStopped).toHaveBeenCalledTimes(1);
    expect(mockReportStopped.mock.calls[0][0].PositionTicks).toBe(0);
    // < 2s window: nothing to resume, nothing persisted.
    expect(mockUpdateUserItemData).not.toHaveBeenCalled();
  });

  describe("played checkmark signal", () => {
    it("markEnded signals played exactly once (natural end)", async () => {
      const positionSeconds = { current: 0 };
      const { api, renderer } = mountReporter(positionSeconds);

      act(() => {
        api.markStarted();
      });
      act(() => {
        api.markEnded();
      });

      expect(mockMarkItemPlayed).toHaveBeenCalledTimes(1);
      expect(mockMarkItemPlayed).toHaveBeenCalledWith("video-1", true);

      // The unmount cleanup is guarded by endedRef — no second signal.
      await act(async () => {
        renderer.unmount();
      });
      expect(mockMarkItemPlayed).toHaveBeenCalledTimes(1);
    });

    it("backing out past the 95% threshold signals played", async () => {
      const positionSeconds = { current: 0 };
      const { api, renderer } = mountReporter(positionSeconds, 100);

      act(() => {
        api.markStarted();
      });
      positionSeconds.current = 96; // 96% of 100s

      await act(async () => {
        renderer.unmount();
      });

      expect(mockMarkItemPlayed).toHaveBeenCalledWith("video-1", true);
    });

    it("backing out below the threshold does not signal played", async () => {
      const positionSeconds = { current: 0 };
      const { api, renderer } = mountReporter(positionSeconds, 100);

      act(() => {
        api.markStarted();
      });
      positionSeconds.current = 50;

      await act(async () => {
        renderer.unmount();
      });

      expect(mockMarkItemPlayed).not.toHaveBeenCalled();
    });

    it("resetSession applies the same threshold rule", async () => {
      const positionSeconds = { current: 0 };
      const { api, renderer } = mountReporter(positionSeconds, 100);

      act(() => {
        api.markStarted();
      });
      positionSeconds.current = 50;
      await act(async () => {
        api.resetSession(); // below threshold — no signal
      });
      expect(mockMarkItemPlayed).not.toHaveBeenCalled();

      act(() => {
        api.markStarted();
      });
      positionSeconds.current = 97;
      await act(async () => {
        api.resetSession(); // past threshold — signals played
      });
      expect(mockMarkItemPlayed).toHaveBeenCalledWith("video-1", true);

      await act(async () => {
        renderer.unmount();
      });
    });
  });

  it("uses the live clock for pause reports", async () => {
    const positionSeconds = { current: 0 };
    const { api, renderer } = mountReporter(positionSeconds);

    act(() => {
      api.markStarted(10 * TICKS_PER_SECOND);
    });
    positionSeconds.current = 45;

    await act(async () => {
      api.reportPauseChange(true);
    });

    expect(mockReportProgress).toHaveBeenCalledTimes(1);
    const body = mockReportProgress.mock.calls[0][0];
    expect(body.PositionTicks).toBe(45 * TICKS_PER_SECOND);
    expect(body.IsPaused).toBe(true);

    await act(async () => {
      renderer.unmount();
    });
  });
});
