/**
 * The stack a cover-less folder card wears: one layer per video, the front one on the left,
 * each one behind peeking a step further right, shorter and dimmed, and a single video filling
 * the slot with no stack.
 */
import { PosterStack, STACK_STEP } from "@/components/poster-stack";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { Image } from "expo-image";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { StyleSheet } from "react-native";

jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("@/hooks/useItemPoster", () => ({
  useItemPoster: (item: { Id: string; ImageTags?: { Primary?: string } }) => (item.ImageTags?.Primary ? { uri: `https://jf/${item.Id}`, cacheKey: item.Id } : undefined),
}));

const video = (id: string, postered = true) => ({ Id: id, Type: "Movie", ImageTags: postered ? { Primary: "t" } : undefined }) as JellyfinVideoItem;

function render(items: JellyfinVideoItem[]) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<PosterStack items={items} height={200} />);
  });
  return tree;
}

function layer(tree: TestRenderer.ReactTestRenderer, behind: number) {
  return tree.root.findByProps({ testID: `poster-stack-layer-${behind}` });
}

describe("PosterStack", () => {
  it("lays three videos front to back, each one behind a step further right and shorter", () => {
    const tree = render([video("a"), video("b"), video("c")]);

    expect(StyleSheet.flatten(layer(tree, 0).props.style)).toMatchObject({ right: 2 * STACK_STEP, top: "0%", bottom: "0%" });
    expect(StyleSheet.flatten(layer(tree, 1).props.style)).toMatchObject({ right: STACK_STEP, top: "7%", bottom: "7%" });
    expect(StyleSheet.flatten(layer(tree, 2).props.style)).toMatchObject({ right: 0, top: "14%", bottom: "14%" });
    expect(tree.root.findAllByType(Image)).toHaveLength(3);
  });

  it("dims the layers behind the front one, deeper further back", () => {
    const tree = render([video("a"), video("b"), video("c")]);
    const dims = tree.root.findAll((node) => node.props.style && StyleSheet.flatten(node.props.style).backgroundColor === "#000", { deep: false });

    expect(dims.map((node) => StyleSheet.flatten(node.props.style).opacity)).toEqual([0.56, 0.28]);
    expect(layer(tree, 0).findAll((node) => node.props.style && StyleSheet.flatten(node.props.style).backgroundColor === "#000", { deep: false })).toHaveLength(0);
  });

  it("fills the slot with one frame and no stack for a single video", () => {
    const tree = render([video("a")]);

    expect(StyleSheet.flatten(layer(tree, 0).props.style)).toMatchObject({ right: 0, top: "0%", bottom: "0%" });
    expect(tree.root.findAll((node) => typeof node.props.testID === "string" && node.props.testID.startsWith("poster-stack-layer"), { deep: false })).toHaveLength(1);
  });

  it("keeps a layer's fill, and draws no picture, until its frame lands", () => {
    const tree = render([video("a", false), video("b")]);

    expect(tree.root.findAllByType(Image)).toHaveLength(1);
    expect(layer(tree, 0)).toBeTruthy();
  });
});
