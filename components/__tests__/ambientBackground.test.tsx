/** The ambient canvas: the glow mask tinted by the chosen theme, neutral on the other canvases, filters untinted. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("expo-image", () => ({ Image: (props: object) => require("react").createElement("ExpoImage", props) }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { AmbientBackground } from "@/components/ambient-background";
import { BUILT_IN_THEMES, cardPalette, DEFAULT_CARD_THEME, NEUTRAL_GLOW } from "@/services/cardTheme";
import { updateUiPreferences } from "@/services/uiPreferences";

function glowTint(variant?: "default" | "filters"): string | undefined {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<AmbientBackground variant={variant} />);
  });
  const tints = tree.root.findAll((node) => String(node.type) === "ExpoImage").map((node) => node.props.tintColor);
  act(() => tree.unmount());
  return tints.find((tint) => tint !== undefined);
}

describe("AmbientBackground", () => {
  beforeEach(() => updateUiPreferences({ cardTheme: DEFAULT_CARD_THEME, background: "artwork" }));

  it("tints the glow in the theme's glow on the theme-colour canvas, neutral for gold", () => {
    updateUiPreferences({ cardTheme: BUILT_IN_THEMES[1], background: "accent" });
    expect(glowTint()).toBe(cardPalette(BUILT_IN_THEMES[1].accent).glow);
    updateUiPreferences({ cardTheme: DEFAULT_CARD_THEME });
    expect(glowTint()).toBe(NEUTRAL_GLOW);
  });

  it("keeps the neutral light on the clear and artwork canvases whatever the theme", () => {
    updateUiPreferences({ cardTheme: BUILT_IN_THEMES[2], background: "clear" });
    expect(glowTint()).toBe(NEUTRAL_GLOW);
    updateUiPreferences({ background: "artwork" });
    expect(glowTint()).toBe(NEUTRAL_GLOW);
  });

  it("draws the filters canvas untinted", () => {
    expect(glowTint("filters")).toBeUndefined();
  });
});
