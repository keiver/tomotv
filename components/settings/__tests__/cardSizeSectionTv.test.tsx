/** The card size stepper on TV: a row of pills over every size, whatever the window. */
import React from "react";
import { Platform } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import { DurationChips } from "@/components/settings/DurationChips";
import { DurationSlider } from "@/components/settings/DurationSlider";
import { setCardZoom } from "@/services/cardZoom";
import { t } from "@/services/i18n";
import { updateUiPreferences } from "@/services/uiPreferences";

jest.mock("@/hooks/useCardZoom", () => ({ useCardZoomCeiling: () => 1 }));
jest.mock("@/components/settings/DurationChips", () => ({ DurationChips: () => null }));
jest.mock("@/components/settings/DurationSlider", () => ({ DurationSlider: () => null }));
jest.mock("@/services/cardZoom", () => ({ setCardZoom: jest.fn() }));
jest.mock("@/utils/hostEnvironment", () => ({ THIS_DEVICE: "Apple TV" }));

Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
// Read after the flag: the section fixes its platform at import.
const { CardSizeSection } = require("@/components/settings/CardSizeSection") as typeof import("@/components/settings/CardSizeSection");

describe("CardSizeSection on TV", () => {
  it("draws pills over every size, the saved one selected, explains the setting, and saves a pick through setCardZoom", () => {
    updateUiPreferences({ cardSize: 1.5 });
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<CardSizeSection />);
    });
    expect(tree.root.findAllByType(DurationSlider)).toHaveLength(0);
    const chips = tree.root.findByType(DurationChips);
    expect(chips.props.options.map((option: { value: number; label: string }) => option.label)).toEqual(["75%", "100%", "125%", "150%"]);
    expect(chips.props.selected).toBe(1.5);
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.children === t("appearance.cardSizeHint"))).toHaveLength(1);
    act(() => chips.props.onSelect(0.75));
    expect(setCardZoom).toHaveBeenCalledWith(0.75);
    act(() => tree.unmount());
    updateUiPreferences({ cardSize: 1 });
  });
});
