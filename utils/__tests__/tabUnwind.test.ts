import { shouldUnwindToTabs } from "../tabUnwind";

const stack = (...names: string[]) => names.map((name) => ({ name }));

describe("shouldUnwindToTabs", () => {
  it("unwinds a folder pushed over the tabs", () => {
    expect(shouldUnwindToTabs(stack("(tabs)", "[folderId]"))).toBe(true);
  });

  it("unwinds nested folders and the screens pushed above them", () => {
    expect(shouldUnwindToTabs(stack("(tabs)", "[folderId]", "[folderId]", "filters"))).toBe(true);
  });

  it("leaves the tabs alone when nothing covers them", () => {
    expect(shouldUnwindToTabs(stack("(tabs)"))).toBe(false);
  });

  it("never closes the video or audio player", () => {
    expect(shouldUnwindToTabs(stack("(tabs)", "player"))).toBe(false);
    expect(shouldUnwindToTabs(stack("(tabs)", "audio-player"))).toBe(false);
    expect(shouldUnwindToTabs(stack("(tabs)", "player", "video-info"))).toBe(false);
  });

  it("does nothing when the tabs are not on the stack", () => {
    expect(shouldUnwindToTabs(stack("connect"))).toBe(false);
  });
});
