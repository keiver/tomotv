import { escapeAction } from "@/components/mac-key-commands";

/**
 * What one Escape press means on the Mac build.
 *
 * The consequential half is the first two: Escape while a session is live has to
 * end that session, and must never reach the navigator and pop the route sitting
 * behind the player.
 */
describe("escapeAction", () => {
  it("leaves the player whenever a session owns the screen", () => {
    expect(escapeAction("video", true, true)).toBe("leavePlayer");
    expect(escapeAction("loading", true, true)).toBe("leavePlayer");
    expect(escapeAction("error", true, true)).toBe("leavePlayer");
    expect(escapeAction("pip-active", true, true)).toBe("leavePlayer");
  });

  it("ends the session itself when no route is listening", () => {
    expect(escapeAction("pip-detached", false, true)).toBe("endSession");
  });

  it("never reaches the navigator while a session is live, even with somewhere to go back to", () => {
    expect(escapeAction("video", true, true)).not.toBe("goBack");
  });

  it("goes back when nothing is playing and there is somewhere to go", () => {
    expect(escapeAction("idle", false, true)).toBe("goBack");
  });

  it("does nothing at the root of a tab", () => {
    expect(escapeAction("idle", false, false)).toBe("ignore");
  });
});
