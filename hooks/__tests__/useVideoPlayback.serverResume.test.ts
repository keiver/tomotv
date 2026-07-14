/**
 * useVideoPlayback.serverResume.test.ts
 *
 * Tests for the server-side resume decision in fetchMetadata: UserData.PlaybackPositionTicks
 * (populated by fetchVideoDetails with EnableUserData=true) maps to StartTimeTicks for
 * transcode or a client-side seek for direct play, and never overrides a pending seek.
 *
 * Tests the logic flow with plain variables (no React rendering), following
 * the existing test pattern in this codebase.
 */

import type { PlaybackMode } from "../useVideoPlayback";

const TICKS_PER_SECOND = 10000000;

/**
 * Simulates the server-resume decision from fetchMetadata
 * (useVideoPlayback.ts, "Server-side resume position from item UserData" block).
 */
function evaluateServerResume(params: { playbackPositionTicks: number | undefined; selectedMode: PlaybackMode; seekToPositionAfterLoad: number | null; startTimeTicks: number | null }): {
  startTimeTicks: number | null;
  seekToPositionAfterLoad: number | null;
  resumePositionForFallback: number | null;
} {
  const { playbackPositionTicks, selectedMode, seekToPositionAfterLoad, startTimeTicks } = params;

  // A pending seek (audio-switch restart, seek recovery) always wins over server resume
  if (seekToPositionAfterLoad !== null || startTimeTicks !== null) {
    return { startTimeTicks, seekToPositionAfterLoad, resumePositionForFallback: null };
  }

  if (playbackPositionTicks && playbackPositionTicks > 0) {
    const resumePosition = playbackPositionTicks / TICKS_PER_SECOND;
    if (selectedMode === "transcode") {
      return { startTimeTicks: playbackPositionTicks, seekToPositionAfterLoad: null, resumePositionForFallback: resumePosition };
    }
    return { startTimeTicks: null, seekToPositionAfterLoad: resumePosition, resumePositionForFallback: null };
  }

  return { startTimeTicks: null, seekToPositionAfterLoad: null, resumePositionForFallback: null };
}

describe("server-side resume decision", () => {
  it("maps PlaybackPositionTicks to StartTimeTicks with a fallback position in transcode mode", () => {
    const result = evaluateServerResume({
      playbackPositionTicks: 600 * TICKS_PER_SECOND,
      selectedMode: "transcode",
      seekToPositionAfterLoad: null,
      startTimeTicks: null,
    });

    expect(result.startTimeTicks).toBe(600 * TICKS_PER_SECOND);
    expect(result.resumePositionForFallback).toBe(600);
    expect(result.seekToPositionAfterLoad).toBeNull();
  });

  it("maps PlaybackPositionTicks to a client-side seek in direct mode", () => {
    const result = evaluateServerResume({
      playbackPositionTicks: 90 * TICKS_PER_SECOND,
      selectedMode: "direct",
      seekToPositionAfterLoad: null,
      startTimeTicks: null,
    });

    expect(result.seekToPositionAfterLoad).toBe(90);
    expect(result.startTimeTicks).toBeNull();
  });

  it("does not resume when PlaybackPositionTicks is absent", () => {
    const result = evaluateServerResume({
      playbackPositionTicks: undefined,
      selectedMode: "direct",
      seekToPositionAfterLoad: null,
      startTimeTicks: null,
    });

    expect(result.seekToPositionAfterLoad).toBeNull();
    expect(result.startTimeTicks).toBeNull();
  });

  it("does not resume when PlaybackPositionTicks is 0 (unwatched item)", () => {
    const result = evaluateServerResume({
      playbackPositionTicks: 0,
      selectedMode: "transcode",
      seekToPositionAfterLoad: null,
      startTimeTicks: null,
    });

    expect(result.startTimeTicks).toBeNull();
    expect(result.resumePositionForFallback).toBeNull();
  });

  it("never overrides a pending seek (audio-switch restart or seek recovery)", () => {
    const result = evaluateServerResume({
      playbackPositionTicks: 600 * TICKS_PER_SECOND,
      selectedMode: "transcode",
      seekToPositionAfterLoad: 1200,
      startTimeTicks: null,
    });

    expect(result.seekToPositionAfterLoad).toBe(1200);
    expect(result.startTimeTicks).toBeNull();
  });
});
