import { mayGrabChapterFrames, type ChapterFramesInput } from "@/hooks/videoPlayback/chapterFrames";

/** A session that has every reason to grab: the fields under test are overridden per case. */
const asking: ChapterFramesInput = {
  isTV: true,
  untaggedChapters: 8,
  stable: true,
  controlsSeen: true,
  mode: "localRemux",
  ridingRung: false,
  fromDisk: false,
};

describe("mayGrabChapterFrames", () => {
  it("grabs for a settled session whose viewer asked for the chrome", () => {
    expect(mayGrabChapterFrames(asking)).toBe(true);
  });

  it("waits while the stream is still opening", () => {
    // The grabber decodes from the source, which is the link the opening segments need.
    expect(mayGrabChapterFrames({ ...asking, stable: false })).toBe(false);
  });

  it("waits until the viewer asks: AVKit shows the transport bar by itself at +0.3s", () => {
    expect(mayGrabChapterFrames({ ...asking, controlsSeen: false })).toBe(false);
  });

  it("never grabs while the engine rides a rung", () => {
    // The engine measured the link below the source; a frame would come out of the same pipe.
    expect(mayGrabChapterFrames({ ...asking, ridingRung: true })).toBe(false);
  });

  it("grabs from a file on disk as soon as playback settles", () => {
    expect(mayGrabChapterFrames({ ...asking, fromDisk: true, controlsSeen: false, ridingRung: true })).toBe(true);
    expect(mayGrabChapterFrames({ ...asking, fromDisk: true, stable: false })).toBe(false);
  });

  it("leaves the server lane alone", () => {
    expect(mayGrabChapterFrames({ ...asking, mode: "transcode" })).toBe(false);
  });

  it("needs a real chapter strip on a TV", () => {
    expect(mayGrabChapterFrames({ ...asking, untaggedChapters: 1 })).toBe(false);
    expect(mayGrabChapterFrames({ ...asking, untaggedChapters: 0 })).toBe(false);
    expect(mayGrabChapterFrames({ ...asking, isTV: false })).toBe(false);
  });
});
