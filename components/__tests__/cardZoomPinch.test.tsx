/** A pinch scales the cards while the fingers move, writes the zoom once on release, and leaves no transform on the cards at rest. */
import React from "react";
import { StyleSheet, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

type Handler = (e?: { scale: number }) => void;
const mockHandlers: Record<string, Handler> = {};
jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const chain: Record<string, (f: Handler | boolean) => unknown> = {};
  chain.runOnJS = () => chain;
  for (const name of ["onStart", "onUpdate", "onFinalize"]) {
    chain[name] = (f) => {
      mockHandlers[name] = f as Handler;
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
let mockDevice = "iPad";
jest.mock("@/utils/hostEnvironment", () => ({
  __esModule: true,
  get THIS_DEVICE() {
    return mockDevice;
  },
}));

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
    mockDevice = "iPad";
    mockUpdate.mockClear();
  });

  it("gives iPhone no pinch: the cards render alone", () => {
    mockDevice = "iPhone";
    const tree = mount();
    expect(tree.root.findAll((n) => n.props.testID === "card-zoom-surface")).toHaveLength(0);
    expect(tree.root.findAllByType(Text)).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("draws the cards with no transform at rest, at any zoom", () => {
    mockZoom = 1.25;
    const tree = mount();
    expect(surfaceStyle(tree).transform).toBeUndefined();
    act(() => tree.unmount());
  });

  it("scales the cards from the top-left corner with the fingers", () => {
    const tree = mount();
    act(() => {
      mockHandlers.onStart();
      mockHandlers.onUpdate({ scale: 1.3 });
    });
    expect(surfaceStyle(tree)).toMatchObject({ transformOrigin: "0 0", transform: [{ scale: 1.3 }] });
    act(() => tree.unmount());
  });

  it("writes the zoom the fingers reached once, when they lift", () => {
    const tree = mount();
    pinch(1.32);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0]).toBeCloseTo(1.3, 10);
    act(() => tree.unmount());
  });

  it("keeps the cards' size on screen in the commit that lays them out at the new zoom", () => {
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
    const transform = surfaceStyle(tree).transform as { scale: number }[] | undefined;
    expect(transform === undefined || Math.abs(transform[0].scale - 1) < 1e-9).toBe(true);
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
