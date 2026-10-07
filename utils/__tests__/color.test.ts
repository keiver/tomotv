/** Theme colour math: hex reading, HSB round trips, WCAG contrast and the ink pick. */
import { bestInk, contrastRatio, hexToHsb, hsbToHex, normalizeHex } from "@/utils/color";

describe("normalizeHex", () => {
  it("reads six digits with or without the hash, in either case, and refuses anything else", () => {
    expect(normalizeHex("ffc312")).toBe("#FFC312");
    expect(normalizeHex(" #FfC312 ")).toBe("#FFC312");
    expect(normalizeHex("#FFF")).toBeNull();
    expect(normalizeHex("FFC31G")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("hsb", () => {
  it("names the primaries and the greys", () => {
    expect(hsbToHex({ h: 0, s: 1, b: 1 })).toBe("#FF0000");
    expect(hsbToHex({ h: 120, s: 1, b: 1 })).toBe("#00FF00");
    expect(hsbToHex({ h: 240, s: 1, b: 1 })).toBe("#0000FF");
    expect(hsbToHex({ h: 360, s: 1, b: 1 })).toBe("#FF0000");
    expect(hsbToHex({ h: 90, s: 0, b: 0.5 })).toBe("#808080");
    expect(hsbToHex({ h: 0, s: 0, b: 0 })).toBe("#000000");
  });

  it("round-trips a hex through hue, saturation and brightness", () => {
    for (const hex of ["#FFC312", "#FF7043", "#6CCFF6", "#A3D65C", "#2B1F05", "#123456", "#FFFFFF"]) {
      expect(hsbToHex(hexToHsb(hex))).toBe(hex);
    }
    expect(hexToHsb("#000000")).toEqual({ h: 0, s: 0, b: 0 });
  });
});

describe("contrast", () => {
  it("measures WCAG ratios", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });

  it("picks the ink that reads best on a fill, the first on a tie", () => {
    expect(bestInk("#FFC312", ["#2B1F05", "#FFFFFF"])).toBe("#2B1F05");
    expect(bestInk("#1A237E", ["#2B1F05", "#FFFFFF"])).toBe("#FFFFFF");
    expect(bestInk("#777777", ["#777777", "#777777"])).toBe("#777777");
  });
});
