/** The card size picker: one miniature card per size, scaled with it, the chosen one ringed; a tap picks. */
import React from "react";
import { StyleSheet } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import { CardSizePicker, previewMetrics } from "@/components/settings/CardSizePicker";

describe("CardSizePicker", () => {
  it("scales the miniature card, its corners and its stand with the size", () => {
    const small = previewMetrics(0.75);
    const own = previewMetrics(1);
    const large = previewMetrics(1.5);
    expect(own).toEqual({ width: 32, height: 48, borderRadius: 7, standHeight: 9 });
    expect(large.width).toBe(2 * small.width);
    expect(large.height).toBe(2 * small.height);
    expect(large.borderRadius).toBeCloseTo(2 * small.borderRadius, 10);
  });

  it("draws one option per size, marks the chosen one, and hands a tap's size to onSelect", () => {
    const onSelect = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<CardSizePicker sizes={[0.75, 1, 1.3]} selected={1} format={(size) => `${Math.round(size * 100)}%`} onSelect={onSelect} />);
    });
    const options = tree.root.findAll((node) => typeof node.props.testID === "string" && node.props.testID.startsWith("card-size-") && typeof node.props.onPress === "function");
    expect(options.map((node) => node.props.accessibilityLabel)).toEqual(["75%", "100%", "130%"]);
    expect(options.map((node) => node.props.accessibilityState.selected)).toEqual([false, true, false]);
    for (const [index, size] of [0.75, 1, 1.3].entries()) {
      const { width, height } = previewMetrics(size);
      expect(
        options[index].findAll((node) => typeof node.type === "string" && StyleSheet.flatten(node.props.style)?.width === width && StyleSheet.flatten(node.props.style)?.height === height),
      ).toHaveLength(1);
    }
    act(() => options[2].props.onPress());
    expect(onSelect).toHaveBeenCalledWith(1.3);
    act(() => tree.unmount());
  });
});
