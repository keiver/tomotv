import { cardResumeProgress } from "../resumeProgress";

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
