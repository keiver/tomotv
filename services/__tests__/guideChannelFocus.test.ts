/** The guide's focus: which row of programme cells holds focus, told to the one card that plays its clip. */
import { isGuideRowFocused, setFocusedGuideRow, subscribeGuideRowFocus } from "@/services/guideChannelFocus";

describe("guide row focus", () => {
  afterEach(() => setFocusedGuideRow(null));

  it("names the row's channel until focus leaves the cells, telling listeners only on a change", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeGuideRowFocus(listener);
    setFocusedGuideRow("c1");
    expect(isGuideRowFocused("c1")).toBe(true);
    expect(isGuideRowFocused("c2")).toBe(false);
    setFocusedGuideRow("c1");
    expect(listener).toHaveBeenCalledTimes(1);
    setFocusedGuideRow("c2");
    expect(isGuideRowFocused("c1")).toBe(false);
    expect(isGuideRowFocused("c2")).toBe(true);
    setFocusedGuideRow(null);
    expect(isGuideRowFocused("c2")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    setFocusedGuideRow("c3");
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
