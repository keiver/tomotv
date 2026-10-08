/** A card follows the chosen accent and nothing else: another preference changing never re-renders it. */
import { CardPaletteOverride, currentPalette, themedStyles, useCardPalette } from "@/hooks/useCardPalette";
import { cardPalette, DEFAULT_CARD_THEME } from "@/services/cardTheme";
import { updateUiPreferences } from "@/services/uiPreferences";
import React from "react";
import { StyleSheet } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const renders: string[] = [];
function Probe() {
  renders.push(useCardPalette().accent);
  return null;
}

describe("useCardPalette", () => {
  afterEach(() => act(() => updateUiPreferences({ cardTheme: DEFAULT_CARD_THEME, folderTint: true, devicePosters: true })));

  it("re-renders on an accent change only", () => {
    renders.length = 0;
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Probe />);
    });
    expect(renders).toEqual([DEFAULT_CARD_THEME.accent]);
    act(() => updateUiPreferences({ folderTint: false }));
    act(() => updateUiPreferences({ devicePosters: false }));
    expect(renders).toHaveLength(1);
    act(() => updateUiPreferences({ cardTheme: { id: "teal", name: "", accent: "#1DBFAE" } }));
    expect(renders).toEqual([DEFAULT_CARD_THEME.accent, "#1DBFAE"]);
    act(() => tree.unmount());
  });

  it("builds a themed stylesheet once per accent and rebuilds it when the accent moves", () => {
    const factory = jest.fn((palette: { accent: string }) => ({ fill: { backgroundColor: palette.accent } }));
    const useFill = themedStyles(factory);
    const seen: object[] = [];
    function Fill() {
      seen.push(useFill());
      return null;
    }
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <>
          <Fill />
          <Fill />
        </>,
      );
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(seen[0]).toBe(seen[1]);
    expect(StyleSheet.flatten((seen[0] as { fill: object }).fill)).toEqual({ backgroundColor: DEFAULT_CARD_THEME.accent });
    act(() => updateUiPreferences({ cardTheme: { id: "teal", name: "", accent: "#1DBFAE" } }));
    expect(factory).toHaveBeenCalledTimes(2);
    expect(StyleSheet.flatten((seen[seen.length - 1] as { fill: object }).fill)).toEqual({ backgroundColor: "#1DBFAE" });
    act(() => tree.unmount());
  });

  it("reads the chosen palette outside React", () => {
    expect(currentPalette().accent).toBe(DEFAULT_CARD_THEME.accent);
    act(() => updateUiPreferences({ cardTheme: { id: "teal", name: "", accent: "#1DBFAE" } }));
    expect(currentPalette()).toBe(cardPalette("#1DBFAE"));
  });

  it("draws the editor's override under its provider", () => {
    renders.length = 0;
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <CardPaletteOverride.Provider value={cardPalette("#FF6676")}>
          <Probe />
        </CardPaletteOverride.Provider>,
      );
    });
    expect(renders).toEqual(["#FF6676"]);
    act(() => tree.unmount());
  });
});
