import type { Playback, PlaybackSession, SessionEvent } from "../diagnosticsSchema";
import { describePlayback } from "../playbackStory";
import type { DeviceName } from "@/utils/hostEnvironment";

const at = (event: string, data: Record<string, unknown> = {}): SessionEvent => ({ t: 1000, event, itemId: "i", ...data });

const HEAD = {
  schemaVersion: 2 as const,
  app: { name: "Tomo TV", version: "9.9.9", build: "1" },
  os: { name: "iOS" as const, version: "26.5" },
  device: { family: "iPhone" as DeviceName, model: null, marketingName: null, cores: null, memoryBytes: null, decode: null },
};

function session(events: SessionEvent[], overrides: Partial<Playback> = {}): PlaybackSession {
  return { ...HEAD, playback: { itemId: "i", startedAt: 0, outcome: "playing", events, progress: [{ t: 5000, position: 42 }], ...overrides } };
}

/** The same playback as recorded on another machine. */
const on = (recorded: PlaybackSession, family: DeviceName): PlaybackSession => ({ ...recorded, device: { ...recorded.device, family } });

const plan = (video: string, audio?: string) => at("enginePlan", { video: { action: video }, ...(audio ? { audio: [{ action: audio }] } : {}) });

const DIRECT = "The server sent the file as it is, and the player opened it without any conversion.";

describe("describePlayback: outcome", () => {
  it("names the device on every platform", () => {
    for (const device of ["iPhone", "iPad", "Mac", "Apple TV"] as DeviceName[]) {
      expect(describePlayback(on(session([at("mode", { mode: "direct" })]), device))).toMatch(new RegExp(`^The last file played with no errors on this ${device}\\.`));
    }
  });

  it("puts the seconds to first motion before the verdict when the session recorded them", () => {
    const text = describePlayback(on(session([at("mode", { mode: "direct" }), at("playing", { afterSeconds: 1.8 })]), "iPhone"));
    expect(text).toMatch(/^The last file started 1\.8 seconds after the player opened and played with no errors on this iPhone\./);
  });

  it("names the file when the source recorded a name, and says the last file otherwise", () => {
    const named = session([at("mode", { mode: "direct" }), at("source", { name: "Elephants Dream" }), at("playing", { afterSeconds: 12.3 })]);
    expect(describePlayback(on(named, "iPhone"))).toMatch(/^The file Elephants Dream started 12\.3 seconds after the player opened and played with no errors on this iPhone\./);
    expect(describePlayback(on(session([at("mode", { mode: "direct" }), at("source", { name: null })]), "iPhone"))).toMatch(/^The last file played/);
    const failed = session([at("mode", { mode: "direct" }), at("source", { name: "Lila's Sunrise" }), at("error", { message: "stalled" })], { outcome: "error" });
    expect(describePlayback(on(failed, "iPad"))).toMatch(/^The file Lila's Sunrise failed on this iPad: stalled\./);
  });

  it("leaves the clause out when no playing event exists", () => {
    expect(describePlayback(on(session([at("mode", { mode: "direct" })]), "iPhone"))).not.toContain("seconds after");
  });

  it("says played to the end for an ended session", () => {
    expect(describePlayback(on(session([at("mode", { mode: "direct" }), at("ended")], { outcome: "ended" }), "Mac"))).toMatch(/^The last file played to the end on this Mac\./);
    const timed = session([at("mode", { mode: "direct" }), at("playing", { afterSeconds: 2 }), at("ended")], { outcome: "ended" });
    expect(describePlayback(on(timed, "Mac"))).toMatch(/^The last file started 2 seconds after the player opened and played to the end on this Mac\./);
  });

  it("says never started when nothing moved", () => {
    expect(describePlayback(on(session([at("mode", { mode: "direct" })], { progress: [] }), "iPhone"))).toMatch(/^The last file never started on this iPhone\./);
    expect(describePlayback(on(session([at("mode", { mode: "direct" })], { progress: [{ t: 1, position: 0 }] }), "iPhone"))).toMatch(/^The last file never started/);
  });

  it("counts the first-motion event as started when the samples stopped at zero", () => {
    const short = session([at("mode", { mode: "direct" }), at("playing", { afterSeconds: 1.8 })], { progress: [{ t: 1, position: 0 }] });
    expect(describePlayback(on(short, "iPhone"))).toMatch(/^The last file started 1\.8 seconds after the player opened and played with no errors on this iPhone\./);
  });

  it("reads a failure with its message, and without one", () => {
    const failed = session([at("mode", { mode: "direct" }), at("error", { message: "AVFoundation -11828" })], { outcome: "error" });
    expect(describePlayback(on(failed, "Mac"))).toMatch(/^The last file failed on this Mac: AVFoundation -11828\. The server sent/);
    const bare = session([at("mode", { mode: "direct" }), at("error", {})], { outcome: "error" });
    expect(describePlayback(on(bare, "Mac"))).toMatch(/^The last file failed on this Mac\. The server sent/);
  });

  it("says a failure that started did start, then failed", () => {
    const failed = session([at("mode", { mode: "direct" }), at("playing", { afterSeconds: 3 }), at("error", { message: "stalled." })], { outcome: "error" });
    expect(describePlayback(on(failed, "iPad"))).toMatch(/^The last file started 3 seconds after the player opened, then failed on this iPad: stalled\./);
  });

  it("names the device as another's when the session was sent over", () => {
    expect(describePlayback(on(session([at("mode", { mode: "direct" })]), "Apple TV"), false)).toMatch(/^The last file played with no errors on the Apple TV\./);
    expect(describePlayback(on(session([at("mode", { mode: "direct" })]), "Apple TV"), true)).toMatch(/^The last file played with no errors on this Apple TV\./);
  });

  it("never addresses the reader", () => {
    const events = [
      at("mode", { mode: "localRemux" }),
      plan("copy", "copy"),
      at("playing", { afterSeconds: 2 }),
      at("error", { message: "stalled", willRetry: true }),
      at("mode", { mode: "transcode" }),
      at("decline", { reason: "vc1" }),
    ];
    for (const device of ["iPhone", "iPad", "Mac", "Apple TV"] as DeviceName[]) {
      expect(describePlayback(on(session(events, { outcome: "error" }), device))).not.toMatch(/\b(you|your)\b/i);
    }
  });
});

describe("describePlayback: a downloaded file", () => {
  it("names no server when the mode event says the file is held on disk", () => {
    expect(describePlayback(on(session([at("mode", { mode: "direct", held: true })]), "iPhone"))).toContain("The file was played from this device's downloads. No server was involved.");
    expect(describePlayback(on(session([at("mode", { mode: "audio", held: true })]), "iPhone"))).toContain("The track was played from this device's downloads. No server was involved.");
    expect(describePlayback(on(session([at("mode", { mode: "localRemux", held: true }), plan("copy", "copy")]), "iPhone"))).toContain(
      "The file was played from this device's downloads, repackaged by the on-device engine, with the video and audio copied as they are. No server was involved.",
    );
  });

  it("reads a file URL off the stream event when the mode event predates the flag", () => {
    const events = [at("mode", { mode: "direct" }), at("stream", { mode: "direct", url: "file:///var/mobile/Containers/Data/Application/X/Documents/downloads/abc/media.mov" })];
    expect(describePlayback(on(session(events), "iPhone"))).toContain("The file was played from this device's downloads. No server was involved.");
  });

  it("keeps the server out of a held file's engine replay", () => {
    const events = [at("mode", { mode: "localRemux", held: true }), at("fallback", { from: "localRemux", to: "direct", reason: "session never opened" })];
    expect(describePlayback(on(session(events), "iPhone"))).toContain(
      'The on-device engine was tried first but failed with "session never opened", so playback moved to direct play. The file was played from this device\'s downloads. No server was involved.',
    );
  });

  it("never credits a server for a held file", () => {
    for (const mode of ["direct", "audio", "localRemux"]) {
      expect(describePlayback(on(session([at("mode", { mode, held: true })]), "iPhone"))).not.toMatch(/server (sent|converted)/);
    }
  });
});

describe("describePlayback: who did the work", () => {
  it("credits direct play to the player and the server with nothing but sending", () => {
    expect(describePlayback(on(session([at("mode", { mode: "direct" })]), "iPhone"))).toContain(DIRECT);
  });

  it("reads the audio lane as the track sent as it is", () => {
    expect(describePlayback(on(session([at("mode", { mode: "audio" })]), "iPhone"))).toContain("The server sent the track as it is, and the player opened it without any conversion.");
  });

  it("says the engine repackaged it, per stream", () => {
    const remux = (p: SessionEvent) => describePlayback(on(session([at("mode", { mode: "localRemux" }), p]), "Apple TV"));
    expect(remux(plan("copy", "copy"))).toContain("The server sent the file as it is, and the on-device engine repackaged it for the player, with the video and audio copied as they are.");
    expect(remux(plan("encode", "encode"))).toContain("repackaged it for the player, with the video and audio re-encoded.");
    expect(remux(plan("copy", "encode"))).toContain("with the video copied as it is and the audio re-encoded.");
    expect(remux(plan("encode", "copy"))).toContain("with the video re-encoded and the audio copied as it is.");
    expect(remux(plan("copy"))).toContain("with the video copied as it is.");
  });

  it("says what the session did with the server's smaller feed", () => {
    const withTier = (state?: string) =>
      describePlayback(on(session([at("mode", { mode: "localRemux" }), plan("copy", "copy"), at("variant", { tierFirst: true }), ...(state ? [at("tier", { state })] : [])]), "iPhone"));
    expect(withTier("listed")).toContain("The server sent a smaller version to open with, and the on-device engine had the full file ready beside it, with the video and audio copied as they are.");
    expect(withTier("dropped")).toContain(
      "The server sent a smaller version to open with, then that feed failed and was dropped, and the on-device engine had the full file ready beside it, with the video and audio copied as they are.",
    );
    // The JS intent alone proves nothing: the engine may have declined the tier at the playlist.
    expect(withTier("declined")).toContain("The server sent the file as it is, and the on-device engine repackaged it for the player, with the video and audio copied as they are.");
    expect(withTier()).toContain("The server sent the file as it is, and the on-device engine repackaged it for the player, with the video and audio copied as they are.");
    const afterFallback = describePlayback(
      on(session([at("mode", { mode: "direct" }), at("mode", { mode: "localRemux" }), plan("copy", "copy"), at("variant", { tierFirst: true }), at("tier", { state: "listed" })]), "iPhone"),
    );
    expect(afterFallback).toContain(
      "so playback moved to the on-device engine. The server sent a smaller version to open with, and the on-device engine had the full file ready beside it, with the video and audio copied as they are.",
    );
  });

  it("says the engine repackaged it without a plan clause when no plan was recorded", () => {
    expect(describePlayback(on(session([at("mode", { mode: "localRemux" })]), "iPad"))).toContain("The server sent the file as it is, and the on-device engine repackaged it for the player.");
  });

  it("gives the server the work on the transcode lane and names why the engine declined", () => {
    const text = describePlayback(on(session([at("mode", { mode: "transcode" }), at("decline", { reason: "vc1 above the pixel budget" })]), "iPad"));
    expect(text).toContain("The Jellyfin server converted the file before sending it. The on-device engine declined the file: vc1 above the pixel budget.");
    expect(describePlayback(on(session([at("mode", { mode: "transcode" })]), "iPad"))).not.toContain("declined");
  });

  it("says only how it went when no lane was recorded", () => {
    expect(describePlayback(on(session([]), "iPhone"))).toBe("The last file played with no errors on this iPhone.");
    expect(describePlayback(on(session([at("mode", { mode: "somethingNew" })]), "iPhone"))).toBe("The last file played with no errors on this iPhone.");
  });
});

describe("describePlayback: lane changes", () => {
  it("tells the attempt, the retried error, and where it landed", () => {
    const events = [
      at("mode", { mode: "localRemux" }),
      plan("copy", "copy"),
      at("error", { mode: "localRemux", message: "Cannot open", willRetry: true }),
      at("mode", { mode: "transcode" }),
      at("ended"),
    ];
    expect(describePlayback(on(session(events, { outcome: "ended" }), "iPad"))).toBe(
      'The last file played to the end on this iPad. The on-device engine was tried first but failed with "Cannot open", so playback moved to server transcoding. The Jellyfin server converted the file before sending it.',
    );
  });

  it("uses the fallback's reason when the error carried none", () => {
    const events = [at("mode", { mode: "direct" }), at("fallback", { from: "direct", to: "remux-or-transcode", reason: "silent stall" }), at("mode", { mode: "localRemux" }), plan("copy", "copy")];
    const text = describePlayback(on(session(events), "Apple TV"));
    expect(text).toContain(
      'Direct play was tried first but failed with "silent stall", so playback moved to the on-device engine. The server sent the file as it is, and the on-device engine repackaged it for the player, with the video and audio copied as they are.',
    );
    expect(text).not.toContain("was sent to");
  });

  it("reads an in-place fallback as the lane the playback ended on", () => {
    const events = [at("mode", { mode: "localRemux" }), plan("copy", "copy"), at("fallback", { from: "localRemux", to: "transcode", reason: "engine fell below realtime" })];
    expect(describePlayback(on(session(events), "iPhone"))).toContain(
      'The on-device engine was tried first but failed with "engine fell below realtime", so playback moved to server transcoding. The Jellyfin server converted the file before sending it.',
    );
  });

  it("still reads when neither a message nor a reason was recorded", () => {
    const events = [at("mode", { mode: "localRemux" }), at("mode", { mode: "direct" })];
    expect(describePlayback(on(session(events), "iPhone"))).toContain(`The on-device engine was tried first but failed, so playback moved to direct play. ${DIRECT}`);
  });

  it("treats a repeated mode as no change", () => {
    const events = [at("mode", { mode: "direct" }), at("mode", { mode: "direct" })];
    expect(describePlayback(on(session(events), "iPhone"))).toBe(`The last file played with no errors on this iPhone. ${DIRECT}`);
  });

  it("does not repeat a terminal error as the retry reason", () => {
    const events = [at("mode", { mode: "localRemux" }), at("mode", { mode: "transcode" }), at("error", { message: "gave up", willRetry: false })];
    expect(describePlayback(on(session(events, { outcome: "error" }), "iPhone"))).toContain("but failed, so playback moved");
  });
});

describe("describePlayback: detours", () => {
  it("tells a fallback that never reached a lane, the restarts and the last quality switch", () => {
    const events = [
      at("mode", { mode: "direct" }),
      at("fallback", { from: "direct", to: "remux-or-transcode", reason: "silent stall" }),
      at("engineRestart", { position: 12 }),
      at("qualitySwitch", { to: "1080p" }),
    ];
    const text = describePlayback(on(session(events), "Apple TV"));
    expect(text).toContain('Direct play failed with "silent stall", and playback was sent to the on-device engine or the server.');
    expect(text).toContain("The engine restarted once.");
    expect(text).toContain("Quality switched to 1080p.");
  });

  it("counts restarts and switches", () => {
    const events = [at("mode", { mode: "transcode" }), at("engineRestart"), at("engineRestart"), at("qualitySwitch", { to: "720p" }), at("qualitySwitch", { to: "480p" })];
    const text = describePlayback(on(session(events), "iPhone"));
    expect(text).toContain("The engine restarted 2 times.");
    expect(text).toContain("Quality switched 2 times, ending at 480p.");
  });

  it("reads a fallback with no reason and unknown lane names as they are", () => {
    const events = [at("mode", { mode: "direct" }), at("fallback", { from: "direct", to: "mystery" })];
    expect(describePlayback(on(session(events), "iPhone"))).toContain("Direct play failed, and playback was sent to mystery.");
  });

  it("orders the sentences outcome, work, then detours", () => {
    const events = [at("mode", { mode: "direct" }), at("engineRestart")];
    const text = describePlayback(on(session(events), "iPhone"));
    expect(text.indexOf("The last file played with no errors")).toBe(0);
    expect(text.indexOf("The server sent")).toBeLessThan(text.indexOf("The engine restarted"));
  });
});
