/** ShelfHeading: the pending spinner shows only while more cards are due. */
import { ShelfHeading } from "@/components/media-shelf";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

test("the heading spins while more cards are due and stops when they land", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<ShelfHeading title="Live TV" pending />);
  });
  expect(tree.root.findAllByProps({ testID: "shelf-spinner" }).length).toBeGreaterThan(0);

  act(() => {
    tree.update(<ShelfHeading title="Live TV" />);
  });
  expect(tree.root.findAllByProps({ testID: "shelf-spinner" })).toHaveLength(0);
  tree.unmount();
});
