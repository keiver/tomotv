import { settleShelfOrder } from "@/components/continue-watching-row";

const entries = (...ids: string[]) => ids.map((Id) => ({ video: { Id } }));
const ids = <T extends { video: { Id: string } }>(list: T[]) => list.map((entry) => entry.video.Id);

/**
 * What keeps the Continue row's cards where the viewer left them. The server ranks the resume list
 * by last played, so the card pressed into the player leads it on the way back, and a card that
 * moves under UIKit's focus restoration takes the row's scroll with it.
 */
describe("settleShelfOrder", () => {
  it("takes the server's order for a row that has shown nothing", () => {
    const settled = settleShelfOrder(entries("a", "b", "c"), []);
    expect(ids(settled.items)).toEqual(["a", "b", "c"]);
    expect(settled.slots).toEqual(["a", "b", "c"]);
  });

  // The reported bug: playing the third card re-sorts it to the front on the next fetch.
  it("keeps a placed card in its slot when the server re-sorts", () => {
    const settled = settleShelfOrder(entries("c", "a", "b"), ["a", "b", "c"]);
    expect(ids(settled.items)).toEqual(["a", "b", "c"]);
  });

  it("leads the row with an item it has never shown", () => {
    const settled = settleShelfOrder(entries("x", "c", "a", "b"), ["a", "b", "c"]);
    expect(ids(settled.items)).toEqual(["x", "a", "b", "c"]);
    expect(settled.slots).toEqual(["x", "a", "b", "c"]);
  });

  it("drops a card the server no longer lists without moving the rest", () => {
    const settled = settleShelfOrder(entries("c", "a"), ["a", "b", "c"]);
    expect(ids(settled.items)).toEqual(["a", "c"]);
  });

  // A Resume query answered during Sessions/Stopped processing omits the item that just played.
  it("returns a transiently omitted card to its own slot", () => {
    const omitted = settleShelfOrder(entries("a", "c"), ["a", "b", "c"]);
    const restored = settleShelfOrder(entries("b", "a", "c"), omitted.slots);
    expect(ids(restored.items)).toEqual(["a", "b", "c"]);
  });

  it("caps the slots it remembers", () => {
    const many = Array.from({ length: 80 }, (_, index) => `id${index}`);
    expect(settleShelfOrder(entries(...many), []).slots).toHaveLength(64);
  });
});
