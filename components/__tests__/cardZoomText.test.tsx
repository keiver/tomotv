/** The name bar and the corner notch grow and shrink with the card zoom. */
import React from "react";
import { StyleSheet } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

let mockZoom = 1;
jest.mock("@/hooks/useCardZoom", () => ({ useCardZoom: () => mockZoom, useCardZoomCeiling: () => 2 }));
jest.mock("@/components/MarqueeText", () => {
  const { Text } = require("react-native");
  return { MarqueeText: ({ children, style }: { children: React.ReactNode; style: object }) => <Text style={style}>{children}</Text> };
});
jest.mock("@/components/live-tv/live-freshness-badge", () => ({ LiveFreshnessBadge: () => null, LIVE_FRESH_MS: 15_000 }));
jest.mock("@/services/liveFrames", () => ({ LIVE_FRAME_TRANSITION_MS: 0, LIVE_FRAME_REFRESH_MS: 120_000, subscribeLiveFrame: () => () => undefined }));

import { CardCornerNotch, notchMetrics } from "@/components/card-corner-notch";
import { CardStand, STAND_NAME_TEXT } from "@/components/card-stand";
import { STAND_HEIGHT } from "@/constants/app";

function render(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

const textStyle = (tree: TestRenderer.ReactTestRenderer, label: string) => StyleSheet.flatten(tree.root.findAll((n) => typeof n.type === "string" && n.props.children === label)[0].props.style);

describe("card zoom on the name bar and the notch", () => {
  afterEach(() => {
    mockZoom = 1;
  });

  it.each([0.75, 1, 1.5])("the name bar's height and lettering follow a zoom of %s", (zoom) => {
    mockZoom = zoom;
    const tree = render(<CardStand name="Pilot" focused={false} scrolls />);
    expect(StyleSheet.flatten(tree.root.findByProps({ testID: "card-stand" }).props.style).height).toBe(STAND_HEIGHT * zoom);
    expect(textStyle(tree, "Pilot")).toMatchObject({ fontSize: STAND_NAME_TEXT.fontSize * zoom, letterSpacing: STAND_NAME_TEXT.letterSpacing * zoom });
    act(() => tree.unmount());
  });

  it.each([0.75, 1, 1.5])("the notch's height and lettering follow a zoom of %s", (zoom) => {
    mockZoom = zoom;
    const tree = render(<CardCornerNotch segments={[{ label: "S01E05" }]} />);
    expect(StyleSheet.flatten(tree.root.findByProps({ testID: "card-corner-notch-body" }).props.style).height).toBe(STAND_HEIGHT * zoom);
    expect(textStyle(tree, "S01E05").fontSize).toBe(STAND_NAME_TEXT.fontSize * zoom);
    act(() => tree.unmount());
  });

  it("scales the notch's curves with the card, so a ring still covers its square's corner", () => {
    for (const zoom of [0.75, 1, 1.5]) {
      const { fillet, ring } = notchMetrics(zoom, false);
      expect(ring.width).toBe(fillet.width * 4);
      expect(ring.borderWidth).toBe(fillet.width);
      expect(ring.top).toBe(-fillet.width);
    }
  });
});
