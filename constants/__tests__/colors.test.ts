import { contrastRatio } from "@/utils/color";

import { COLORS } from "../colors";

const AMBIENT_BASE = "#1C1C1E";

describe("text colours on the surfaces they sit on reach 4.5:1", () => {
  const pairs: [string, keyof typeof COLORS, string][] = [
    ["TEXT_SECONDARY", "TEXT_SECONDARY", COLORS.SURFACE],
    ["TEXT_TERTIARY", "TEXT_TERTIARY", COLORS.SURFACE],
    ["TEXT_TERTIARY", "TEXT_TERTIARY", COLORS.SURFACE_SUNKEN],
    ["TEXT_TERTIARY", "TEXT_TERTIARY", COLORS.BACKGROUND_DEEP],
    ["TEXT_TERTIARY", "TEXT_TERTIARY", AMBIENT_BASE],
    ["TEXT_TERTIARY", "TEXT_TERTIARY", COLORS.MEDIA_BACKGROUND],
    ["DESTRUCTIVE_SOFT", "DESTRUCTIVE_SOFT", COLORS.SURFACE],
    ["DESTRUCTIVE", "DESTRUCTIVE", AMBIENT_BASE],
    ["TEXT_DIM", "TEXT_DIM", COLORS.SURFACE_NEUTRAL],
  ];

  it.each(pairs)("%s on %s", (_name, token, background) => {
    expect(contrastRatio(COLORS[token], background)).toBeGreaterThanOrEqual(4.5);
  });

  it("TEXT_TERTIARY stays dimmer than TEXT_SECONDARY", () => {
    expect(contrastRatio(COLORS.TEXT_TERTIARY, COLORS.SURFACE)).toBeLessThan(contrastRatio(COLORS.TEXT_SECONDARY, COLORS.SURFACE));
  });
});
