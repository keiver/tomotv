/**
 * Where focus lands when the Continue row reloads on the way back. A launch re-ranks the row and
 * the played card leads it; a card left from that is still there keeps its focus, and one that
 * left the row hands focus to the card that takes its slot.
 */
import { resolveFocusAnchor } from "@/components/continue-watching-row";

const anchor = (over: Partial<Parameters<typeof resolveFocusAnchor>[0]> = {}) => ({
  launchedId: null,
  left: null,
  ids: ["a", "b", "c"],
  settled: true,
  ...over,
});

describe("resolveFocusAnchor", () => {
  it("claims the front for a card the row launched, wherever it ended up", () => {
    expect(resolveFocusAnchor(anchor({ launchedId: "b" }))).toEqual({ claimIndex: 0, keepLeft: false });
    expect(resolveFocusAnchor(anchor({ launchedId: "gone", ids: ["a"] }))).toEqual({ claimIndex: 0, keepLeft: false });
  });

  it("leaves focus alone when the card left from is still in the row", () => {
    expect(resolveFocusAnchor(anchor({ left: { id: "b", index: 1 } }))).toEqual({ claimIndex: null, keepLeft: false });
  });

  it("claims the removed card's slot, not the front, when a watched-through show leaves the row", () => {
    expect(resolveFocusAnchor(anchor({ left: { id: "x", index: 2 }, ids: ["a", "b", "c", "d"] }))).toEqual({ claimIndex: 2, keepLeft: false });
  });

  it("claims the new last card when the removed card was the last one", () => {
    expect(resolveFocusAnchor(anchor({ left: { id: "x", index: 3 } }))).toEqual({ claimIndex: 2, keepLeft: false });
  });

  it("holds the card left from over an unsettled paint, whose tail is the previous resolution", () => {
    expect(resolveFocusAnchor(anchor({ left: { id: "b", index: 1 }, settled: false }))).toEqual({ claimIndex: null, keepLeft: true });
    // Absent from the unsettled paint: the claim comes then.
    expect(resolveFocusAnchor(anchor({ left: { id: "x", index: 1 }, settled: false }))).toEqual({ claimIndex: 1, keepLeft: false });
  });

  it("claims nothing over an empty paint, holding the card for a tail that may follow", () => {
    expect(resolveFocusAnchor(anchor({ left: { id: "x", index: 0 }, ids: [], settled: false }))).toEqual({ claimIndex: null, keepLeft: true });
    expect(resolveFocusAnchor(anchor({ left: { id: "x", index: 0 }, ids: [] }))).toEqual({ claimIndex: null, keepLeft: false });
  });

  it("does nothing for a reload the viewer did not come back to", () => {
    expect(resolveFocusAnchor(anchor())).toEqual({ claimIndex: null, keepLeft: false });
  });

  it("takes the launch over the card left from", () => {
    expect(resolveFocusAnchor(anchor({ launchedId: "a", left: { id: "b", index: 1 } }))).toEqual({ claimIndex: 0, keepLeft: false });
  });
});
