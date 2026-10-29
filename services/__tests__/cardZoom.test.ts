import { getCardZoom, setCardZoom, subscribeCardZoom } from "@/services/cardZoom";

describe("card zoom for this run of the app", () => {
  it("starts at the cards' own size", () => {
    expect(getCardZoom()).toBe(1);
  });

  it("tells subscribers about a change, and not about the same value again", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeCardZoom(listener);
    setCardZoom(1.2);
    setCardZoom(1.2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getCardZoom()).toBe(1.2);
    unsubscribe();
    setCardZoom(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
