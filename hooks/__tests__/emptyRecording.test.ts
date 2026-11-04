/** A recording's file read for video: only a TS source the server found no streams in is read, and 0x47 first is video. */
import { mayHoldNoVideo, startsWithVideo } from "@/hooks/videoPlayback/emptyRecording";

describe("mayHoldNoVideo", () => {
  it("is a TS source with no streams", () => {
    expect(mayHoldNoVideo({ MediaSources: [{ Container: "ts", MediaStreams: [] }] })).toBe(true);
    expect(mayHoldNoVideo({ MediaSources: [{ Container: "TS" }] })).toBe(true);
  });

  it("is never a source with streams, another container, or no source", () => {
    expect(mayHoldNoVideo({ MediaSources: [{ Container: "ts", MediaStreams: [{}] }] })).toBe(false);
    expect(mayHoldNoVideo({ MediaSources: [{ Container: "mkv", MediaStreams: [] }] })).toBe(false);
    expect(mayHoldNoVideo({ MediaSources: [] })).toBe(false);
    expect(mayHoldNoVideo({})).toBe(false);
  });
});

describe("startsWithVideo", () => {
  it("is a file whose first byte is the TS sync byte", () => {
    expect(startsWithVideo(new Uint8Array([0x47, 0x40]))).toBe(true);
    expect(startsWithVideo(new TextEncoder().encode('{"error": "Stream limit exceeded"}'))).toBe(false);
    expect(startsWithVideo(new Uint8Array(0))).toBe(false);
  });
});
