/**
 * useVideoPlayback.serverResume.test.ts
 *
 * Tests for the server-side resume decision in fetchMetadata:
 * UserData.PlaybackPositionTicks (populated by fetchVideoDetails with
 * EnableUserData=true) becomes a client-side seek in every playback mode, and
 * never overrides a seek that is already pending.
 *
 * StartTimeTicks is deliberately not used for resume: with fMP4 segments
 * (required for HEVC stream copy) Jellyfin answers the EXT-X-MAP init segment
 * with HTTP 400 whenever StartTimeTicks is set.
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
function evaluateServerResume(params: { playbackPositionTicks: number | undefined; selectedMode: PlaybackMode; seekToPositionAfterLoad: number | null }): {
  seekToPositionAfterLoad: number | null;
} {
  const { playbackPositionTicks, seekToPositionAfterLoad } = params;

  // A pending seek (audio-switch restart, seek recovery) always wins over server resume
  if (seekToPositionAfterLoad !== null) {
    return { seekToPositionAfterLoad };
  }

  if (playbackPositionTicks && playbackPositionTicks > 0) {
    return { seekToPositionAfterLoad: playbackPositionTicks / TICKS_PER_SECOND };
  }

  return { seekToPositionAfterLoad: null };
}

describe("server-side resume decision", () => {
  it.each<PlaybackMode>(["direct", "transcode", "localRemux"])("maps PlaybackPositionTicks to a client-side seek in %s mode", (selectedMode) => {
    const result = evaluateServerResume({
      playbackPositionTicks: 600 * TICKS_PER_SECOND,
      selectedMode,
      seekToPositionAfterLoad: null,
    });

    expect(result.seekToPositionAfterLoad).toBe(600);
  });

  it("does not resume when PlaybackPositionTicks is absent", () => {
    const result = evaluateServerResume({
      playbackPositionTicks: undefined,
      selectedMode: "direct",
      seekToPositionAfterLoad: null,
    });

    expect(result.seekToPositionAfterLoad).toBeNull();
  });

  it("does not resume when PlaybackPositionTicks is 0 (unwatched item)", () => {
    const result = evaluateServerResume({
      playbackPositionTicks: 0,
      selectedMode: "transcode",
      seekToPositionAfterLoad: null,
    });

    expect(result.seekToPositionAfterLoad).toBeNull();
  });

  it("never overrides a pending seek (audio-switch restart or seek recovery)", () => {
    const result = evaluateServerResume({
      playbackPositionTicks: 600 * TICKS_PER_SECOND,
      selectedMode: "transcode",
      seekToPositionAfterLoad: 1200,
    });

    expect(result.seekToPositionAfterLoad).toBe(1200);
  });
});
