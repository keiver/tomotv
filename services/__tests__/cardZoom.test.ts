import { getCardZoom, setCardZoom, subscribeCardZoom } from "@/services/cardZoom";
import { getUiPreferences, updateUiPreferences } from "@/services/uiPreferences";

describe("card zoom", () => {
  afterEach(() => updateUiPreferences({ cardSize: 1 }));

  it("is the saved card size", () => {
    expect(getCardZoom()).toBe(1);
    updateUiPreferences({ cardSize: 1.25 });
    expect(getCardZoom()).toBe(1.25);
  });

  it("saves a pinch or key's zoom and tells subscribers, and not about the same value again", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeCardZoom(listener);
    setCardZoom(1.2);
    setCardZoom(1.2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getCardZoom()).toBe(1.2);
    expect(getUiPreferences().cardSize).toBe(1.2);
    unsubscribe();
    setCardZoom(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
