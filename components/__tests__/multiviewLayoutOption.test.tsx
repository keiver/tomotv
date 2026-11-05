/** One layout in the picker, drawn as Multiview would fit it on this screen as held: a rounded outline with a line round every spot and the group's other channels, in the accent with a checkmark when current and grey otherwise, an accent ring on focus that takes no space. */
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#FFC312" }) }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: (props: object) => require("react").createElement("Ionicons", props) }));
jest.mock("@keiver/tomo-live", () => jest.requireActual("@keiver/tomo-live/src/multiviewLayout"));

import { MULTIVIEW_LAYOUT_INSET, MultiviewLayoutOption } from "@/components/live-tv/multiview-layout-option";
import { COLORS } from "@/constants/colors";
import type { MultiviewLayoutName } from "@keiver/tomo-live";

const INNER = 480;
const OUTER = INNER + MULTIVIEW_LAYOUT_INSET * 2;

function render(layout: MultiviewLayoutName, stage = { width: 1920, height: 1080 }, current = false) {
  const onPress = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<MultiviewLayoutOption layout={layout} width={OUTER} stage={stage} current={current} onPress={onPress} />);
  });
  const shapes = tree.root.findAll((node) => node.type === View && node.props.testID === "multiview-layout-shape");
  const boxes = (testID: string, shape = 0) => shapes[shape].findAll((node) => node.type === View && node.props.testID === testID).map((node) => StyleSheet.flatten(node.props.style));
  return { tree, onPress, shapes, spots: boxes("multiview-layout-spot"), rest: boxes("multiview-layout-rest") };
}
const rings = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll((node) => node.type === View && StyleSheet.flatten(node.props.style)?.borderColor === "#FFC312" && StyleSheet.flatten(node.props.style)?.bottom === 0);

describe("MultiviewLayoutOption", () => {
  it("draws a two point grey line round every spot and the group's other channels in the strip row, with no fill", () => {
    const { shapes, spots, rest } = render("rowThree");
    const height = StyleSheet.flatten(shapes[0].props.style).height as number;
    expect(spots).toHaveLength(6);
    expect(rest).toHaveLength(3);
    expect([...spots, ...rest].map((style) => [style.borderColor, style.borderWidth, style.backgroundColor, style.opacity])).toEqual(
      Array.from({ length: 9 }, () => [COLORS.SURFACE_MUTED, 2, undefined, undefined]),
    );
    expect(rest.every((style) => (style.top as number) >= (height * 2) / 3 - 2)).toBe(true);
  });

  it("draws no other channels for a layout with no strip row on a 16:9 screen", () => {
    expect(render("halvesThree").rest).toHaveLength(0);
  });

  it("held upright draws only the tall cut, the big spot the full width", () => {
    const { shapes, spots } = render("bigThree", { width: 393, height: 700 });
    expect(shapes).toHaveLength(1);
    const upright = StyleSheet.flatten(shapes[0].props.style) as { width: number; height: number };
    expect(upright.width).toBe(INNER);
    expect(upright.height).toBeCloseTo((INNER * 700) / 393, 5);
    expect(spots[0]).toMatchObject({ left: 0, top: 0, width: INNER });
  });

  it("turned draws only the wide cut, the full width", () => {
    const { shapes } = render("bigThree", { width: 734, height: 340 });
    expect(shapes).toHaveLength(1);
    const wide = StyleSheet.flatten(shapes[0].props.style) as { width: number; height: number };
    expect(wide.width).toBe(INNER);
    expect(wide.width / wide.height).toBeCloseTo(734 / 340, 5);
  });

  it("draws no line closer to the outline than 8 points, upright or turned", () => {
    const layouts: MultiviewLayoutName[] = ["bigThree", "bigTwo", "grid4", "rowThree", "halvesTwo", "halvesThree"];
    for (const stage of [
      { width: 393, height: 852 },
      { width: 852, height: 393 },
    ]) {
      for (const layout of layouts) {
        const { shapes, spots, rest } = render(layout, stage);
        const screen = StyleSheet.flatten(shapes[0].props.style) as { width: number; height: number };
        for (const style of [...spots, ...rest]) {
          const left = style.left as number;
          const top = style.top as number;
          const right = left + (style.width as number);
          const bottom = top + (style.height as number);
          for (const edge of [left, screen.width - right]) expect(edge === 0 || edge < 0 || edge >= 8).toBe(true);
          for (const edge of [top, screen.height - bottom]) expect(edge === 0 || edge < 0 || edge >= 8).toBe(true);
          expect(top).toBeLessThanOrEqual(screen.height - 8);
        }
      }
    }
  });

  it("draws every line and the outline in the accent when current", () => {
    const { tree, spots } = render("grid4", undefined, true);
    expect(spots.every((style) => style.borderColor === "#FFC312")).toBe(true);
    expect(StyleSheet.flatten(tree.root.find((node) => node.type === View && node.props.testID === "multiview-layout-outline").props.style).borderColor).toBe("#FFC312");
  });

  it("has no background, its drawing inset from the edge inside a rounded two point accent outline the size of the screen", () => {
    const { tree, shapes } = render("grid4", undefined, true);
    const option = StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style);
    expect(option).toMatchObject({ width: OUTER, padding: MULTIVIEW_LAYOUT_INSET });
    expect(option.backgroundColor).toBeUndefined();
    const screen = StyleSheet.flatten(shapes[0].props.style);
    expect(screen.backgroundColor).toBeUndefined();
    const outline = StyleSheet.flatten(tree.root.find((node) => node.type === View && node.props.testID === "multiview-layout-outline").props.style);
    expect(outline).toMatchObject({ width: screen.width, height: screen.height, borderWidth: 2, borderColor: "#FFC312", borderRadius: screen.borderRadius, borderCurve: "continuous" });
    expect(outline.borderRadius).toBeGreaterThan(0);
  });

  it("shares one line between neighbouring spots and meets the outline at the edges", () => {
    const { shapes, spots } = render("grid4", { width: 393, height: 700 });
    const screen = StyleSheet.flatten(shapes[0].props.style) as { width: number };
    expect(spots[0]).toMatchObject({ left: 0, top: 0 });
    expect(spots[1].left).toBeCloseTo((spots[0].left as number) + (spots[0].width as number) - 2, 5);
    expect((spots[1].left as number) + (spots[1].width as number)).toBeCloseTo(screen.width, 5);
  });

  it("on Apple TV marks the spot with the sound with its speaker and the current layout with a checkmark, with no ring", () => {
    jest.isolateModules(() => {
      const RN = require("react-native");
      jest.spyOn(RN.Platform, "isTV", "get").mockReturnValue(true);
      const R = require("react");
      const Renderer = require("react-test-renderer");
      const { MultiviewLayoutOption: TvOption } = require("@/components/live-tv/multiview-layout-option");
      let tree!: TestRenderer.ReactTestRenderer;
      Renderer.act(() => {
        tree = Renderer.create(R.createElement(TvOption, { layout: "grid4", width: 480, stage: { width: 1920, height: 1080 }, current: true, onPress: () => {} }));
      });
      expect(tree.root.findAll((node: TestRenderer.ReactTestInstance) => (node.type as unknown) === "Ionicons" && node.props.name === "checkmark-circle")).toHaveLength(1);
      expect(
        tree.root.findAll(
          (node: TestRenderer.ReactTestInstance) =>
            typeof node.type === "string" && RN.StyleSheet.flatten(node.props.style)?.bottom === 0 && RN.StyleSheet.flatten(node.props.style)?.borderColor === "#FFC312",
        ),
      ).toHaveLength(0);
      const spots = tree.root.findAll((node: TestRenderer.ReactTestInstance) => node.props.testID === "multiview-layout-spot" && typeof node.type === "string");
      expect(spots).toHaveLength(4);
      expect(tree.root.findAll((node: TestRenderer.ReactTestInstance) => node.props.testID === "multiview-layout-sound" && (node.type as unknown) === "Ionicons")).toHaveLength(1);
    });
  });

  it("on Apple TV draws a focused layout in the accent with a plain checkmark under it and no ring", () => {
    jest.isolateModules(() => {
      const RN = require("react-native");
      jest.spyOn(RN.Platform, "isTV", "get").mockReturnValue(true);
      const R = require("react");
      const Renderer = require("react-test-renderer");
      const { MultiviewLayoutOption: TvOption } = require("@/components/live-tv/multiview-layout-option");
      let tree!: TestRenderer.ReactTestRenderer;
      Renderer.act(() => {
        tree = Renderer.create(R.createElement(TvOption, { layout: "grid4", width: 480, stage: { width: 1920, height: 1080 }, current: false, onPress: () => {} }));
      });
      const icons = (name: string) => tree.root.findAll((node: TestRenderer.ReactTestInstance) => (node.type as unknown) === "Ionicons" && node.props.name === name);
      expect(icons("checkmark")).toHaveLength(0);
      Renderer.act(() => tree.root.findByType(RN.TouchableOpacity).props.onFocus());
      expect(icons("checkmark").map((node: TestRenderer.ReactTestInstance) => node.props.color)).toEqual(["#FFC312"]);
      expect(icons("checkmark-circle")).toHaveLength(0);
      const spots = tree.root.findAll((node: TestRenderer.ReactTestInstance) => node.props.testID === "multiview-layout-spot" && typeof node.type === "string");
      expect(spots.every((node: TestRenderer.ReactTestInstance) => RN.StyleSheet.flatten(node.props.style).borderColor === "#FFC312")).toBe(true);
      expect(
        tree.root.findAll(
          (node: TestRenderer.ReactTestInstance) =>
            typeof node.type === "string" && RN.StyleSheet.flatten(node.props.style)?.bottom === 0 && RN.StyleSheet.flatten(node.props.style)?.borderColor === "#FFC312",
        ),
      ).toHaveLength(0);
    });
  });

  it("shows no name and no orientation icon, and names its layout to accessibility", () => {
    const { tree } = render("grid4");
    expect(tree.root.findAllByType(Text)).toHaveLength(0);
    expect(tree.root.findAll((node) => (node.type as unknown) === "Ionicons")).toHaveLength(0);
    expect(tree.root.findByType(TouchableOpacity).props.accessibilityLabel).toBe("liveTv.layoutGrid4");
  });

  it("marks the current layout with an accent checkmark and no ring, the others with neither, and reports a press", () => {
    const checks = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => (node.type as unknown) === "Ionicons" && node.props.name === "checkmark-circle");
    const other = render("grid4", undefined, false).tree;
    expect(checks(other)).toHaveLength(0);
    expect(rings(other)).toHaveLength(0);
    const { tree, onPress } = render("grid4", undefined, true);
    expect(checks(tree).map((node) => node.props.color)).toEqual(["#FFC312"]);
    expect(rings(tree)).toHaveLength(0);
    expect(tree.root.findByType(TouchableOpacity).props.accessibilityState).toEqual({ selected: true });
    act(() => tree.root.findByType(TouchableOpacity).props.onPress());
    expect(onPress).toHaveBeenCalledWith("grid4");
  });

  it("rings focus without changing its size", () => {
    const { tree } = render("grid4");
    const touch = tree.root.findByType(TouchableOpacity);
    const before = StyleSheet.flatten(touch.props.style);
    act(() => touch.props.onFocus());
    expect(StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style)).toEqual(before);
    expect(rings(tree)).toHaveLength(1);
    expect(StyleSheet.flatten(rings(tree)[0].props.style).borderWidth).toBeGreaterThan(1);
  });
});
