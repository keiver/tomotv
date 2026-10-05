/** The Server transcoding copy: a title and hint per level, and the server's own setting stated in the footer and on the row. */
import { serverTranscodingFooter, transcodingLevelHint, transcodingLevelTitle, transcodingRowSubtitle } from "../transcodingCopy";

const allowed = { server: "http://a:8096", video: true, audio: true };

describe("transcodingCopy", () => {
  it("names each level by its outcome", () => {
    expect(transcodingLevelTitle("linkOrFile")).toBe("When needed");
    expect(transcodingLevelHint("linkOrFile")).toBe("For unsupported files, and smaller streams on slow connections");
    expect(transcodingLevelTitle("fileOnly")).toBe("Only for unsupported files");
    expect(transcodingLevelHint("fileOnly")).toBe("Slow connections get the original file, which may buffer");
    expect(transcodingLevelTitle("never")).toBe("Off");
    expect(transcodingLevelHint("never")).toBe("Only files this device supports will play");
  });

  it("states the server's setting once read, and says nothing before", () => {
    expect(serverTranscodingFooter(null)).toBeNull();
    expect(serverTranscodingFooter(allowed)).toEqual({ before: "Your server has video and audio transcoding ", state: "enabled", enabled: true, after: "." });
    expect(transcodingRowSubtitle("fileOnly", null)).toBe("Only for unsupported files");
    expect(transcodingRowSubtitle("never", allowed)).toBe("Off");
  });

  it("states both off as one, and leads the row with a video refusal", () => {
    const denied = { ...allowed, video: false, audio: false };
    expect(serverTranscodingFooter(denied)).toEqual({ before: "Your server has video and audio transcoding ", state: "disabled", enabled: false, after: "." });
    expect(transcodingRowSubtitle("linkOrFile", denied)).toBe("Turned off by your server");
  });

  it("names only the kind the server turned off when the two differ", () => {
    expect(serverTranscodingFooter({ ...allowed, video: false })).toEqual({ before: "Your server has video transcoding ", state: "disabled", enabled: false, after: "." });
    expect(serverTranscodingFooter({ ...allowed, audio: false })).toEqual({ before: "Your server has audio transcoding ", state: "disabled", enabled: false, after: "." });
    expect(transcodingRowSubtitle("linkOrFile", { ...allowed, audio: false })).toBe("When needed");
  });
});
