/**
 * The collage a cover-less folder card wears: the first video across the top, the rest side
 * by side across the bottom, and a single video filling the card alone.
 */
import { COLLAGE_GAP, PosterCollage } from "@/components/poster-collage";
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
    tree = TestRenderer.create(<PosterCollage items={items} height={200} />);
  });
  return tree;
}

function cells(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll((node) => node.props.testID === "poster-collage-cell", { deep: false });
}

function bottomRow(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll((node) => StyleSheet.flatten(node.props.style)?.flexDirection === "row", { deep: false });
}

describe("PosterCollage", () => {
  it("puts the first video across the top and the other two side by side below", () => {
    const tree = render([video("a"), video("b"), video("c")]);

    expect(cells(tree)).toHaveLength(3);
    const row = bottomRow(tree);
    expect(row).toHaveLength(1);
    expect(StyleSheet.flatten(row[0].props.style)).toMatchObject({ flex: 1, flexDirection: "row", gap: COLLAGE_GAP });
    expect(row[0].findAll((node) => node.props.testID === "poster-collage-cell", { deep: false })).toHaveLength(2);
    expect(tree.root.findAllByType(Image)).toHaveLength(3);
  });

  it("gives two videos two rows", () => {
    const tree = render([video("a"), video("b")]);

    expect(cells(tree)).toHaveLength(2);
    expect(bottomRow(tree)[0].findAll((node) => node.props.testID === "poster-collage-cell", { deep: false })).toHaveLength(1);
  });

  it("fills the card with one cell and no bottom row for a single video", () => {
    const tree = render([video("a")]);

    expect(cells(tree)).toHaveLength(1);
    expect(bottomRow(tree)).toHaveLength(0);
  });

  it("keeps a cell's fill, and draws no picture, until its frame lands", () => {
    const tree = render([video("a", false), video("b")]);

    expect(cells(tree)).toHaveLength(2);
    expect(tree.root.findAllByType(Image)).toHaveLength(1);
  });
});
