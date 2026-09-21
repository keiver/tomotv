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
import { automaticRetryDelay, planLiveErrorRecovery, shouldAutomaticallyRetry } from "../videoPlayback/errorRecovery";

describe("automatic network recovery", () => {
  it("caps the delay without exhausting retries", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20, 1000].map(automaticRetryDelay)).toEqual([500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it.each([PlaybackErrorType.NETWORK, PlaybackErrorType.TIMEOUT, PlaybackErrorType.STALLED, PlaybackErrorType.CORRUPT, PlaybackErrorType.DECODE, PlaybackErrorType.UNKNOWN])(
    "keeps retrying %s rather than treating its message as proof of an unplayable file",
    (errorType) => {
      expect(shouldAutomaticallyRetry({ live: false, heldOnDisk: false, errorType })).toBe(true);
    },
  );

  it("leaves live and offline recovery to their existing policies", () => {
    expect(shouldAutomaticallyRetry({ live: true, heldOnDisk: false, errorType: PlaybackErrorType.NETWORK })).toBe(false);
    expect(shouldAutomaticallyRetry({ live: false, heldOnDisk: true, errorType: PlaybackErrorType.NETWORK })).toBe(false);
    expect(shouldAutomaticallyRetry({ live: false, heldOnDisk: false, errorType: PlaybackErrorType.UNAUTHORIZED })).toBe(false);
  });
});

// A mid-playback baseline; individual tests override what they probe.
const base: ErrorRecoveryInput = {
  mode: "localRemux",
  errorType: PlaybackErrorType.UNKNOWN,
  currentTimeSec: 120,
  hasTriedRemuxRestart: false,
  hasTriedTranscoding: false,
  hasTriedSeekRecovery: false,
  hasTriedCredentialRefresh: false,
  heldOnDisk: false,
  hasDroppedSubtitles: false,
};

describe("network gateway item recovery", () => {
  it.each([PlaybackErrorType.STALLED, PlaybackErrorType.NETWORK, PlaybackErrorType.TIMEOUT])("preserves the original supplier after repeated %s failures", (errorType) => {
    const decision = planErrorRecovery({ ...base, networkGateway: true, errorType, hasTriedRemuxRestart: true });
    expect(decision).toMatchObject({ retryGateway: true, latchTranscodeUpFront: false, stallFallback: false, stopRemuxSession: true, carryPositionSec: 120, action: { kind: "reportError" } });
  });

  it.each([PlaybackErrorType.STALLED, PlaybackErrorType.NETWORK, PlaybackErrorType.TIMEOUT])("does not revive a confirmed unavailable producer after %s", (errorType) => {
    expect(planErrorRecovery({ ...base, networkGateway: true, hasTriedTranscoding: true, errorType }).retryGateway).toBe(false);
  });

  it.each([PlaybackErrorType.DECODE, PlaybackErrorType.CORRUPT, PlaybackErrorType.UNKNOWN])("retains server-only fallback for structural %s failures", (errorType) => {
    expect(planErrorRecovery({ ...base, networkGateway: true, errorType })).toMatchObject({ retryGateway: false, latchTranscodeUpFront: true });
  });
});

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

describe("planErrorRecovery — a held file degrades instead of reaching a server", () => {
  it("spends the subtitles rather than the transcode rung, and stops the dead session", () => {
    const d = planErrorRecovery({ ...base, heldOnDisk: true });
    expect(d.dropSubtitles).toBe(true);
    // Retries, but never latched: the pick has to be free to land on direct play.
    expect(d.willRetryWithTranscode).toBe(true);
    expect(d.carryPositionSec).toBe(120);
    expect(d.latchTranscodeUpFront).toBe(false);
    expect(d.stopRemuxSession).toBe(true);
  });

  // The duplicate error. RNV observes AVPlayerItemFailedToPlayToEndTime with object: nil, so a
  // second failure can land before the retry runs; latching the rung there is what put a
  // download on a server the replay from disk exists to avoid.
  it("spends no rung on a second failure arriving before the replay", () => {
    const d = planErrorRecovery({ ...base, heldOnDisk: true, hasDroppedSubtitles: true });
    expect(d.dropSubtitles).toBe(false);
    expect(d.latchTranscodeUpFront).toBe(false);
  });

  it("still latches the rung for a streamed file on the same input", () => {
    expect(planErrorRecovery({ ...base, heldOnDisk: false, hasDroppedSubtitles: true }).latchTranscodeUpFront).toBe(true);
  });

  // The playhead rides the retry. Deriving it from a narrowed retry flag silently resumed a
  // held file from wherever the launching screen was rather than where the viewer was.
  it("carries the playhead into the replay", () => {
    expect(planErrorRecovery({ ...base, heldOnDisk: true }).carryPositionSec).toBe(120);
  });

  it("still latches the server rung for the same failure on a streamed file", () => {
    const d = planErrorRecovery({ ...base, heldOnDisk: false });
    expect(d.willRetryWithTranscode).toBe(true);
    expect(d.latchTranscodeUpFront).toBe(true);
    expect(d.dropSubtitles).toBe(false);
  });

  it("leaves the engine restart rung ahead of the subtitle drop for a held stall", () => {
    const d = planErrorRecovery({ ...base, heldOnDisk: true, errorType: PlaybackErrorType.STALLED });
    expect(d.action).toEqual({ kind: "restartRemux" });
    expect(d.dropSubtitles).toBe(false);
  });
});

describe("planLiveErrorRecovery", () => {
  const base = { mode: "localRemux" as const, errorType: PlaybackErrorType.STALLED, hasReopened: false, lane: "engine" as const };

  it("opens the channel afresh on its first drop: a dropped tuner only comes back that way", () => {
    expect(planLiveErrorRecovery(base)).toEqual({ reopen: true, toServer: false, retry: true });
  });

  it("takes the server's transcode on the second drop", () => {
    expect(planLiveErrorRecovery({ ...base, hasReopened: true })).toEqual({ reopen: false, toServer: true, retry: true });
  });

  it("ends at the error once the channel is already on the server", () => {
    expect(planLiveErrorRecovery({ ...base, mode: "transcode", hasReopened: true, lane: "server" })).toEqual({ reopen: false, toServer: false, retry: false });
  });

  it("spends no cold opens on a 401, which fails every rung the same way", () => {
    expect(planLiveErrorRecovery({ ...base, errorType: PlaybackErrorType.UNAUTHORIZED })).toEqual({ reopen: false, toServer: false, retry: false });
  });

  it("does not reopen from the server lane, which is the last rung", () => {
    expect(planLiveErrorRecovery({ ...base, mode: "transcode", lane: "server" })).toEqual({ reopen: false, toServer: false, retry: false });
  });
});
