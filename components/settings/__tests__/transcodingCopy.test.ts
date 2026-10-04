/** The Server transcoding copy: a title and hint per level, and the server's own setting stated on the page and the row. */
import { serverTranscodingStatus, transcodingLevelHint, transcodingLevelTitle, transcodingRowSubtitle } from "../transcodingCopy";

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
    expect(serverTranscodingStatus(null)).toBeNull();
    expect(serverTranscodingStatus(allowed)).toEqual({ state: "on", title: "Transcoding on", subtitle: "Set by your server for this account" });
    expect(transcodingRowSubtitle("fileOnly", null)).toBe("Only for unsupported files");
    expect(transcodingRowSubtitle("never", allowed)).toBe("Off");
  });

  it("leads with the server's refusal of video, whatever the device chose", () => {
    const denied = { ...allowed, video: false };
    expect(serverTranscodingStatus(denied)).toEqual({ state: "off", title: "Transcoding off", subtitle: "Set by your server for this account. Only files this device supports will play" });
    expect(serverTranscodingStatus({ ...denied, audio: false })?.state).toBe("off");
    expect(transcodingRowSubtitle("linkOrFile", denied)).toBe("Turned off by your server");
  });

  it("states a refusal of audio alone on the page, not on the row", () => {
    const denied = { ...allowed, audio: false };
    expect(serverTranscodingStatus(denied)).toMatchObject({ state: "audioOff", title: "Audio transcoding off" });
    expect(transcodingRowSubtitle("linkOrFile", denied)).toBe("When needed");
  });
});
