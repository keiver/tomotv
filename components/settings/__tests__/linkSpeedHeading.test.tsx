/** The server glyph stays mounted in every state: a focusable's children never come and go, only its opacity does. */
import { SERVER_GLYPH } from "@/components/settings/ServerRow";
import { LinkSpeedHeading } from "@/components/settings/LinkSpeedHeading";
import React from "react";
import { StyleSheet } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const glyph = (tree: TestRenderer.ReactTestRenderer) => tree.root.find((node) => node.props.name === SERVER_GLYPH);

describe("LinkSpeedHeading", () => {
  it("keeps the glyph mounted while measuring, hidden by opacity", () => {
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(<LinkSpeedHeading measuredBps={50_000_000} measuring={false} onRemeasure={() => {}} />);
    });
    expect(StyleSheet.flatten(glyph(tree!).props.style)?.opacity).not.toBe(0);

    act(() => {
      tree!.update(<LinkSpeedHeading measuredBps={50_000_000} measuring onRemeasure={() => {}} />);
    });
    expect(StyleSheet.flatten(glyph(tree!).props.style)?.opacity).toBe(0);
  });

  it("keeps the glyph mounted with no reading", () => {
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(<LinkSpeedHeading measuredBps={null} measuring={false} onRemeasure={() => {}} />);
    });
    expect(StyleSheet.flatten(glyph(tree!).props.style)?.opacity).toBe(0);
  });
});
