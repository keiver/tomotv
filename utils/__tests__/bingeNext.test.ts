import { bingeNextId } from "../bingeNext";

const ep = (Id: string, Played = false, PlaybackPositionTicks = 0) => ({ Id, Type: "Episode", UserData: { Played, PlaybackPositionTicks } });

describe("bingeNextId", () => {
  it("is the episode after the last watched one", () => {
    expect(bingeNextId([ep("1", true), ep("2", true), ep("3"), ep("4")])).toBe("3");
  });

  it("anchors on the last watched episode past a skipped one", () => {
    expect(bingeNextId([ep("1", true), ep("2"), ep("3", true), ep("4")])).toBe("4");
  });

  it("counts an episode in progress as next", () => {
    expect(bingeNextId([ep("1", true), ep("2", false, 500), ep("3")])).toBe("2");
  });

  it("is nothing before the first episode is watched", () => {
    expect(bingeNextId([ep("1"), ep("2", false, 500)])).toBeNull();
  });

  it("is nothing once the season is watched", () => {
    expect(bingeNextId([ep("1", true), ep("2", true)])).toBeNull();
  });

  it("ignores items that are not episodes", () => {
    const items = [{ Id: "season", Type: "Season", UserData: { Played: true } }, ep("1", true), { Id: "extra", Type: "Video", UserData: { Played: false } }, ep("2")];
    expect(bingeNextId(items)).toBe("2");
    const videos = [
      { Id: "v1", Type: "Video", UserData: { Played: true } },
      { Id: "v2", Type: "Video" },
    ];
    expect(bingeNextId(videos)).toBeNull();
  });

  it("is nothing for an empty folder", () => {
    expect(bingeNextId([])).toBeNull();
  });
});
