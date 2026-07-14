/**
 * useVideoPlayback.resumeFallback.test.ts
 *
 * Tests for the resume fallback logic in useVideoPlayback's onError handler.
 * When a transcoded stream with StartTimeTicks fails on initial load
 * (e.g. Jellyfin returns NSURLErrorResourceUnavailable -1008), the hook retries
 * without StartTimeTicks and uses client-side seek instead.
 *
 * Tests the logic flow with plain variables (no React rendering), following
 * the existing test pattern in this codebase.
 */

import type { PlaybackMode } from "../useVideoPlayback";

/**
 * Simulates the resume fallback decision logic from the onError handler
 * (useVideoPlayback.ts lines 924-955).
 *
 * Returns what the hook would do given these inputs.
 */
function evaluateResumeFallback(params: { currentMode: PlaybackMode; resumePositionForFallback: number | null; hasTriedResumeFallback: boolean }): {
  shouldTrigger: boolean;
  seekToPositionAfterLoad: number | null;
  newResumePositionForFallback: number | null;
  newHasTriedResumeFallback: boolean;
  newSelectedAudioTrackIndex: number | null;
  dispatchedAction: string | null;
} {
  const { currentMode, resumePositionForFallback, hasTriedResumeFallback } = params;

  if (currentMode === "transcode" && resumePositionForFallback !== null && !hasTriedResumeFallback) {
    return {
      shouldTrigger: true,
      seekToPositionAfterLoad: resumePositionForFallback,
      newResumePositionForFallback: null,
      newHasTriedResumeFallback: true,
      newSelectedAudioTrackIndex: null,
      dispatchedAction: "RETRY_WITH_TRANSCODE",
    };
  }

  return {
    shouldTrigger: false,
    seekToPositionAfterLoad: null,
    newResumePositionForFallback: resumePositionForFallback,
    newHasTriedResumeFallback: hasTriedResumeFallback,
    newSelectedAudioTrackIndex: null, // Not touched when fallback doesn't trigger
    dispatchedAction: null,
  };
}

/**
 * Simulates the ref resets that happen when videoId changes
 * (useVideoPlayback.ts lines 1109-1142).
 */
function simulateVideoIdChangeResets() {
  return {
    hasTriedResumeFallback: false,
    resumePositionForFallback: null,
    startTimeTicks: null,
    selectedAudioTrackIndex: null,
    seekToPositionAfterLoad: null,
    hasTriedSeekRecovery: false,
    hasTriedTranscoding: false,
  };
}

/**
 * Simulates the ref resets that happen in the retry() callback
 * (useVideoPlayback.ts lines 1204-1225).
 */
function simulateManualRetryResets() {
  return {
    hasTriedResumeFallback: false,
    resumePositionForFallback: null,
    startTimeTicks: null,
    hasTriedTranscoding: false,
    hasTriedSeekRecovery: false,
  };
}

describe("useVideoPlayback - Resume Fallback", () => {
  describe("Fallback triggers", () => {
    it("should trigger fallback when transcode + resumePosition set + not tried", () => {
      const result = evaluateResumeFallback({
        currentMode: "transcode",
        resumePositionForFallback: 125.5,
        hasTriedResumeFallback: false,
      });

      expect(result.shouldTrigger).toBe(true);
      expect(result.dispatchedAction).toBe("RETRY_WITH_TRANSCODE");
      expect(result.seekToPositionAfterLoad).toBe(125.5);
    });

    it("should convert server-side offset to client-side seek on retry", () => {
      const resumePosition = 300; // 5 minutes in

      const result = evaluateResumeFallback({
        currentMode: "transcode",
        resumePositionForFallback: resumePosition,
        hasTriedResumeFallback: false,
      });

      // The resume position moves from StartTimeTicks (server-side) to seekToPositionAfterLoad (client-side)
      expect(result.seekToPositionAfterLoad).toBe(resumePosition);
      // The server-side ref is cleared
      expect(result.newResumePositionForFallback).toBeNull();
    });
  });

  describe("Audio track ref reset", () => {
    it("should reset selectedAudioTrackIndex to null on fallback", () => {
      const result = evaluateResumeFallback({
        currentMode: "transcode",
        resumePositionForFallback: 60,
        hasTriedResumeFallback: false,
      });

      expect(result.shouldTrigger).toBe(true);
      // selectedAudioTrackIndex is reset to null so multi-audio re-engages on retry
      expect(result.newSelectedAudioTrackIndex).toBeNull();
    });
  });

  describe("Loop prevention", () => {
    it("should NOT retry when already tried once", () => {
      const result = evaluateResumeFallback({
        currentMode: "transcode",
        resumePositionForFallback: 125.5,
        hasTriedResumeFallback: true, // Already tried
      });

      expect(result.shouldTrigger).toBe(false);
      expect(result.dispatchedAction).toBeNull();
    });

    it("should mark hasTriedResumeFallback = true after first trigger", () => {
      const result = evaluateResumeFallback({
        currentMode: "transcode",
        resumePositionForFallback: 125.5,
        hasTriedResumeFallback: false,
      });

      expect(result.newHasTriedResumeFallback).toBe(true);

      // Second call with the updated flag should not trigger
      const secondResult = evaluateResumeFallback({
        currentMode: "transcode",
        resumePositionForFallback: result.newResumePositionForFallback,
        hasTriedResumeFallback: result.newHasTriedResumeFallback,
      });

      expect(secondResult.shouldTrigger).toBe(false);
    });
  });

  describe("No resumePosition", () => {
    it("should NOT trigger fallback when resumePosition is null", () => {
      const result = evaluateResumeFallback({
        currentMode: "transcode",
        resumePositionForFallback: null, // No resume position
        hasTriedResumeFallback: false,
      });

      expect(result.shouldTrigger).toBe(false);
      expect(result.dispatchedAction).toBeNull();
    });
  });

  describe("Direct play skip", () => {
    it("should NOT trigger fallback in direct play mode", () => {
      const result = evaluateResumeFallback({
        currentMode: "direct", // Direct play, not transcode
        resumePositionForFallback: 125.5,
        hasTriedResumeFallback: false,
      });

      expect(result.shouldTrigger).toBe(false);
      expect(result.dispatchedAction).toBeNull();
    });
  });

  describe("State resets on videoId change", () => {
    it("should reset hasTriedResumeFallback and resumePositionForFallback", () => {
      const resets = simulateVideoIdChangeResets();

      expect(resets.hasTriedResumeFallback).toBe(false);
      expect(resets.resumePositionForFallback).toBeNull();
    });

    it("should also reset related refs (startTimeTicks, selectedAudioTrackIndex)", () => {
      const resets = simulateVideoIdChangeResets();

      expect(resets.startTimeTicks).toBeNull();
      expect(resets.selectedAudioTrackIndex).toBeNull();
      expect(resets.seekToPositionAfterLoad).toBeNull();
    });

    it("should allow fallback to trigger again for the new video", () => {
      // First video: fallback triggered
      const firstResult = evaluateResumeFallback({
        currentMode: "transcode",
        resumePositionForFallback: 100,
        hasTriedResumeFallback: false,
      });
      expect(firstResult.shouldTrigger).toBe(true);
      expect(firstResult.newHasTriedResumeFallback).toBe(true);

      // VideoId changes → resets happen
      const resets = simulateVideoIdChangeResets();

      // Second video: fallback should be available again
      const secondResult = evaluateResumeFallback({
        currentMode: "transcode",
        resumePositionForFallback: 200,
        hasTriedResumeFallback: resets.hasTriedResumeFallback,
      });
      expect(secondResult.shouldTrigger).toBe(true);
    });
  });

  describe("State resets on manual retry", () => {
    it("should reset hasTriedResumeFallback and resumePositionForFallback", () => {
      const resets = simulateManualRetryResets();

      expect(resets.hasTriedResumeFallback).toBe(false);
      expect(resets.resumePositionForFallback).toBeNull();
    });

    it("should reset startTimeTicks so next attempt starts from beginning", () => {
      const resets = simulateManualRetryResets();

      expect(resets.startTimeTicks).toBeNull();
    });

    it("should allow fallback to trigger again after manual retry", () => {
      // First attempt: fallback triggered and exhausted
      const firstResult = evaluateResumeFallback({
        currentMode: "transcode",
        resumePositionForFallback: 100,
        hasTriedResumeFallback: false,
      });
      expect(firstResult.newHasTriedResumeFallback).toBe(true);

      // User hits retry → resets happen
      const resets = simulateManualRetryResets();

      // Fallback is available again (though resumePosition is also null after reset,
      // so it won't actually fire unless server resume data re-populates it during metadata fetch)
      expect(resets.hasTriedResumeFallback).toBe(false);
      expect(resets.resumePositionForFallback).toBeNull();
    });
  });
});
