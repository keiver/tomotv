import { padFitMargins, padFitMaxHeight } from "@/components/pad-sheet";

describe("padFitMargins", () => {
  it("centres the card between the top and bottom insets", () => {
    expect(padFitMargins(52, 0, "center")).toEqual({ marginTop: 52, marginBottom: 0 });
  });

  it("keeps the bottom card clear of the home indicator", () => {
    expect(padFitMargins(59, 34, "bottom")).toEqual({ marginTop: 0, marginBottom: 34 });
  });

  it("holds the bottom card's margin when the device has no bottom inset", () => {
    expect(padFitMargins(20, 0, "bottom")).toEqual({ marginTop: 0, marginBottom: 8 });
  });
});

describe("padFitMaxHeight", () => {
  it("caps iPad's centred card at 900pt on a screen taller than that", () => {
    expect(padFitMaxHeight(1376, 24, 20, "center")).toBe(900);
  });

  it("keeps the centred card inside a shorter screen's safe area", () => {
    expect(padFitMaxHeight(834, 24, 20, "center")).toBe(834 - 24 - 20 - 16);
  });

  it("caps the Mac card to a share of the window, under the 900pt ceiling", () => {
    expect(padFitMaxHeight(1000, 0, 0, "center", true)).toBe(850);
  });

  it("keeps the 900pt ceiling on a tall Mac window", () => {
    expect(padFitMaxHeight(1800, 0, 0, "center", true)).toBe(900);
  });

  it("leaves iPhone's bottom card bounded by the screen alone", () => {
    expect(padFitMaxHeight(932, 59, 34, "bottom")).toBe(932 - 59 - 34 - 16);
  });

  it("holds a margin when the device has no bottom inset", () => {
    expect(padFitMaxHeight(700, 20, 0, "bottom")).toBe(700 - 20 - 8 - 16);
  });
});
