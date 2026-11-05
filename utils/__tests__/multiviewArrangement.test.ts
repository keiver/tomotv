import type { MultiviewArrangement } from "@/services/liveTvPreferences";
import { clearSpot, dueQueue, liveOrder, placeChannel, promoteSpot, resizeArrangement, seedArrangement, switchLayout } from "@/utils/multiviewArrangement";

const list = ["c1", "c2", "c3", "c4", "c5", "c6"];
const arrangement = (layout: MultiviewArrangement["layout"], spots: (string | null)[], chosen: string[] = []): MultiviewArrangement => ({ layout, spots, chosen });

describe("multiview arrangement", () => {
  it("seeds the live spots with the chosen channel in the big spot and the channels around it, and leaves the picture spots empty", () => {
    expect(seedArrangement("bigThree", list, "c3", () => false)).toEqual(arrangement("bigThree", ["c3", "c2", "c4", "c5"], ["c3"]));
    expect(seedArrangement("rowThree", list, "c3", () => false).spots).toEqual(["c3", "c2", "c4", null, null, null]);
  });

  it("leaves live spots empty when the list runs out, and skips what it is told to", () => {
    expect(seedArrangement("bigThree", ["c1", "c2"], "c1", () => false).spots).toEqual(["c1", "c2", null, null]);
    expect(seedArrangement("bigTwo", list, "c3", (id) => id === "c2")).toEqual(arrangement("bigTwo", ["c3", "c1", "c4"], ["c3"]));
  });

  it("keeps live channels live and picture channels pictures on another layout, moving extra live ones to its picture spots", () => {
    const four = arrangement("bigThree", ["c3", "c2", "c4", "c5"], ["c5"]);
    expect(resizeArrangement(four, "rowThree", list)).toEqual(arrangement("rowThree", ["c3", "c2", "c4", "c5", null, null], ["c5"]));
    expect(resizeArrangement(arrangement("halvesTwo", ["a", "b", "c", null, "p", "q"]), "grid4", ["a", "x", "y"]).spots).toEqual(["a", "b", "c", "x"]);
    expect(resizeArrangement(arrangement("halvesThree", ["a", "b", "c", "d", "p", "q", "r"]), "bigTwo", []).spots).toEqual(["a", "b", "c"]);
  });

  it("switches layout around the first spot's channel, filling new live spots from its neighbours", () => {
    expect(switchLayout(arrangement("bigTwo", ["c3", "c2", "c4"]), "grid4", list, () => false).spots).toEqual(["c3", "c2", "c4", "c5"]);
  });

  it("swaps a promoted spot into the big spot of a featured layout, and only moves the sound in an equal one", () => {
    expect(promoteSpot(arrangement("bigThree", ["a", "b", "c", "d"]), 2, 0)).toEqual({ arrangement: arrangement("bigThree", ["c", "b", "a", "d"]), soundAt: 0 });
    expect(promoteSpot(arrangement("grid4", ["a", "b", "c", "d"]), 2, 0)).toEqual({ arrangement: arrangement("grid4", ["a", "b", "c", "d"]), soundAt: 2 });
  });

  it("brings a picture spot's channel into the live spot with the sound, the sound's channel taking the picture spot", () => {
    expect(promoteSpot(arrangement("rowThree", ["a", "b", "c", "p", null, null]), 3, 1)).toEqual({ arrangement: arrangement("rowThree", ["a", "p", "c", "b", null, null]), soundAt: 1 });
    expect(promoteSpot(arrangement("halvesThree", ["a", "b", "c", "d", "p", null, null]), 4, 2).arrangement.spots).toEqual(["a", "b", "p", "d", "c", null, null]);
  });

  it("puts a channel in a spot as the viewer's choice, trading places when it already shows elsewhere", () => {
    expect(placeChannel(arrangement("bigTwo", ["a", "b", null]), 2, "x")).toEqual(arrangement("bigTwo", ["a", "b", "x"], ["x"]));
    expect(placeChannel(arrangement("bigTwo", ["a", "b", "c"], ["a"]), 0, "c")).toEqual(arrangement("bigTwo", ["c", "b", "a"], ["a", "c"]));
  });

  it("clears a spot and forgets it was chosen", () => {
    expect(clearSpot(arrangement("bigTwo", ["a", "b", "c"], ["b"]), 1)).toEqual(arrangement("bigTwo", ["a", null, "c"], []));
  });

  it("orders the live sessions sound first, empty spots and picture spots left out", () => {
    expect(liveOrder(arrangement("grid4", ["a", null, "c", "d"]), 2)).toEqual(["c", "a", "d"]);
    expect(liveOrder(arrangement("rowThree", ["a", "b", "c", "p", "q", null]), 0)).toEqual(["a", "b", "c"]);
  });

  it("splits the queue into what airs now and what comes, with the next start, dropping what has ended", () => {
    const queue = [
      { channelId: "a", name: "A", startMs: 100, endMs: 200 },
      { channelId: "b", name: "B", startMs: 300, endMs: 400 },
      { channelId: "c", name: "C", startMs: 0, endMs: 50 },
    ];
    expect(dueQueue(queue, 150)).toEqual({ due: [queue[0]], rest: [queue[1]], nextAt: 300 });
  });
});
