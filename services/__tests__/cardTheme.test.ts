/** Card themes: the built-ins, the derived ink, the contrast warning and reading a stored theme. */
import { COLORS } from "@/constants/colors";
import { BUILT_IN_THEMES, cardPalette, DEFAULT_CARD_THEME, derivePalette, isLowContrast, NEUTRAL_GLOW, newThemeId, parseCardTheme, themeToSave } from "@/services/cardTheme";
import { contrastRatio, hexToHsb } from "@/utils/color";

describe("cardTheme", () => {
  it("defaults to the app's gold, and every built-in keeps the warm brown ink and a visible ring", () => {
    expect(DEFAULT_CARD_THEME.accent).toBe(COLORS.ACCENT);
    expect(BUILT_IN_THEMES.map((theme) => theme.id)).toEqual(["gold", "blue", "green", "purple"]);
    for (const theme of BUILT_IN_THEMES) {
      expect(cardPalette(theme.accent).ink).toBe(COLORS.ON_ACCENT_WARM);
      expect(isLowContrast(theme.accent)).toBe(false);
    }
  });

  it("hands every card the same palette object for an accent, and starts over past its limit", () => {
    expect(cardPalette("#1DBFAE")).toBe(cardPalette("#1DBFAE"));
    const first = cardPalette("#000001");
    for (let i = 2; i <= 80; i++) cardPalette(`#0000${i.toString(16).padStart(2, "0").toUpperCase()}`);
    expect(cardPalette("#000001")).not.toBe(first);
    expect(cardPalette("#000001")).toEqual(first);
  });

  it("gives a dark accent white ink, and warns when it vanishes on the canvas", () => {
    expect(cardPalette("#1A237E")).toMatchObject({ accent: "#1A237E", ink: COLORS.TEXT_PRIMARY, onAccent: COLORS.TEXT_PRIMARY });
    expect(isLowContrast("#1A237E")).toBe(true);
    expect(isLowContrast("#202020")).toBe(true);
  });

  it("is the app's own gold tokens for gold, not a derivation of them", () => {
    expect(cardPalette(COLORS.ACCENT)).toEqual({
      accent: COLORS.ACCENT,
      accentFocused: COLORS.ACCENT_FOCUSED,
      accentDim: COLORS.ACCENT_DIM,
      accentDimFocused: COLORS.ACCENT_DIM_FOCUSED,
      accentDeep: COLORS.ACCENT_DEEP,
      onAccent: COLORS.ON_ACCENT,
      ink: COLORS.ON_ACCENT_WARM,
      glow: NEUTRAL_GLOW,
    });
  });

  it("glows the canvas in a pale near-bright of the accent's hue; the gold keeps the neutral light", () => {
    expect(cardPalette(COLORS.ACCENT).glow).toBe(NEUTRAL_GLOW);
    for (const theme of BUILT_IN_THEMES.slice(1)) {
      const glow = hexToHsb(derivePalette(theme.accent).glow);
      expect(Math.abs(glow.h - hexToHsb(theme.accent).h)).toBeLessThan(2);
      expect(glow.s).toBeLessThanOrEqual(0.45);
      expect(glow.b).toBeCloseTo(0.94, 2);
    }
  });

  it("derives the other tones in gold's own steps: focus lighter, dim and deep darker, hue held", () => {
    for (const theme of BUILT_IN_THEMES.slice(1)) {
      const palette = derivePalette(theme.accent);
      const base = hexToHsb(theme.accent);
      expect(hexToHsb(palette.accentFocused).b).toBeGreaterThanOrEqual(base.b);
      expect(hexToHsb(palette.accentFocused).s).toBeLessThan(base.s);
      expect(hexToHsb(palette.accentDim).b).toBeLessThan(base.b);
      expect(hexToHsb(palette.accentDeep).b).toBeLessThan(base.b);
      expect(Math.abs(hexToHsb(palette.accentDim).h - base.h)).toBeLessThan(2);
    }
  });

  it("inks every built-in fill legibly, the CTA text and the bar text alike", () => {
    for (const theme of BUILT_IN_THEMES) {
      const palette = cardPalette(theme.accent);
      expect(contrastRatio(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.ink, palette.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("reads a stored theme, normalising its colour, and refuses a broken one", () => {
    expect(parseCardTheme({ id: "t1", name: "Sea", accent: "6ccff6" })).toEqual({ id: "t1", name: "Sea", accent: "#6CCFF6" });
    expect(parseCardTheme({ id: "", name: "Sea", accent: "#6CCFF6" })).toBeNull();
    expect(parseCardTheme({ id: "t1", accent: "#6CCFF6" })).toBeNull();
    expect(parseCardTheme({ id: "t1", name: "Sea", accent: "teal" })).toBeNull();
    expect(parseCardTheme("t1")).toBeNull();
    expect(parseCardTheme(null)).toBeNull();
  });

  it("saves nothing without a name", () => {
    expect(themeToSave({}, "  ", "#09BA9D", "fresh")).toBeNull();
    expect(themeToSave({}, "", "#09BA9D", "fresh")).toBeNull();
  });

  it("gives a new named theme the fresh id", () => {
    expect(themeToSave({}, " Sea ", "#09BA9D", "fresh")).toEqual({ id: "fresh", name: "Sea", accent: "#09BA9D" });
  });

  it("keeps a saved theme's id, and its name when the prompt comes back empty", () => {
    expect(themeToSave({ id: "t1", name: "Sea" }, "Ocean", "#09BA9D", "fresh")).toEqual({ id: "t1", name: "Ocean", accent: "#09BA9D" });
    expect(themeToSave({ id: "t1", name: "Sea" }, "", "#09BA9D", "fresh")).toEqual({ id: "t1", name: "Sea", accent: "#09BA9D" });
  });

  it("mints ids that differ within the same millisecond", () => {
    expect(newThemeId(1000)).toMatch(/^t[0-9a-z]+$/);
    expect(new Set(Array.from({ length: 20 }, () => newThemeId(1000))).size).toBeGreaterThan(1);
  });
});
