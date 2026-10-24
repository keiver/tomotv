/** Connection limits wording: the chips, a provider row's second line, and the Channels row's. */
import { connectionLimitsSubtitle, limitOptions, playlistRowSubtitle } from "../connectionLimits";

const tr = (key: string) => (key === "liveTv.connectionLimitStreams" ? "Up to {count} streams at once" : key === "liveTv.connectionLimitsSet" ? "Set for {count}" : key);

describe("connection limits wording", () => {
  it("offers Auto first, then 1 to 5", () => {
    expect(limitOptions(tr)).toEqual([
      { value: 0, label: "liveTv.connectionLimitAuto" },
      { value: 1, label: "1" },
      { value: 2, label: "2" },
      { value: 3, label: "3" },
      { value: 4, label: "4" },
      { value: 5, label: "5" },
    ]);
  });

  it("says a playlist's limit is learned, or how many streams it allows at once", () => {
    expect(playlistRowSubtitle(undefined, tr)).toBe("liveTv.connectionLimitLearned");
    expect(playlistRowSubtitle(1, tr)).toBe("liveTv.connectionLimitStream");
    expect(playlistRowSubtitle(3, tr)).toBe("Up to 3 streams at once");
  });

  it("counts the limits set, else gives the hint", () => {
    expect(connectionLimitsSubtitle({}, tr)).toBe("liveTv.connectionLimitsHint");
    expect(connectionLimitsSubtitle({ "a.example": 1, "b.example": 5 }, tr)).toBe("Set for 2");
  });
});
