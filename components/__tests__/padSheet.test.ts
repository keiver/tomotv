import { padFitMaxHeight } from "@/components/pad-sheet";

describe("padFitMaxHeight", () => {
  it("caps iPad's centred card at 900pt on a screen taller than that", () => {
    expect(padFitMaxHeight(1376, 24, 20, "center")).toBe(900);
  });

  it("keeps the centred card inside a shorter screen's safe area", () => {
    expect(padFitMaxHeight(834, 24, 20, "center")).toBe(834 - 24 - 20 - 16);
  });

  it("leaves iPhone's bottom card bounded by the screen alone", () => {
    expect(padFitMaxHeight(932, 59, 34, "bottom")).toBe(932 - 59 - 34 - 16);
  });

  it("holds a margin when the device has no bottom inset", () => {
    expect(padFitMaxHeight(700, 20, 0, "bottom")).toBe(700 - 20 - 8 - 16);
  });
});
