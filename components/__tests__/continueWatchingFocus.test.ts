/**
 * Where focus lands when the Continue row reloads on the way back. A launch re-ranks the row and
 * the played card leads it; an info panel that changed nothing leaves the card where it was, and
 * claiming the front there took focus off it.
 */
import { resolveFocusAnchor } from "@/components/continue-watching-row";

const anchor = (over: Partial<Parameters<typeof resolveFocusAnchor>[0]> = {}) => ({
  launchedId: null,
  panelId: null,
  ids: ["a", "b", "c"],
  settled: true,
  ...over,
});

describe("resolveFocusAnchor", () => {
  it("claims the front for a card the row launched, wherever it ended up", () => {
    expect(resolveFocusAnchor(anchor({ launchedId: "b" }))).toEqual({ claimFirst: true, keepPanelId: false });
    expect(resolveFocusAnchor(anchor({ launchedId: "gone", ids: ["a"] }))).toEqual({ claimFirst: true, keepPanelId: false });
  });

  it("leaves focus alone when the info panel's card is still in the row", () => {
    expect(resolveFocusAnchor(anchor({ panelId: "b" }))).toEqual({ claimFirst: false, keepPanelId: false });
  });

  it("claims the front when the panel took its card off the row", () => {
    expect(resolveFocusAnchor(anchor({ panelId: "b", ids: ["a", "c"] }))).toEqual({ claimFirst: true, keepPanelId: false });
  });

  it("holds the panel's card over an unsettled paint, whose tail is the previous resolution", () => {
    expect(resolveFocusAnchor(anchor({ panelId: "b", settled: false }))).toEqual({ claimFirst: false, keepPanelId: true });
    // Absent from the settled paint after all: the claim comes then.
    expect(resolveFocusAnchor(anchor({ panelId: "b", ids: ["a", "c"], settled: false }))).toEqual({ claimFirst: true, keepPanelId: false });
  });

  it("does nothing for a reload the viewer did not come back to", () => {
    expect(resolveFocusAnchor(anchor())).toEqual({ claimFirst: false, keepPanelId: false });
  });

  it("takes the launch over a panel anchor left behind by a long press before it", () => {
    expect(resolveFocusAnchor(anchor({ launchedId: "a", panelId: "b" }))).toEqual({ claimFirst: true, keepPanelId: false });
  });
});
