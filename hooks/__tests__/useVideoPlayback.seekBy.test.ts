/**
 * useVideoPlayback.seekBy.test.ts
 *
 * Tests for the relative seek used by tvOS remote-driven skips on audio-only
 * playback (useVideoPlayback.ts, seekBy). AVKit's audio presentation exposes no
 * focusable UI on tvOS, so left/right remote events never reach the transport
 * bar and must seek from JS.
 *
 * Tests the logic flow with plain variables (no React rendering), following
 * the existing test pattern in this codebase.
 */

/**
 * Simulates seekBy from useVideoPlayback: clamps the target to [0, duration - 1],
 * no-ops before the media has loaded, and optimistically advances the current
 * time so rapid presses accumulate instead of seeking from a stale position.
 */
function createSeekBy(refs: { currentTime: number; duration: number }, seek: (position: number) => void) {
  return (offsetSeconds: number) => {
    const duration = refs.duration;
    if (duration <= 0) return;
    const target = Math.max(0, Math.min(duration - 1, refs.currentTime + offsetSeconds));
    refs.currentTime = target;
    seek(target);
  };
}

describe("seekBy relative seek", () => {
  it("seeks forward and backward from the current position", () => {
    const refs = { currentTime: 100, duration: 300 };
    const seek = jest.fn();
    const seekBy = createSeekBy(refs, seek);

    seekBy(10);
    expect(seek).toHaveBeenLastCalledWith(110);

    seekBy(-10);
    expect(seek).toHaveBeenLastCalledWith(100);
  });

  it("clamps backward seeks at 0", () => {
    const refs = { currentTime: 4, duration: 300 };
    const seek = jest.fn();
    const seekBy = createSeekBy(refs, seek);

    seekBy(-10);
    expect(seek).toHaveBeenCalledWith(0);
  });

  it("clamps forward seeks at duration - 1", () => {
    const refs = { currentTime: 295, duration: 300 };
    const seek = jest.fn();
    const seekBy = createSeekBy(refs, seek);

    seekBy(10);
    expect(seek).toHaveBeenCalledWith(299);
  });

  it("no-ops before the media has loaded (duration 0)", () => {
    const refs = { currentTime: 0, duration: 0 };
    const seek = jest.fn();
    const seekBy = createSeekBy(refs, seek);

    seekBy(10);
    expect(seek).not.toHaveBeenCalled();
    expect(refs.currentTime).toBe(0);
  });

  it("accumulates rapid presses from the optimistic position, not a stale onProgress value", () => {
    const refs = { currentTime: 100, duration: 300 };
    const seek = jest.fn();
    const seekBy = createSeekBy(refs, seek);

    seekBy(10);
    seekBy(10);
    seekBy(10);

    expect(seek).toHaveBeenNthCalledWith(1, 110);
    expect(seek).toHaveBeenNthCalledWith(2, 120);
    expect(seek).toHaveBeenNthCalledWith(3, 130);
    expect(refs.currentTime).toBe(130);
  });
});
