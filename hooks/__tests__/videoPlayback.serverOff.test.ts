/** The error screen's server-lane line: which failures it is said for, how the state carries it, and its copy. */
import { serverOffText } from "@/hooks/usePlaybackStage";
import { ServerTranscodeOffError, serverOffForError } from "@/hooks/videoPlayback/errorRecovery";
import { videoPlayerReducer } from "@/hooks/videoPlayback/machine";
import { PlaybackErrorType } from "@/utils/errorClassification";

jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/utils/logger", () => ({ logger: { debug: jest.fn() } }));

describe("serverOffForError", () => {
  it("marks the lane pick's error as needing the server, whoever turned it off", () => {
    expect(serverOffForError(new ServerTranscodeOffError("device"), PlaybackErrorType.UNKNOWN, null, false)).toEqual({ by: "device", needed: true });
    expect(serverOffForError(new ServerTranscodeOffError("account"), PlaybackErrorType.UNKNOWN, null, false)).toEqual({ by: "account", needed: true });
  });

  it("names the block on a failure the server rung would have taken", () => {
    for (const type of [PlaybackErrorType.UNKNOWN, PlaybackErrorType.DECODE, PlaybackErrorType.CORRUPT, PlaybackErrorType.STALLED, PlaybackErrorType.TIMEOUT]) {
      expect(serverOffForError(new Error("x"), type, "account", false)).toEqual({ by: "account", needed: false });
    }
  });

  it("says nothing where the server could not have helped, it was allowed, or the file is on this device", () => {
    for (const type of [PlaybackErrorType.UNAUTHORIZED, PlaybackErrorType.NOT_FOUND, PlaybackErrorType.PROTECTED, PlaybackErrorType.NETWORK]) {
      expect(serverOffForError(new Error("x"), type, "device", false)).toBeUndefined();
    }
    expect(serverOffForError(new Error("x"), PlaybackErrorType.UNKNOWN, null, false)).toBeUndefined();
    expect(serverOffForError(new Error("x"), PlaybackErrorType.UNKNOWN, "device", true)).toBeUndefined();
  });
});

describe("the error state", () => {
  it("carries the server-lane reason with the error, and leaves it off when there is none", () => {
    const off = videoPlayerReducer({ type: "IDLE" }, { type: "PLAYER_ERROR", mode: "localRemux", error: { message: "m", serverOff: { by: "device", needed: false } }, hasTriedTranscode: true });
    expect(off).toMatchObject({ type: "ERROR", serverOff: { by: "device", needed: false } });
    const plain = videoPlayerReducer({ type: "IDLE" }, { type: "PLAYER_ERROR", mode: "localRemux", error: { message: "m" }, hasTriedTranscode: true });
    expect(plain).not.toHaveProperty("serverOff");
  });
});

describe("serverOffText", () => {
  it("reads as the headline when the server was the only lane, and as a note otherwise", () => {
    expect(serverOffText({ by: "account", needed: true })).toBe("player.serverOff.neededAccount");
    expect(serverOffText({ by: "device", needed: true })).toBe("player.serverOff.neededDevice");
    expect(serverOffText({ by: "account", needed: false })).toBe("player.serverOff.account");
    expect(serverOffText({ by: "device", needed: false })).toBe("player.serverOff.device");
  });
});
