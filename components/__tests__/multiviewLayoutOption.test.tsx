/** One layout in the picker, drawn as Multiview would fit it on this screen and turned: a box per spot, the sound spot boxed in the accent with the Live TV card's edge, the group's other channels dimmer after them, a focus ring that takes no space. */
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#FFC312" }) }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: (props: object) => require("react").createElement("Ionicons", props) }));
jest.mock("@keiver/tomo-live", () => jest.requireActual("@keiver/tomo-live/src/multiviewLayout"));

import { MultiviewLayoutOption } from "@/components/live-tv/multiview-layout-option";
import { RAISED_EDGE } from "@/constants/app";
import type { MultiviewLayoutName } from "@keiver/tomo-live";

function render(layout: MultiviewLayoutName, stage = { width: 1920, height: 1080 }, current = false) {
  const onPress = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<MultiviewLayoutOption layout={layout} width={480} stage={stage} current={current} onPress={onPress} />);
  });
  const shapes = tree.root.findAll((node) => node.type === View && node.props.testID === "multiview-layout-shape");
  const boxes = (testID: string, shape = 0) => shapes[shape].findAll((node) => node.type === View && node.props.testID === testID).map((node) => StyleSheet.flatten(node.props.style));
  return { tree, onPress, shapes, spots: boxes("multiview-layout-spot"), rest: boxes("multiview-layout-rest"), turned: () => boxes("multiview-layout-spot", 1) };
}

describe("MultiviewLayoutOption", () => {
  it("draws a box for every spot with the Live TV card's edge, and the group's other channels in the strip row", () => {
    const { shapes, spots, rest } = render("rowThree");
    const height = StyleSheet.flatten(shapes[0].props.style).height as number;
    expect(spots).toHaveLength(6);
    expect(spots.every((style) => style.boxShadow === RAISED_EDGE)).toBe(true);
    expect(rest).toHaveLength(3);
    expect(rest.every((style) => (style.top as number) >= (height * 2) / 3 - 1)).toBe(true);
  });

  it("draws no other channels for a layout with no strip row on a 16:9 screen", () => {
    expect(render("halvesThree").rest).toHaveLength(0);
  });

  it("held upright draws the tall cut, the big spot the full width, and the screen turned below it at the same width", () => {
    const { shapes, spots, turned } = render("bigThree", { width: 393, height: 700 });
    const [upright, wide] = shapes.map((shape) => StyleSheet.flatten(shape.props.style) as { width: number; height: number });
    expect([upright.width, wide.width]).toEqual([480, 480]);
    expect(upright.height).toBeCloseTo((480 * 700) / 393, 5);
    expect(wide.height).toBeCloseTo((480 * 393) / 700, 5);
    expect(spots[0]).toMatchObject({ left: 0, top: 0, width: 480 });
    expect(turned()[0].width).toBeLessThan(480);
  });

  it("turned draws the wide cut and the screen held upright beside it, the same height, filling the width", () => {
    const { shapes } = render("bigThree", { width: 734, height: 340 });
    const [wide, upright] = shapes.map((shape) => StyleSheet.flatten(shape.props.style) as { width: number; height: number });
    expect(wide.height).toBeCloseTo(upright.height, 5);
    expect(wide.width / wide.height).toBeCloseTo(734 / 340, 5);
    expect(wide.width + upright.width + 8).toBeCloseTo(480, 5);
  });

  it("boxes the spot with the sound in the accent, in both shapes", () => {
    const { spots, turned } = render("grid4");
    expect(spots.map((style) => style.borderColor)).toEqual(["#FFC312", undefined, undefined, undefined]);
    expect(turned()[0].borderColor).toBe("#FFC312");
  });

  it("names its layout, marks the current one, rings focus without changing its size, and reports a press", () => {
    const { tree, onPress } = render("grid4", undefined, true);
    expect(tree.root.findAllByType(Text).map((node) => node.props.children)).toEqual(["liveTv.layoutGrid4"]);
    expect(tree.root.findAll((node) => (node.type as unknown) === "Ionicons" && node.props.name === "checkmark-circle")).toHaveLength(1);
    const touch = tree.root.findByType(TouchableOpacity);
    const before = StyleSheet.flatten(touch.props.style);
    act(() => touch.props.onFocus());
    expect(StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style)).toEqual(before);
    expect(tree.root.findAll((node) => node.type === View && StyleSheet.flatten(node.props.style)?.borderColor === "#FFC312" && StyleSheet.flatten(node.props.style)?.bottom === 0)).toHaveLength(1);
    act(() => touch.props.onPress());
    expect(onPress).toHaveBeenCalledWith("grid4");
  });
});
