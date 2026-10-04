/** The error ID registry and the line the error screen and Diagnostics show. */
import fs from "node:fs";
import path from "node:path";
import { errorIdOf, formatErrorRef, IdentifiedError, nativeErrorOf, PLAYBACK_ERROR_IDS } from "../errorIds";

describe("PLAYBACK_ERROR_IDS", () => {
  const ids = Object.values(PLAYBACK_ERROR_IDS);

  it("names every cause once, in the playback family, upper case words and numbers only", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^PB(-[A-Z0-9]+)+$/);
  });

  it("has a site for every ID: none is dead weight in the registry", () => {
    const sources = ["hooks/useVideoPlayback.ts", "hooks/videoPlayback/errorRecovery.ts", "hooks/videoPlayback/engineSession.ts"].map((file) =>
      fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8"),
    );
    for (const key of Object.keys(PLAYBACK_ERROR_IDS)) {
      expect(sources.some((source) => source.includes(`PLAYBACK_ERROR_IDS.${key}`))).toBe(true);
    }
  });
});

describe("nativeErrorOf", () => {
  it("reads the domain and code the player hands over, numeric or numeric text", () => {
    expect(nativeErrorOf({ code: -11800, domain: "AVFoundationErrorDomain", localizedDescription: "x" })).toEqual({ domain: "AVFoundationErrorDomain", code: -11800 });
    expect(nativeErrorOf({ code: "-12889", domain: "CoreMediaErrorDomain" })).toEqual({ domain: "CoreMediaErrorDomain", code: -12889 });
  });

  it("has nothing for an error without both", () => {
    expect(nativeErrorOf({ errorString: "playback did not start within 25s" })).toBeUndefined();
    expect(nativeErrorOf({ code: -1, domain: "" })).toBeUndefined();
    expect(nativeErrorOf("boom")).toBeUndefined();
    expect(nativeErrorOf(null)).toBeUndefined();
  });
});

describe("errorIdOf", () => {
  it("takes the ID a failure carries, as a class or a field, else the fallback", () => {
    expect(errorIdOf(new IdentifiedError(PLAYBACK_ERROR_IDS.ENGINE_NOSEG, "m"), PLAYBACK_ERROR_IDS.STREAM)).toBe("PB-ENGINE-NOSEG");
    expect(errorIdOf({ errorString: "x", errorId: PLAYBACK_ERROR_IDS.OPEN_TIMEOUT }, PLAYBACK_ERROR_IDS.AVPLAYER)).toBe("PB-OPEN-TIMEOUT");
    expect(errorIdOf(new Error("m"), PLAYBACK_ERROR_IDS.STREAM)).toBe("PB-STREAM");
  });

  it("keeps the message the error classification reads", () => {
    expect(new IdentifiedError(PLAYBACK_ERROR_IDS.ENGINE_NOSEG, "engine produced no segment within 60s").message).toBe("engine produced no segment within 60s");
  });
});

describe("formatErrorRef", () => {
  it("leads with the ID, then the lane, the native code and the build", () => {
    expect(formatErrorRef({ id: "PB-AVPLAYER", lane: "ENG", native: { domain: "AVFoundationErrorDomain", code: -11800 } }, "2.2.10 (19)")).toBe("PB-AVPLAYER · ENG (AVF -11800) · 2.2.10 (19)");
    expect(formatErrorRef({ id: "PB-AVPLAYER", lane: "DIR", native: { domain: "CoreMediaErrorDomain", code: -12889 } }, "")).toBe("PB-AVPLAYER · DIR (CM -12889)");
  });

  it("drops what the failure does not have, and spells out a domain it has no tag for", () => {
    expect(formatErrorRef({ id: "PB-NOLANE" }, "2.2.10 (19)")).toBe("PB-NOLANE · 2.2.10 (19)");
    expect(formatErrorRef({ id: "PB-ENGINE-NOSEG", lane: "ENG" }, "")).toBe("PB-ENGINE-NOSEG · ENG");
    expect(formatErrorRef({ id: "PB-AUTH", native: { domain: "com.example", code: 7 } }, "")).toBe("PB-AUTH (com.example 7)");
  });
});
