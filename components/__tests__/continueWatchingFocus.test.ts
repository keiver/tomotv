/**
 * Where focus lands when the Continue row reloads on the way back: the same card, else the same
 * show's card, else the card that took its slot.
 */
import { resolveFocusAnchor } from "@/components/continue-watching-row";

const row = (...cards: string[]) => cards.map((card) => ({ id: card.split(":")[0], container: card.split(":")[1] }));

describe("resolveFocusAnchor", () => {
  it("claims nothing when the card is still in its slot", () => {
    expect(resolveFocusAnchor({ id: "b", container: "B", index: 1 }, row("a:A", "b:B", "c:C"), true)).toEqual({ claimIndex: null, keepAnchor: false });
  });

  it("follows a played card the server re-ranked to the front", () => {
    expect(resolveFocusAnchor({ id: "b", container: "B", index: 1 }, row("b:B", "a:A", "c:C"), true)).toEqual({ claimIndex: 0, keepAnchor: false });
  });

  it("stays on the show when a finished episode comes back as its next one", () => {
    expect(resolveFocusAnchor({ id: "mf1", container: "MF", index: 3 }, row("a:A", "b:B", "c:C", "mf2:MF", "d:D", "e:E"), true)).toEqual({ claimIndex: 3, keepAnchor: false });
  });

  it("hands focus to the card in its slot when the show is done", () => {
    expect(resolveFocusAnchor({ id: "mf1", container: "MF", index: 3 }, row("a:A", "b:B", "c:C", "d:D", "e:E"), true)).toEqual({ claimIndex: 3, keepAnchor: false });
    expect(resolveFocusAnchor({ id: "e", container: "E", index: 4 }, row("a:A", "b:B", "c:C"), true)).toEqual({ claimIndex: 2, keepAnchor: false });
  });

  it("keeps the anchor over an unsettled paint, whose tail is the previous resolution", () => {
    expect(resolveFocusAnchor({ id: "mf1", container: "MF", index: 3 }, row("a:A", "b:B", "c:C", "mf1:MF"), false)).toEqual({ claimIndex: null, keepAnchor: true });
    expect(resolveFocusAnchor({ id: "b", container: "B", index: 1 }, row("a:A", "c:C"), false)).toEqual({ claimIndex: 1, keepAnchor: true });
  });

  it("claims nothing over an empty paint or without a press", () => {
    expect(resolveFocusAnchor({ id: "b", container: "B", index: 1 }, [], false)).toEqual({ claimIndex: null, keepAnchor: true });
    expect(resolveFocusAnchor({ id: "b", container: "B", index: 1 }, [], true)).toEqual({ claimIndex: null, keepAnchor: false });
    expect(resolveFocusAnchor(null, row("a:A"), true)).toEqual({ claimIndex: null, keepAnchor: false });
  });
});
