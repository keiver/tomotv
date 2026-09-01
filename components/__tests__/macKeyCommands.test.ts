import { escapeAction, macKeyAction, type MacKeyState } from "@/components/mac-key-commands";
import { MAC_KEYS } from "@/services/macKeyCommands";

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

const BROWSING: MacKeyState = { hostMode: "idle", hasRouteHandlers: false, canGoBack: false, audioActive: false };
const PLAYING_VIDEO: MacKeyState = { hostMode: "video", hasRouteHandlers: true, canGoBack: true, audioActive: false };
const PLAYING_AUDIO: MacKeyState = { ...BROWSING, audioActive: true };

/**
 * Every other key. The two rules worth pinning: a tab must never be pushed under a
 * presented player, and transport with no queue running has to fall through rather
 * than act on a player AVKit is already driving.
 */
describe("macKeyAction", () => {
  it("hands Escape to the rule that already owns it", () => {
    expect(macKeyAction("escape", PLAYING_VIDEO)).toBe("leavePlayer");
    expect(macKeyAction("escape", { ...BROWSING, canGoBack: true })).toBe("goBack");
  });

  it("opens a tab while browsing", () => {
    expect(macKeyAction("search", BROWSING)).toBe("openSearch");
    expect(macKeyAction("settings", BROWSING)).toBe("openSettings");
  });

  it("never pushes a tab under a live session", () => {
    expect(macKeyAction("search", PLAYING_VIDEO)).toBe("ignore");
    expect(macKeyAction("settings", PLAYING_VIDEO)).toBe("ignore");
    expect(macKeyAction("settings", { ...PLAYING_VIDEO, hostMode: "pip-detached" })).toBe("ignore");
  });

  it("drives the queue only while one is running", () => {
    expect(macKeyAction("playPause", PLAYING_AUDIO)).toBe("togglePlay");
    expect(macKeyAction("playPause", PLAYING_VIDEO)).toBe("togglePlay");
    expect(macKeyAction("previousTrack", PLAYING_AUDIO)).toBe("previousTrack");
    expect(macKeyAction("nextTrack", PLAYING_AUDIO)).toBe("nextTrack");
    expect(macKeyAction("playPause", BROWSING)).toBe("ignore");
    expect(macKeyAction("previousTrack", BROWSING)).toBe("ignore");
    expect(macKeyAction("nextTrack", BROWSING)).toBe("ignore");
  });

  it("seeks whatever is playing, and nothing when nothing is", () => {
    expect(macKeyAction("seekBackward", PLAYING_AUDIO)).toBe("seekBackward");
    expect(macKeyAction("seekForward", PLAYING_VIDEO)).toBe("seekForward");
    expect(macKeyAction("seekBackward", BROWSING)).toBe("ignore");
    expect(macKeyAction("seekForward", BROWSING)).toBe("ignore");
  });

  it("leaves the photo keys to the viewer that armed them", () => {
    expect(macKeyAction("previousPhoto", BROWSING)).toBe("ignore");
    expect(macKeyAction("nextPhoto", PLAYING_AUDIO)).toBe("ignore");
  });

  it("answers every key the native side can send", () => {
    for (const key of MAC_KEYS) {
      expect(macKeyAction(key, PLAYING_AUDIO)).toBeDefined();
    }
  });
});
