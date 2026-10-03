/** The Server transcoding copy: a title and hint per level, and the server's refusal leading every line it touches. */
import { serverTranscodingNotice, transcodingLevelHint, transcodingLevelTitle, transcodingRowSubtitle } from "../transcodingCopy";

const allowed = { server: "http://a:8096", video: true, audio: true };

describe("transcodingCopy", () => {
  it("names each level by what the server may still be asked for", () => {
    expect(transcodingLevelTitle("linkOrFile")).toBe("When the connection or the file needs it");
    expect(transcodingLevelHint("linkOrFile")).toBe("Smaller server feeds on a slow connection, and files this device can't play");
    expect(transcodingLevelTitle("fileOnly")).toBe("Only for files this device can't play");
    expect(transcodingLevelHint("fileOnly")).toBe("Never for the connection: a file plays as it is, or buffers");
    expect(transcodingLevelTitle("never")).toBe("Never");
    expect(transcodingLevelHint("never")).toBe("Files this device can't play won't play");
  });

  it("says nothing about the server while it allows transcoding or has not been read", () => {
    expect(serverTranscodingNotice(null)).toBeNull();
    expect(serverTranscodingNotice(allowed)).toBeNull();
    expect(transcodingRowSubtitle("fileOnly", null)).toBe("Only for files this device can't play");
    expect(transcodingRowSubtitle("never", allowed)).toBe("Never");
  });

  it("leads with the server's refusal of video, whatever the device chose", () => {
    const denied = { ...allowed, video: false };
    expect(serverTranscodingNotice(denied)).toMatch(/does not allow video transcoding/);
    expect(transcodingRowSubtitle("linkOrFile", denied)).toBe("Not allowed by your server");
  });

  it("notes a refusal of audio alone on the page, not on the row", () => {
    const denied = { ...allowed, audio: false };
    expect(serverTranscodingNotice(denied)).toMatch(/does not allow audio transcoding/);
    expect(transcodingRowSubtitle("linkOrFile", denied)).toBe("When the connection or the file needs it");
  });
});
