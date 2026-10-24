import { bingeFocusId, cardResumeProgress, folderWatchedProgress, queueTrackProgress } from "../resumeProgress";

describe("folderWatchedProgress", () => {
  it("is the server percentage of a partly watched series", () => {
    expect(folderWatchedProgress({ Type: "Series", UserData: { PlayedPercentage: 20 } })).toBe(0.2);
  });

  it("is full for a watched season", () => {
    expect(folderWatchedProgress({ Type: "Season", UserData: { Played: true, PlayedPercentage: 100 } })).toBe(1);
  });

  it("gives a season with nothing watched no fill", () => {
    expect(folderWatchedProgress({ Type: "Season", UserData: { PlayedPercentage: 0 } })).toBeUndefined();
  });

  it("gives a collection or a movie no fill", () => {
    expect(folderWatchedProgress({ Type: "BoxSet", UserData: { PlayedPercentage: 50 } })).toBeUndefined();
    expect(folderWatchedProgress({ Type: "Movie", UserData: { Played: true } })).toBeUndefined();
  });
});

describe("bingeFocusId", () => {
  const episode = (Id: string, Played = false, PlaybackPositionTicks = 0) => ({ Id, Type: "Episode", UserData: { Played, PlaybackPositionTicks } });

  it("is the episode after the last watched one", () => {
    expect(bingeFocusId([episode("e1"), episode("e2", true), episode("e3", true), episode("e4"), episode("e5")])).toBe("e4");
  });

  it("is the episode in progress after the watched ones", () => {
    expect(bingeFocusId([episode("e1", true), episode("e2"), episode("e3", false, 500), episode("e4")])).toBe("e3");
  });

  it("is nothing when the last episode is watched", () => {
    expect(bingeFocusId([episode("e1"), episode("e2", true)])).toBeUndefined();
  });

  it("is nothing when no episode was started", () => {
    expect(bingeFocusId([episode("e1"), episode("e2")])).toBeUndefined();
  });

  it("skips items that are not episodes", () => {
    expect(bingeFocusId([episode("e1", true), { Id: "extra", Type: "Video", UserData: {} }, episode("e2")])).toBe("e2");
    const seasons = [
      { Id: "s1", Type: "Season", UserData: { Played: true } },
      { Id: "s2", Type: "Season", UserData: {} },
    ];
    expect(bingeFocusId(seasons)).toBeUndefined();
  });
});

describe("cardResumeProgress", () => {
  it("returns the watched fraction from the resume position", () => {
    expect(cardResumeProgress({ RunTimeTicks: 1000, UserData: { PlaybackPositionTicks: 250 } })).toBe(0.25);
  });

  it("gives an untouched item no bar", () => {
    expect(cardResumeProgress({ RunTimeTicks: 1000, UserData: { PlaybackPositionTicks: 0, Played: false } })).toBeUndefined();
  });

  it("gives a watched item no bar, whatever position the server kept", () => {
    expect(cardResumeProgress({ RunTimeTicks: 1000, UserData: { PlaybackPositionTicks: 900, Played: true } })).toBeUndefined();
  });

  it("falls back to the server percentage when the item has no runtime", () => {
    expect(cardResumeProgress({ RunTimeTicks: 0, UserData: { PlaybackPositionTicks: 500, PlayedPercentage: 40 } })).toBe(0.4);
  });

  it("gives an item with neither runtime nor percentage no bar", () => {
    expect(cardResumeProgress({ RunTimeTicks: 0, UserData: { PlaybackPositionTicks: 500 } })).toBeUndefined();
  });

  it("gives an item with no UserData no bar", () => {
    expect(cardResumeProgress({ RunTimeTicks: 1000 })).toBeUndefined();
  });
});

describe("queueTrackProgress", () => {
  const TRACK = { RunTimeTicks: 240 * 10_000_000 };

  it("is the position over the runtime", () => {
    expect(queueTrackProgress(TRACK, 60)).toBe(0.25);
  });

  it("is full on the last tick, which lands a second short of the end", () => {
    expect(queueTrackProgress(TRACK, 239)).toBe(1);
    expect(queueTrackProgress(TRACK, 238)).toBeLessThan(1);
  });

  it("stays at the start for a track with no runtime", () => {
    expect(queueTrackProgress({ RunTimeTicks: 0 }, 60)).toBe(0);
  });

  it("clamps a position past the end", () => {
    expect(queueTrackProgress(TRACK, 500)).toBe(1);
  });
});
