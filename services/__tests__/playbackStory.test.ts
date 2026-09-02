import type { PlaybackSession, SessionEvent } from "../playbackProbe";
import { describePlayback, type DeviceName } from "../playbackStory";

const at = (event: string, data: Record<string, unknown> = {}): SessionEvent => ({ t: 1000, event, itemId: "i", ...data });

function session(events: SessionEvent[], overrides: Partial<PlaybackSession> = {}): PlaybackSession {
  return { itemId: "i", startedAt: 0, outcome: "playing", events, progress: [{ t: 5000, position: 42 }], ...overrides };
}

const plan = (video: string, audio?: string) => at("enginePlan", { video: { action: video }, ...(audio ? { audio: [{ action: audio }] } : {}) });

describe("describePlayback: outcome", () => {
  it("names the device on every platform", () => {
    for (const device of ["iPhone", "iPad", "Mac", "Apple TV"] as DeviceName[]) {
      expect(describePlayback(session([at("mode", { mode: "direct" })]), device)).toMatch(new RegExp(`^This file played correctly on your ${device}\\.`));
    }
  });

  it("adds the seconds to first frame when the session recorded them", () => {
    const text = describePlayback(session([at("mode", { mode: "direct" }), at("playing", { afterSeconds: 1.8 })]), "iPhone");
    expect(text).toMatch(/^This file played correctly on your iPhone, starting 1\.8 seconds after you pressed play\./);
  });

  it("leaves the clause out when no playing event exists", () => {
    expect(describePlayback(session([at("mode", { mode: "direct" })]), "iPhone")).not.toContain("seconds after");
  });

  it("says played to the end for an ended session", () => {
    expect(describePlayback(session([at("mode", { mode: "direct" }), at("ended")], { outcome: "ended" }), "Mac")).toMatch(/^This file played to the end on your Mac\./);
  });

  it("says never started when nothing moved", () => {
    expect(describePlayback(session([at("mode", { mode: "direct" })], { progress: [] }), "iPhone")).toMatch(/^This file never started on your iPhone\./);
    expect(describePlayback(session([at("mode", { mode: "direct" })], { progress: [{ t: 1, position: 0 }] }), "iPhone")).toMatch(/^This file never started/);
  });

  it("reads a failure with its message, and without one", () => {
    const failed = session([at("mode", { mode: "direct" }), at("error", { message: "AVFoundation -11828" })], { outcome: "error" });
    expect(describePlayback(failed, "Mac")).toMatch(/^This file failed on your Mac: AVFoundation -11828\. It played straight/);
    const bare = session([at("mode", { mode: "direct" }), at("error", {})], { outcome: "error" });
    expect(describePlayback(bare, "Mac")).toMatch(/^This file failed on your Mac\. It played straight/);
  });

  it("keeps the first-frame clause on a failure that started", () => {
    const failed = session([at("mode", { mode: "direct" }), at("playing", { afterSeconds: 3 }), at("error", { message: "stalled" })], { outcome: "error" });
    expect(describePlayback(failed, "iPad")).toMatch(/^This file failed on your iPad, starting 3 seconds after you pressed play: stalled\./);
  });
});

describe("describePlayback: who did the work", () => {
  it("credits direct play to the device and the server with nothing but sending", () => {
    expect(describePlayback(session([at("mode", { mode: "direct" })]), "iPhone")).toContain("It played straight from the file as it came, and your server did no work other than sending the file.");
  });

  it("reads the audio lane as audio straight from the file", () => {
    expect(describePlayback(session([at("mode", { mode: "audio" })]), "iPhone")).toContain("The audio played straight from the file, and your server did no work other than sending the file.");
  });

  it("says the engine reassembled it, per stream", () => {
    const remux = (p: SessionEvent) => describePlayback(session([at("mode", { mode: "localRemux" }), p]), "Apple TV");
    expect(remux(plan("copy", "copy"))).toContain("It was reassembled on the fly on your Apple TV, with the video and audio copied as they are, and your server");
    expect(remux(plan("encode", "encode"))).toContain("with the video and audio re-encoded, and your server");
    expect(remux(plan("copy", "encode"))).toContain("with the video copied as it is and the audio re-encoded, and your server");
    expect(remux(plan("encode", "copy"))).toContain("with the video re-encoded and the audio copied as it is, and your server");
    expect(remux(plan("copy"))).toContain("with the video copied as it is, and your server");
  });

  it("says the engine reassembled it without a plan clause when no plan was recorded", () => {
    expect(describePlayback(session([at("mode", { mode: "localRemux" })]), "iPad")).toContain("It was reassembled on the fly on your iPad, and your server did no work");
  });

  it("gives the server the work on the transcode lane and names why the engine declined", () => {
    const text = describePlayback(session([at("mode", { mode: "transcode" }), at("decline", { reason: "vc1 above the pixel budget" })]), "iPad");
    expect(text).toContain("Your Jellyfin server converted it before sending it, so the server did the heavy work here.");
    expect(text).toContain("The on-device engine declined it: vc1 above the pixel budget.");
    expect(describePlayback(session([at("mode", { mode: "transcode" })]), "iPad")).not.toContain("declined");
  });

  it("says only how it went when no lane was recorded", () => {
    expect(describePlayback(session([]), "iPhone")).toBe("This file played correctly on your iPhone.");
    expect(describePlayback(session([at("mode", { mode: "somethingNew" })]), "iPhone")).toBe("This file played correctly on your iPhone.");
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
      'This file played to the end on your iPad. The on-device engine tried first but hit "Cannot open", so playback fell back to your Jellyfin server, which converted it before sending it and did the heavy work here.',
    );
  });

  it("uses the fallback's reason when the error carried none", () => {
    const events = [at("mode", { mode: "direct" }), at("fallback", { from: "direct", to: "remux-or-transcode", reason: "silent stall" }), at("mode", { mode: "localRemux" }), plan("copy", "copy")];
    const text = describePlayback(session(events), "Apple TV");
    expect(text).toContain(
      'Direct play tried first but hit "silent stall", so playback fell back to the on-device engine, which reassembled it on the fly, with the video and audio copied as they are, so your server did no work other than sending the file.',
    );
    expect(text).not.toContain("It first tried");
  });

  it("still reads when neither a message nor a reason was recorded", () => {
    const events = [at("mode", { mode: "localRemux" }), at("mode", { mode: "direct" })];
    expect(describePlayback(session(events), "iPhone")).toContain(
      "The on-device engine tried first but could not carry it, so playback fell back to playing the file straight as it came, so your server did no work other than sending the file.",
    );
  });

  it("treats a repeated mode as no change", () => {
    const events = [at("mode", { mode: "direct" }), at("mode", { mode: "direct" })];
    expect(describePlayback(session(events), "iPhone")).toContain("It played straight from the file as it came");
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
    expect(text.indexOf("This file")).toBe(0);
    expect(text.indexOf("It played straight")).toBeLessThan(text.indexOf("The engine restarted"));
  });
});
