/** The editor's palette, slider tracks and theme names. */
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

import { brightnessGradient, hueGradient, saturationGradient } from "@/components/theme/gradients";
import { KNOB_INSET, KNOB_W, knobOffset, valueAt } from "@/components/theme/hsb-slider";
import { inPalette, SWATCHES } from "@/components/theme/swatch-grid";
import { themeName } from "@/components/theme/theme-name";
import { COLORS } from "@/constants/colors";
import { BUILT_IN_THEMES, cardPalette } from "@/services/cardTheme";
import { contrastRatio, hexToHsb, normalizeHex } from "@/utils/color";

describe("SWATCHES", () => {
  it("is fourteen valid, distinct colours led by the app's own gold and the primaries, so with the hex box it fills three rows of five", () => {
    expect(SWATCHES).toHaveLength(14);
    const hexes = SWATCHES.map((swatch) => swatch.hex);
    expect(hexes.every((hex) => normalizeHex(hex) === hex)).toBe(true);
    expect(new Set(hexes).size).toBe(14);
    // The built-in themes lead, in their own order.
    expect(SWATCHES.slice(0, 4).map((swatch) => swatch.hex)).toEqual(BUILT_IN_THEMES.map((theme) => theme.accent));
    expect(SWATCHES[0].hex).toBe("#FFC312");
    expect((SWATCHES.length + 1) % 5).toBe(0);
  });

  it("clears 4.5:1 for every colour: as title text on the canvas, and for its ink on its own fill", () => {
    for (const { hex } of SWATCHES) {
      expect(contrastRatio(hex, COLORS.BACKGROUND)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(hex, cardPalette(hex).ink)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("spreads round the wheel: no two hued colours within 20 degrees, and no more than three greens", () => {
    // A neutral (Silver) has no hue to space.
    const hues = SWATCHES.map(({ hex }) => hexToHsb(hex))
      .filter((hsb) => hsb.s >= 0.2)
      .map((hsb) => hsb.h);
    expect(hues.filter((h) => h >= 70 && h <= 175)).toHaveLength(3);
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const apart = Math.abs(hues[i] - hues[j]);
        expect(Math.min(apart, 360 - apart)).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("holds every built-in theme, so a built-in opens the editor on its tile", () => {
    for (const theme of BUILT_IN_THEMES) expect(inPalette(theme.accent)).toBe(true);
    expect(inPalette("#123456")).toBe(false);
  });
});

describe("slider tracks", () => {
  it("runs hue round the wheel, saturation from grey, and brightness from black", () => {
    expect(hueGradient()).toBe("linear-gradient(90deg, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)");
    expect(saturationGradient({ h: 0, s: 0.5, b: 1 })).toBe("linear-gradient(90deg, #FFFFFF, #FF0000)");
    expect(brightnessGradient({ h: 240, s: 1, b: 0.2 })).toBe("linear-gradient(90deg, #000000, #0000FF)");
  });
});

describe("slider knob", () => {
  it("stays inset inside the track at both ends and maps a touch back to the value under it", () => {
    expect(knobOffset(0, 100, 300)).toBe(KNOB_INSET);
    expect(knobOffset(100, 100, 300)).toBe(300 - KNOB_W - KNOB_INSET);
    expect(knobOffset(150, 100, 300)).toBe(300 - KNOB_W - KNOB_INSET);
    expect(knobOffset(-5, 100, 300)).toBe(KNOB_INSET);
    expect(valueAt(KNOB_W / 2 + knobOffset(40, 100, 300), 100, 300)).toBeCloseTo(40, 0);
    expect(valueAt(0, 360, 300)).toBe(0);
    expect(valueAt(999, 360, 300)).toBe(360);
    expect(valueAt(10, 100, KNOB_W)).toBe(0);
  });
});

describe("themeName", () => {
  it("names a built-in from the catalogue, a saved theme by its own name, and a nameless one by its colour", () => {
    expect(themeName({ id: "purple", name: "", accent: "#A666FF" })).toBe("appearance.theme.purple");
    expect(themeName({ id: "t1", name: "  Sea ", accent: "#12CBC4" })).toBe("Sea");
    expect(themeName({ id: "t1", name: " ", accent: "#12CBC4" })).toBe("#12CBC4");
  });
});
