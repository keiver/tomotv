import { connectedLine, stateLabel } from "@/utils/syncPlayCopy";

describe("connectedLine", () => {
  it("names one person", () => {
    expect(connectedLine(["admin"], "Idle")).toBe("admin is connected, playback is idle");
  });

  it("joins two with and", () => {
    expect(connectedLine(["admin", "demo"], "Playing")).toBe("admin and demo are connected, playback is playing");
  });

  it("commas all but the last", () => {
    expect(connectedLine(["admin", "demo", "extrauser"], "Paused")).toBe("admin, demo and extrauser are connected, playback is paused");
  });

  it("says so when the group is empty", () => {
    expect(connectedLine([], "Waiting")).toBe("Nobody is connected yet, playback is waiting");
  });

  it("passes an unknown state through", () => {
    expect(stateLabel("Buffering")).toBe("Buffering");
  });
});
