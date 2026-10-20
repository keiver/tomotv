import React from "react";
import { StyleSheet } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

import { CardNavProgress } from "@/components/card-nav-progress";
import { COLORS } from "@/constants/colors";

function barColour(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element);
  });
  const bar = tree.root.findAll((n) => typeof n.type === "string" && n.props.pointerEvents === "none")[0];
  const colour = StyleSheet.flatten(bar.props.style).backgroundColor;
  act(() => tree.unmount());
  return colour;
}

describe("press sweep base", () => {
  it("keeps the wall stand's dark base", () => {
    expect(barColour(<CardNavProgress active title="Channel One" stand />)).toBe(COLORS.BACKGROUND_DEEP);
  });

  it("matches a media card's own colour, which shows through its clear base", () => {
    expect(barColour(<CardNavProgress active title="A Movie" stand baseColor={COLORS.SURFACE} />)).toBe(COLORS.SURFACE);
  });
});
