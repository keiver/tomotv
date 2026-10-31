/** The card size control on touch and the Mac: miniature cards at every size the window takes, the drawn size chosen. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { CardSizePicker } from "@/components/settings/CardSizePicker";
import { CardSizeSection } from "@/components/settings/CardSizeSection";
import { DurationChips } from "@/components/settings/DurationChips";
import { setCardZoom } from "@/services/cardZoom";
import { t } from "@/services/i18n";

let mockCeiling = 2;
let mockZoom = 1;
jest.mock("@/hooks/useCardZoom", () => ({ useCardZoomCeiling: () => mockCeiling, useCardZoom: () => mockZoom }));
jest.mock("@/components/settings/DurationChips", () => ({ DurationChips: () => null }));
jest.mock("@/components/settings/CardSizePicker", () => ({ CardSizePicker: () => null }));
jest.mock("@/services/cardZoom", () => ({ setCardZoom: jest.fn() }));
jest.mock("@/utils/hostEnvironment", () => ({ THIS_DEVICE: "iPad" }));

function withPicker(check: (picker: TestRenderer.ReactTestInstance, tree: TestRenderer.ReactTestRenderer) => void) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<CardSizeSection />);
  });
  check(tree.root.findByType(CardSizePicker), tree);
  act(() => tree.unmount());
}

describe("CardSizeSection on touch and the Mac", () => {
  it("offers every pick a wide window takes, with percent labels, the drawn zoom's nearest pick chosen", () => {
    mockCeiling = 2;
    mockZoom = 1.1;
    withPicker((picker, tree) => {
      expect(tree.root.findAllByType(DurationChips)).toHaveLength(0);
      expect(picker.props.sizes).toEqual([0.75, 0.85, 1, 1.15, 1.3, 1.5]);
      expect(picker.props.selected).toBe(1.15);
      expect(picker.props.format(1.15)).toBe("115%");
    });
  });

  it("stops at the window's ceiling: an iPhone in portrait offers 75% to 115%", () => {
    mockCeiling = 1.16;
    mockZoom = 1;
    withPicker((picker) => {
      expect(picker.props.sizes).toEqual([0.75, 0.85, 1, 1.15]);
      expect(picker.props.selected).toBe(1);
    });
  });

  it("saves a pick through setCardZoom", () => {
    mockCeiling = 2;
    withPicker((picker) => {
      act(() => picker.props.onSelect(1.3));
      expect(setCardZoom).toHaveBeenCalledWith(1.3);
    });
  });

  it("explains the setting under the picker, with the pinch on an iPad", () => {
    withPicker((_picker, tree) => {
      expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.children === t("appearance.cardSizeHintPinch"))).toHaveLength(1);
    });
  });
});
