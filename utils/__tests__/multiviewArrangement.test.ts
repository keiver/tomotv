import type { MultiviewArrangement } from "@/services/liveTvPreferences";
import { clearSpot, dueQueue, liveOrder, placeChannel, promoteSpot, resizeArrangement, seedArrangement } from "@/utils/multiviewArrangement";

const list = ["c1", "c2", "c3", "c4", "c5", "c6"];
const arrangement = (layout: MultiviewArrangement["layout"], spots: (string | null)[], chosen: string[] = []): MultiviewArrangement => ({ layout, spots, chosen, strip: true });

describe("multiview arrangement", () => {
  it("seeds the layout with the chosen channel in the big spot and the channels around it, the chosen one counted as the viewer's", () => {
    expect(seedArrangement("onePlusThree", list, "c3", () => false, true)).toEqual(arrangement("onePlusThree", ["c3", "c2", "c4", "c5"], ["c3"]));
  });

  it("leaves spots empty when the list runs out, and skips what it is told to", () => {
    expect(seedArrangement("onePlusThree", ["c1", "c2"], "c1", () => false, false).spots).toEqual(["c1", "c2", null, null]);
    expect(seedArrangement("onePlusTwo", list, "c3", (id) => id === "c2", true).spots).toEqual(["c3", "c1", "c4"]);
  });

  it("keeps the spots in order on another layout, dropping the last for a smaller one and filling a larger one from the list", () => {
    const four = arrangement("onePlusThree", ["c3", "c2", "c4", "c5"], ["c5"]);
    expect(resizeArrangement(four, "two", list)).toEqual(arrangement("two", ["c3", "c2"], []));
    expect(resizeArrangement(arrangement("two", ["c3", "c2"]), "grid4", ["c3", "c4", "c5"]).spots).toEqual(["c3", "c2", "c4", "c5"]);
  });

  it("swaps a promoted spot into the big spot of a featured layout, and only moves the sound in an equal one", () => {
    expect(promoteSpot(arrangement("onePlusThree", ["a", "b", "c", "d"]), 2)).toEqual({ arrangement: arrangement("onePlusThree", ["c", "b", "a", "d"]), soundAt: 0 });
    expect(promoteSpot(arrangement("grid4", ["a", "b", "c", "d"]), 2)).toEqual({ arrangement: arrangement("grid4", ["a", "b", "c", "d"]), soundAt: 2 });
  });

  it("puts a channel in a spot as the viewer's choice, trading places when it already shows elsewhere", () => {
    expect(placeChannel(arrangement("onePlusTwo", ["a", "b", null]), 2, "x")).toEqual(arrangement("onePlusTwo", ["a", "b", "x"], ["x"]));
    expect(placeChannel(arrangement("onePlusTwo", ["a", "b", "c"], ["a"]), 0, "c")).toEqual(arrangement("onePlusTwo", ["c", "b", "a"], ["a", "c"]));
  });

  it("clears a spot and forgets it was chosen", () => {
    expect(clearSpot(arrangement("two", ["a", "b"], ["b"]), 1)).toEqual(arrangement("two", ["a", null], []));
  });

  it("orders the live sessions sound first, empty spots left out", () => {
    expect(liveOrder(arrangement("grid4", ["a", null, "c", "d"]), 2)).toEqual(["c", "a", "d"]);
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
