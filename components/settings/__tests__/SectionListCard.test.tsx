import { SectionListCard, type RowPlace } from "@/components/settings/SectionListCard";
import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

function Row(_: { item: string; place: RowPlace }) {
  return null;
}

function renderCard(groups: { title?: string; data: string[] }[], footer?: React.ReactNode) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<SectionListCard groups={groups} keyExtractor={(item) => item} renderRow={(item, place) => <Row item={item} place={place} />} footer={footer} />);
  });
  return tree;
}

const rows = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Row).map((row) => ({ item: row.props.item, place: row.props.place as RowPlace }));

describe("SectionListCard", () => {
  it("renders a header per titled group and the rows in group order", () => {
    const tree = renderCard([
      { title: "First", data: ["a", "b"] },
      { title: "Second", data: ["c"] },
    ]);
    const texts = tree.root.findAllByType(Text).map((text) => text.props.children);
    expect(texts).toEqual(expect.arrayContaining(["First", "Second"]));
    expect(rows(tree).map((row) => row.item)).toEqual(["a", "b", "c"]);
    act(() => tree.unmount());
  });

  it("marks no row as the card's first when a header sits above it, and the whole list's last row as last", () => {
    const tree = renderCard([
      { title: "First", data: ["a", "b"] },
      { title: "Second", data: ["c"] },
    ]);
    expect(rows(tree).map((row) => ({ first: row.place.isFirst, last: row.place.isLast }))).toEqual([
      { first: false, last: false },
      { first: false, last: false },
      { first: false, last: true },
    ]);
    act(() => tree.unmount());
  });

  it("marks the first row as the card's first when its group has no header, and none as last when a footer follows", () => {
    const tree = renderCard([{ data: ["a", "b"] }], <Text>footer</Text>);
    expect(rows(tree).map((row) => ({ first: row.place.isFirst, last: row.place.isLast }))).toEqual([
      { first: true, last: false },
      { first: false, last: false },
    ]);
    act(() => tree.unmount());
  });

  it("off TV hands rows no focus handlers and no hint", () => {
    const tree = renderCard([{ title: "First", data: ["a"] }]);
    const [row] = rows(tree);
    expect(row.place.onFocus).toBeUndefined();
    expect(row.place.onBlur).toBeUndefined();
    expect(row.place.moreBelow).toBeUndefined();
    act(() => tree.unmount());
  });
});
