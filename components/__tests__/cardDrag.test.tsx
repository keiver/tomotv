/** The info card's drag down to close: where the card sits for a drag, and how the scroll inside hands it over. */
import { cardOffset, CardDragScroll, CardDragView } from "@/components/card-drag";
import React from "react";
import { ScrollView, Text, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const chain: any = new Proxy(() => chain, { get: () => () => chain, apply: () => chain });
  return { Gesture: { Pan: () => chain, Native: () => chain }, GestureDetector: ({ children }: { children: React.ReactNode }) => children, GestureHandlerRootView: View };
});

function mount(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

describe("cardOffset", () => {
  it("follows the finger from where the scroll last stood off its top", () => {
    expect(cardOffset(140, 0)).toBe(140);
    expect(cardOffset(140, 60)).toBe(80);
  });

  it("never lifts the card above where it rests", () => {
    expect(cardOffset(-30, 0)).toBe(0);
    expect(cardOffset(40, 60)).toBe(0);
  });
});

describe("CardDragView", () => {
  it("lets a tap beside the card reach what is under it", () => {
    const tree = mount(
      <CardDragView onDismiss={jest.fn()}>
        <Text>card</Text>
      </CardDragView>,
    );
    const layers = tree.root.findAllByType(View).filter((node) => node.props.pointerEvents !== undefined);
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) expect(layer.props.pointerEvents).toBe("box-none");
  });
});

describe("CardDragScroll", () => {
  it("does not pull its content off the top inside a draggable card, so the drag moves the card", () => {
    const tree = mount(
      <CardDragView onDismiss={jest.fn()}>
        <CardDragScroll active>
          <Text>content</Text>
        </CardDragScroll>
      </CardDragView>,
    );
    expect(tree.root.findByType(ScrollView).props.bounces).toBe(false);
  });

  it("is a plain scroll outside a draggable card", () => {
    const tree = mount(
      <CardDragScroll active>
        <Text>content</Text>
      </CardDragScroll>,
    );
    const scroll = tree.root.findByType(ScrollView);
    expect(scroll.props.bounces).toBeUndefined();
    expect(scroll.props.onScroll).toBeUndefined();
  });
});
