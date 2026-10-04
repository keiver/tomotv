/**
 * A focusable whose content comes and goes holds it in a wrapper Fabric keeps: flattened into the
 * focusable, an optional child renumbers its siblings and the unmount aborts (RCTViewComponentView).
 */
import { FilterChip } from "@/components/filter-chip";
import { FocusableButton } from "@/components/FocusableButton";
import { GuideGroupCell } from "@/components/live-tv/guide-group-cell";
import React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";

function render(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

/** The View closest above a node. */
function wrapperOf(node: ReactTestInstance): ReactTestInstance {
  let parent = node.parent;
  while (parent && parent.type !== View) parent = parent.parent;
  return parent!;
}

const checkmark = (tree: TestRenderer.ReactTestRenderer) => tree.root.find((node) => node.props.name === "checkmark");

describe("focusables with optional content", () => {
  it("the filter chip's checkmark sits in a kept wrapper", () => {
    expect(wrapperOf(checkmark(render(<FilterChip label="Drama" selected onToggle={() => {}} />))).props.collapsable).toBe(false);
  });

  it("the guide group cell's checkmark sits in a kept wrapper", () => {
    expect(wrapperOf(checkmark(render(<GuideGroupCell label="News" selected onPress={() => {}} />))).props.collapsable).toBe(false);
  });

  it("the button's spinner and its title share one kept wrapper", () => {
    const loading = render(<FocusableButton title="Play" isLoading onPress={() => {}} />);
    expect(wrapperOf(loading.root.findByType(ActivityIndicator)).props.collapsable).toBe(false);
    const idle = render(<FocusableButton title="Play" onPress={() => {}} />);
    expect(wrapperOf(idle.root.findAllByType(Text)[0]).props.collapsable).toBe(false);
  });
});
