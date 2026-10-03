/** What a Schedule row opens: the program's panel, else the channel's, pinned to the timer unless the row is a series rule. */
import { timerPanelTarget } from "@/components/live-tv/timer-row";
import type { JellyfinTimer } from "@/types/jellyfin";

jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

const base: JellyfinTimer = { Id: "t1", Name: "News at Nine", ChannelId: "ch1", ChannelName: "Channel One", StartDate: "2026-10-03T21:00:00Z", EndDate: "2026-10-03T22:00:00Z", Status: "InProgress" };

describe("timerPanelTarget", () => {
  it("opens a program timer on its program, pinned to the timer", () => {
    expect(timerPanelTarget({ ...base, ProgramId: "p1" }, false)).toEqual({ videoId: "p1", name: "News at Nine", timerId: "t1" });
  });

  it("opens a manual timer on its channel under the channel's name", () => {
    expect(timerPanelTarget(base, false)).toEqual({ videoId: "ch1", name: "Channel One", timerId: "t1" });
  });

  it("a series rule opens its program without a timer pin", () => {
    expect(timerPanelTarget({ ...base, Id: "rule", ProgramId: "p1" }, true)).toEqual({ videoId: "p1", name: "News at Nine", timerId: undefined });
  });

  it("a rule on any channel with no program has nothing to open", () => {
    expect(timerPanelTarget({ ...base, ChannelId: undefined }, true)).toBeNull();
  });
});
