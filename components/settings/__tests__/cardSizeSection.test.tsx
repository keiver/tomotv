/** The card size stepper on touch and the Mac: a slider over the sizes this window takes, highlighting the saved size. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { CardSizeSection } from "@/components/settings/CardSizeSection";
import { DurationChips } from "@/components/settings/DurationChips";
import { DurationSlider } from "@/components/settings/DurationSlider";
import { setCardZoom } from "@/services/cardZoom";
import { t } from "@/services/i18n";
import { updateUiPreferences } from "@/services/uiPreferences";

let mockCeiling = 2;
jest.mock("@/hooks/useCardZoom", () => ({ useCardZoomCeiling: () => mockCeiling }));
jest.mock("@/components/settings/DurationChips", () => ({ DurationChips: () => null }));
jest.mock("@/components/settings/DurationSlider", () => ({ DurationSlider: () => null }));
jest.mock("@/services/cardZoom", () => ({ setCardZoom: jest.fn() }));
jest.mock("@/utils/hostEnvironment", () => ({ THIS_DEVICE: "iPad" }));

/** Renders the section, hands its slider to `check`, and unmounts before the saved size is put back. */
function withSlider(check: (slider: TestRenderer.ReactTestInstance, tree: TestRenderer.ReactTestRenderer) => void) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<CardSizeSection />);
  });
  check(tree.root.findByType(DurationSlider), tree);
  act(() => tree.unmount());
  updateUiPreferences({ cardSize: 1 });
}

describe("CardSizeSection on touch and the Mac", () => {
  it("draws a slider over every size when the window takes them all, with percent labels, named Card size for VoiceOver", () => {
    mockCeiling = 2;
    withSlider((slider, tree) => {
      expect(tree.root.findAllByType(DurationChips)).toHaveLength(0);
      expect(slider.props.options).toEqual([
        { value: 0.75, label: "75%" },
        { value: 1, label: "100%" },
        { value: 1.25, label: "125%" },
        { value: 1.5, label: "150%" },
      ]);
      expect(slider.props.selected).toBe(1);
      expect(slider.props.accessibilityLabel).toBe(t("appearance.cardSize"));
    });
  });

  it("leaves out the sizes past the window's ceiling and highlights the largest one left under a bigger saved size", () => {
    mockCeiling = 1.3;
    updateUiPreferences({ cardSize: 1.5 });
    withSlider((slider) => {
      expect(slider.props.options.map((option: { value: number }) => option.value)).toEqual([0.75, 1, 1.25]);
      expect(slider.props.selected).toBe(1.25);
    });
  });

  it("highlights the step under a zoom a pinch left between steps", () => {
    mockCeiling = 2;
    updateUiPreferences({ cardSize: 1.15 });
    withSlider((slider) => expect(slider.props.selected).toBe(1));
  });

  it("picking a size saves it through setCardZoom", () => {
    mockCeiling = 2;
    withSlider((slider) => {
      act(() => slider.props.onSelect(1.25));
      expect(setCardZoom).toHaveBeenCalledWith(1.25);
    });
  });

  it("explains the setting under the slider, with the pinch on an iPad", () => {
    mockCeiling = 2;
    withSlider((_slider, tree) => {
      expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.children === t("appearance.cardSizeHintPinch"))).toHaveLength(1);
    });
  });
});
