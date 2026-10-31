/** A pinch scales the cards on the UI thread while the fingers move, writes the zoom once on release, and draws them at scale 1 at rest. */
import React from "react";
import { StyleSheet, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

type Handler = (e?: { scale: number }) => void;
const mockHandlers: Record<string, Handler> = {};
jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const chain: Record<string, (f: Handler) => unknown> = {};
  for (const name of ["onStart", "onUpdate", "onFinalize"]) {
    chain[name] = (f) => {
      mockHandlers[name] = f;
      return chain;
    };
  }
  return { Gesture: { Pinch: () => chain }, GestureDetector: ({ children }: { children: React.ReactNode }) => children, GestureHandlerRootView: View };
});

let mockZoom = 1;
const mockCeiling = 1.6;
jest.mock("@/hooks/useCardZoom", () => ({ useCardZoom: () => mockZoom, useCardZoomCeiling: () => mockCeiling }));
const mockUpdate = jest.fn();
jest.mock("@/services/cardZoom", () => ({ setCardZoom: (zoom: number) => mockUpdate(zoom) }));

import { CardZoomPinch } from "@/components/card-zoom-pinch";

const cards = (
  <CardZoomPinch>
    <Text>cards</Text>
  </CardZoomPinch>
);

function mount() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(cards);
  });
  return tree;
}

const surfaceStyle = (tree: TestRenderer.ReactTestRenderer) => StyleSheet.flatten(tree.root.findAll((n) => n.props.testID === "card-zoom-surface" && typeof n.type === "string")[0].props.style);
const surfaceScale = (tree: TestRenderer.ReactTestRenderer) => (surfaceStyle(tree).transform as { scale: number }[])[0].scale;

function pinch(scale: number) {
  act(() => {
    mockHandlers.onStart();
    mockHandlers.onUpdate({ scale });
    mockHandlers.onFinalize();
  });
}

describe("CardZoomPinch", () => {
  beforeEach(() => {
    mockZoom = 1;
    mockUpdate.mockClear();
  });

  it("wraps the cards in the pinch surface, scaled from the top-left corner and at exactly 1 at rest, at any zoom", () => {
    mockZoom = 1.25;
    const tree = mount();
    expect(tree.root.findAllByType(Text)).toHaveLength(1);
    expect(surfaceStyle(tree).transformOrigin).toBe("0 0");
    expect(surfaceScale(tree)).toBe(1);
    act(() => tree.unmount());
  });

  it("writes the zoom the fingers reached once, when they lift", () => {
    const tree = mount();
    pinch(1.32);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toBeCloseTo(1.3, 10);
    act(() => tree.unmount());
  });

  it("draws the cards at scale 1 again once the layout is at the new zoom", () => {
    const tree = mount();
    act(() => {
      mockHandlers.onStart();
      mockHandlers.onUpdate({ scale: 1.3 });
    });
    mockZoom = 1.3;
    act(() => {
      mockHandlers.onFinalize();
      tree.update(cards);
    });
    act(() => tree.update(cards));
    expect(Math.abs(surfaceScale(tree) - 1)).toBeLessThan(1e-9);
    act(() => tree.unmount());
  });

  it("stops at the ceiling and the floor", () => {
    const tree = mount();
    pinch(3);
    expect(mockUpdate).toHaveBeenLastCalledWith(mockCeiling);
    pinch(0.2);
    expect(mockUpdate).toHaveBeenLastCalledWith(0.75);
    act(() => tree.unmount());
  });

  it("writes nothing for a pinch that lands back on the same step", () => {
    const tree = mount();
    pinch(1.01);
    expect(mockUpdate).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
