import type { PlaybackSession, SessionEvent } from "../playbackProbe";
import { describePlayback, type DeviceName } from "../playbackStory";

const at = (event: string, data: Record<string, unknown> = {}): SessionEvent => ({ t: 1000, event, itemId: "i", ...data });

function session(events: SessionEvent[], overrides: Partial<PlaybackSession> = {}): PlaybackSession {
  return { itemId: "i", app: "Tomo TV 9.9.9 (1)", os: "iOS 26.5", startedAt: 0, outcome: "playing", events, progress: [{ t: 5000, position: 42 }], ...overrides };
}

const plan = (video: string, audio?: string) => at("enginePlan", { video: { action: video }, ...(audio ? { audio: [{ action: audio }] } : {}) });

describe("describePlayback: outcome", () => {
  it("names the device on every platform", () => {
    for (const device of ["iPhone", "iPad", "Mac", "Apple TV"] as DeviceName[]) {
      expect(describePlayback(session([at("mode", { mode: "direct" })]), device)).toMatch(new RegExp(`^The last file played with no errors on this ${device}\\.`));
    }
  });

  it("adds the seconds to first motion when the session recorded them", () => {
    const text = describePlayback(session([at("mode", { mode: "direct" }), at("playing", { afterSeconds: 1.8 })]), "iPhone");
    expect(text).toMatch(/^The last file played with no errors on this iPhone, started 1\.8 seconds after the player opened\./);
  });

  it("leaves the clause out when no playing event exists", () => {
    expect(describePlayback(session([at("mode", { mode: "direct" })]), "iPhone")).not.toContain("seconds after");
  });

  it("says played to the end for an ended session", () => {
    expect(describePlayback(session([at("mode", { mode: "direct" }), at("ended")], { outcome: "ended" }), "Mac")).toMatch(/^The last file played to the end on this Mac\./);
  });

  it("says never started when nothing moved", () => {
    expect(describePlayback(session([at("mode", { mode: "direct" })], { progress: [] }), "iPhone")).toMatch(/^The last file never started on this iPhone\./);
    expect(describePlayback(session([at("mode", { mode: "direct" })], { progress: [{ t: 1, position: 0 }] }), "iPhone")).toMatch(/^The last file never started/);
  });

  it("reads a failure with its message, and without one", () => {
    const failed = session([at("mode", { mode: "direct" }), at("error", { message: "AVFoundation -11828" })], { outcome: "error" });
    expect(describePlayback(failed, "Mac")).toMatch(/^The last file failed on this Mac: AVFoundation -11828\. Played straight/);
    const bare = session([at("mode", { mode: "direct" }), at("error", {})], { outcome: "error" });
    expect(describePlayback(bare, "Mac")).toMatch(/^The last file failed on this Mac\. Played straight/);
  });

  it("keeps the first-motion clause on a failure that started", () => {
    const failed = session([at("mode", { mode: "direct" }), at("playing", { afterSeconds: 3 }), at("error", { message: "stalled" })], { outcome: "error" });
    expect(describePlayback(failed, "iPad")).toMatch(/^The last file failed on this iPad, started 3 seconds after the player opened: stalled\./);
  });

  it("names the device as another's when the session was sent over", () => {
    expect(describePlayback(session([at("mode", { mode: "direct" })]), "Apple TV", false)).toMatch(/^The last file played with no errors on the Apple TV\./);
    expect(describePlayback(session([at("mode", { mode: "direct" })]), "Apple TV", true)).toMatch(/^The last file played with no errors on this Apple TV\./);
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
      expect(describePlayback(session(events, { outcome: "error" }), device)).not.toMatch(/\b(you|your)\b/i);
    }
  });
});

describe("describePlayback: who did the work", () => {
  it("credits direct play to the device and the server with nothing but sending", () => {
    expect(describePlayback(session([at("mode", { mode: "direct" })]), "iPhone")).toContain("Played straight from the file, and the server only sent the file.");
  });

  it("reads the audio lane as audio straight from the file", () => {
    expect(describePlayback(session([at("mode", { mode: "audio" })]), "iPhone")).toContain("The audio played straight from the file, and the server only sent the file.");
  });

  it("says the engine remuxed it, per stream", () => {
    const remux = (p: SessionEvent) => describePlayback(session([at("mode", { mode: "localRemux" }), p]), "Apple TV");
    expect(remux(plan("copy", "copy"))).toContain("Remuxed on the device, with the video and audio copied as they are, and the server only sent the file.");
    expect(remux(plan("encode", "encode"))).toContain("with the video and audio re-encoded, and the server");
    expect(remux(plan("copy", "encode"))).toContain("with the video copied as it is and the audio re-encoded, and the server");
    expect(remux(plan("encode", "copy"))).toContain("with the video re-encoded and the audio copied as it is, and the server");
    expect(remux(plan("copy"))).toContain("with the video copied as it is, and the server");
  });

  it("says what the session did with the server's smaller feed", () => {
    const withTier = (state?: string) =>
      describePlayback(session([at("mode", { mode: "localRemux" }), plan("copy", "copy"), at("variant", { tierFirst: true }), ...(state ? [at("tier", { state })] : [])]), "iPhone");
    expect(withTier("listed")).toContain("copied as they are, and the server fed a smaller version first until the player switched to it.");
    expect(withTier("dropped")).toContain("copied as they are, and the server fed a smaller version first, then its feed failed and was dropped.");
    // The JS intent alone proves nothing: the engine may have declined the tier at the playlist.
    expect(withTier("declined")).toContain("copied as they are, and the server only sent the file.");
    expect(withTier()).toContain("copied as they are, and the server only sent the file.");
  });

  it("says the engine remuxed it without a plan clause when no plan was recorded", () => {
    expect(describePlayback(session([at("mode", { mode: "localRemux" })]), "iPad")).toContain("Remuxed on the device, and the server only sent the file.");
  });

  it("gives the server the work on the transcode lane and names why the engine declined", () => {
    const text = describePlayback(session([at("mode", { mode: "transcode" }), at("decline", { reason: "vc1 above the pixel budget" })]), "iPad");
    expect(text).toContain("Converted by the Jellyfin server before sending, so the server did the work.");
    expect(text).toContain("The on-device engine declined it: vc1 above the pixel budget.");
    expect(describePlayback(session([at("mode", { mode: "transcode" })]), "iPad")).not.toContain("declined");
  });

  it("says only how it went when no lane was recorded", () => {
    expect(describePlayback(session([]), "iPhone")).toBe("The last file played with no errors on this iPhone.");
    expect(describePlayback(session([at("mode", { mode: "somethingNew" })]), "iPhone")).toBe("The last file played with no errors on this iPhone.");
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
    expect(describePlayback(session(events, { outcome: "ended" }), "iPad")).toBe(
      'The last file played to the end on this iPad. The on-device engine tried first but hit "Cannot open", so playback fell back to the Jellyfin server, which converted it before sending.',
    );
  });

  it("uses the fallback's reason when the error carried none", () => {
    const events = [at("mode", { mode: "direct" }), at("fallback", { from: "direct", to: "remux-or-transcode", reason: "silent stall" }), at("mode", { mode: "localRemux" }), plan("copy", "copy")];
    const text = describePlayback(session(events), "Apple TV");
    expect(text).toContain(
      'Direct play tried first but hit "silent stall", so playback fell back to the on-device engine, which remuxed it, with the video and audio copied as they are, so the server only sent the file.',
    );
    expect(text).not.toContain("It first tried");
  });

  it("still reads when neither a message nor a reason was recorded", () => {
    const events = [at("mode", { mode: "localRemux" }), at("mode", { mode: "direct" })];
    expect(describePlayback(session(events), "iPhone")).toContain("The on-device engine tried first but could not carry it, so playback fell back to direct play, so the server only sent the file.");
  });

  it("treats a repeated mode as no change", () => {
    const events = [at("mode", { mode: "direct" }), at("mode", { mode: "direct" })];
    expect(describePlayback(session(events), "iPhone")).toContain("Played straight from the file");
  });

  it("does not repeat a terminal error as the retry reason", () => {
    const events = [at("mode", { mode: "localRemux" }), at("mode", { mode: "transcode" }), at("error", { message: "gave up", willRetry: false })];
    expect(describePlayback(session(events, { outcome: "error" }), "iPhone")).toContain("but could not carry it");
  });
});

describe("describePlayback: detours", () => {
  it("tells a fallback that stayed in lane, the restarts and the last quality switch", () => {
    const events = [
      at("mode", { mode: "direct" }),
      at("fallback", { from: "direct", to: "remux-or-transcode", reason: "silent stall" }),
      at("engineRestart", { position: 12 }),
      at("qualitySwitch", { to: "1080p" }),
    ];
    const text = describePlayback(session(events), "Apple TV");
    expect(text).toContain("It first tried direct play and fell back to the on-device engine or the server (silent stall).");
    expect(text).toContain("The engine restarted once along the way.");
    expect(text).toContain("Quality moved to 1080p.");
  });

  it("counts restarts and switches", () => {
    const events = [at("mode", { mode: "transcode" }), at("engineRestart"), at("engineRestart"), at("qualitySwitch", { to: "720p" }), at("qualitySwitch", { to: "480p" })];
    const text = describePlayback(session(events), "iPhone");
    expect(text).toContain("The engine restarted 2 times along the way.");
    expect(text).toContain("Quality moved to 480p after 2 switches.");
  });

  it("reads a fallback with no reason and unknown lane names as they are", () => {
    const events = [at("mode", { mode: "direct" }), at("fallback", { from: "direct", to: "mystery" })];
    expect(describePlayback(session(events), "iPhone")).toContain("It first tried direct play and fell back to mystery.");
  });

  it("orders the sentences outcome, work, then detours", () => {
    const events = [at("mode", { mode: "direct" }), at("engineRestart")];
    const text = describePlayback(session(events), "iPhone");
    expect(text.indexOf("The last file played with no errors")).toBe(0);
    expect(text.indexOf("Played straight")).toBeLessThan(text.indexOf("The engine restarted"));
  });
});
