/**
 * useVideoPlayback - Error Recovery Ladder Tests
 *
 * Exercises planErrorRecovery, the pure decision function behind onError:
 * direct → engine → server, with one engine restart for a mid-playback
 * starvation (STALLED / CoreMedia -12889) before the server rung. Every
 * decision the ladder can take is asserted here, including the exact
 * preservation of the pre-existing paths (credential refresh, transcode
 * seek recovery, up-front transcode latch).
 */

import { PlaybackErrorType, planErrorRecovery, type ErrorRecoveryInput } from "../useVideoPlayback";

// A mid-playback baseline; individual tests override what they probe.
const base: ErrorRecoveryInput = {
  mode: "localRemux",
  errorType: PlaybackErrorType.UNKNOWN,
  currentTimeSec: 120,
  hasTriedRemuxRestart: false,
  hasTriedTranscoding: false,
  hasTriedSeekRecovery: false,
  hasTriedCredentialRefresh: false,
};

describe("planErrorRecovery — engine restart rung", () => {
  it("restarts the engine once for a mid-playback starvation", () => {
    const d = planErrorRecovery({ ...base, errorType: PlaybackErrorType.STALLED });
    expect(d.action.kind).toBe("restartRemux");
    expect(d.latchTranscodeUpFront).toBe(false); // the ladder stays intact
    expect(d.carryPositionSec).toBe(120); // resumes at the playhead
    expect(d.stopRemuxSession).toBe(true); // dead session cleaned up
    expect(d.stallFallback).toBe(false); // not yet on the server
    expect(d.willRetryWithTranscode).toBe(true); // probe/suite semantics
  });

  it("goes to the server on the second starvation, at the floor preset", () => {
    const d = planErrorRecovery({ ...base, errorType: PlaybackErrorType.STALLED, hasTriedRemuxRestart: true });
    expect(d.action.kind).toBe("reportError");
    expect(d.latchTranscodeUpFront).toBe(true);
    expect(d.stallFallback).toBe(true);
    expect(d.carryPositionSec).toBe(120); // mid-film resume on the fallback too
    expect(d.stopRemuxSession).toBe(true);
  });

  it("does not restart the engine for a startup starvation", () => {
    const d = planErrorRecovery({ ...base, errorType: PlaybackErrorType.STALLED, currentTimeSec: 0 });
    expect(d.action.kind).toBe("reportError");
    expect(d.latchTranscodeUpFront).toBe(true); // straight to the server, as before
    expect(d.stallFallback).toBe(true); // but the server entry is still the floor
    expect(d.carryPositionSec).toBeNull();
  });

  it("does not restart the engine for non-starvation errors", () => {
    for (const errorType of [PlaybackErrorType.DECODE, PlaybackErrorType.CORRUPT, PlaybackErrorType.NETWORK, PlaybackErrorType.TIMEOUT, PlaybackErrorType.UNKNOWN, PlaybackErrorType.NOT_FOUND]) {
      const d = planErrorRecovery({ ...base, errorType });
      expect(d.action.kind).toBe("reportError");
      expect(d.stallFallback).toBe(false);
    }
  });

  it("restart threshold is strictly above one second of playback", () => {
    expect(planErrorRecovery({ ...base, errorType: PlaybackErrorType.STALLED, currentTimeSec: 1 }).action.kind).toBe("reportError");
    expect(planErrorRecovery({ ...base, errorType: PlaybackErrorType.STALLED, currentTimeSec: 1.01 }).action.kind).toBe("restartRemux");
  });
});

describe("planErrorRecovery — preserved pre-existing paths", () => {
  it("mid-playback localRemux failure latches transcode up front and carries the playhead", () => {
    const d = planErrorRecovery(base);
    expect(d.action.kind).toBe("reportError");
    expect(d.latchTranscodeUpFront).toBe(true);
    expect(d.willRetryWithTranscode).toBe(true);
    expect(d.carryPositionSec).toBe(120);
    expect(d.stopRemuxSession).toBe(true); // the retry path no longer leaks the session
  });

  it("startup localRemux failure keeps today's behavior (latch, no position carry)", () => {
    const d = planErrorRecovery({ ...base, currentTimeSec: 0 });
    expect(d.action.kind).toBe("reportError");
    expect(d.latchTranscodeUpFront).toBe(true);
    expect(d.carryPositionSec).toBeNull();
  });

  it("direct-play failure never latches; mid-playback carries the playhead to the engine rung", () => {
    const d = planErrorRecovery({ ...base, mode: "direct" });
    expect(d.action.kind).toBe("reportError");
    expect(d.latchTranscodeUpFront).toBe(false);
    expect(d.willRetryWithTranscode).toBe(true);
    expect(d.carryPositionSec).toBe(120);
    expect(d.stopRemuxSession).toBe(false);
  });

  it("credential refresh wins over every other rung and keeps historical resume semantics", () => {
    for (const mode of ["direct", "localRemux", "transcode"] as const) {
      const d = planErrorRecovery({ ...base, mode, errorType: PlaybackErrorType.UNAUTHORIZED });
      expect(d.action.kind).toBe("refreshCredentials");
      expect(d.carryPositionSec).toBeNull();
    }
    // A 401 mid-remux still spends the engine rung up front — today's behavior, preserved.
    expect(planErrorRecovery({ ...base, errorType: PlaybackErrorType.UNAUTHORIZED }).latchTranscodeUpFront).toBe(true);
  });

  it("spent credential refresh falls through to the normal ladder", () => {
    const d = planErrorRecovery({ ...base, errorType: PlaybackErrorType.UNAUTHORIZED, hasTriedCredentialRefresh: true });
    expect(d.action.kind).toBe("reportError");
  });

  it("transcode mid-playback crash takes seek recovery once", () => {
    const d = planErrorRecovery({ ...base, mode: "transcode" });
    expect(d.action.kind).toBe("transcodeSeekRecovery");
    expect(d.carryPositionSec).toBe(120);
    expect(d.latchTranscodeUpFront).toBe(false);
    expect(d.willRetryWithTranscode).toBe(false);
  });

  it("transcode failure is terminal once seek recovery is spent", () => {
    const d = planErrorRecovery({ ...base, mode: "transcode", hasTriedSeekRecovery: true });
    expect(d.action.kind).toBe("reportError");
    expect(d.willRetryWithTranscode).toBe(false);
    expect(d.carryPositionSec).toBeNull();
  });

  it("transcode startup failure is terminal (no seek recovery below the threshold)", () => {
    const d = planErrorRecovery({ ...base, mode: "transcode", currentTimeSec: 0.5 });
    expect(d.action.kind).toBe("reportError");
  });

  it("a localRemux failure with transcode already spent neither latches nor retries", () => {
    const d = planErrorRecovery({ ...base, hasTriedTranscoding: true });
    expect(d.action.kind).toBe("reportError");
    expect(d.latchTranscodeUpFront).toBe(false);
    expect(d.willRetryWithTranscode).toBe(false);
    expect(d.stopRemuxSession).toBe(false);
    expect(d.carryPositionSec).toBeNull();
  });

  it("a starved restart with transcode already spent goes terminal, not into a restart loop", () => {
    const d = planErrorRecovery({ ...base, errorType: PlaybackErrorType.STALLED, hasTriedRemuxRestart: true, hasTriedTranscoding: true });
    expect(d.action.kind).toBe("reportError");
    expect(d.willRetryWithTranscode).toBe(false);
  });
});

describe("classifyPlaybackError — starvation", () => {
  const { classifyPlaybackError } = jest.requireActual<typeof import("../useVideoPlayback")>("../useVideoPlayback");

  it("classifies the native -12889 code+domain shape", () => {
    expect(classifyPlaybackError({ code: -12889, domain: "CoreMediaErrorDomain" })).toBe(PlaybackErrorType.STALLED);
  });

  it("classifies the message-only shape RNV sometimes surfaces", () => {
    expect(classifyPlaybackError({ localizedDescription: "The operation couldn’t be completed. (CoreMediaErrorDomain error -12889.)" })).toBe(PlaybackErrorType.STALLED);
    expect(classifyPlaybackError(new Error("CoreMediaErrorDomain error -12889"))).toBe(PlaybackErrorType.STALLED);
  });

  it("does not confuse other CoreMedia codes with starvation", () => {
    expect(classifyPlaybackError({ code: -12971, domain: "CoreMediaErrorDomain" })).toBe(PlaybackErrorType.DECODE);
    expect(classifyPlaybackError({ code: -12889, domain: "SomeOtherDomain" })).not.toBe(PlaybackErrorType.STALLED);
  });
});
