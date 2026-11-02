/** The card on Apple TV: every row takes focus handlers, the hint sits on the last visible row while focus is elsewhere. */
import React from "react";
import { Platform, ScrollView } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import type { RowPlace } from "@/components/settings/SectionListCard";

Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
// Read after the flag: the component fixes its platform at import.
const { SectionListCard } = require("@/components/settings/SectionListCard") as typeof import("@/components/settings/SectionListCard");

function Row(_: { item: string; place: RowPlace }) {
  return null;
}

function renderCard() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <SectionListCard
        groups={[
          { title: "First", data: ["a", "b"] },
          { title: "Second", data: ["c"] },
        ]}
        keyExtractor={(item: string) => item}
        renderRow={(item, place) => <Row item={item} place={place} />}
      />,
    );
  });
  return tree;
}

const rows = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Row).map((row) => ({ item: row.props.item, place: row.props.place as RowPlace }));

/** Lay the rows out under their headers, then show a window that cuts the list after the second row. */
function showWindow(tree: TestRenderer.ReactTestRenderer) {
  const bounds: Record<string, { y: number; height: number }> = {
    a: { y: 56, height: 120 },
    b: { y: 176, height: 120 },
    c: { y: 352, height: 120 },
  };
  act(() => {
    for (const row of tree.root.findAllByType(Row)) {
      const wrapper = row.parent!;
      wrapper.props.onLayout({ nativeEvent: { layout: bounds[row.props.item] } });
    }
    const list = tree.root.findByType(ScrollView);
    list.props.onContentSizeChange(0, 500);
    list.props.onLayout({ nativeEvent: { layout: { height: 300 } } });
    list.props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } });
  });
}

describe("SectionListCard on TV", () => {
  it("hands every row focus handlers", () => {
    const tree = renderCard();
    for (const row of rows(tree)) {
      expect(typeof row.place.onFocus).toBe("function");
      expect(typeof row.place.onBlur).toBe("function");
    }
    act(() => tree.unmount());
  });

  it("puts the hint on the last row that fits the window while rows remain below", () => {
    const tree = renderCard();
    showWindow(tree);
    expect(rows(tree).map((row) => ({ item: row.item, moreBelow: row.place.moreBelow }))).toEqual([
      { item: "a", moreBelow: undefined },
      { item: "b", moreBelow: true },
      { item: "c", moreBelow: undefined },
    ]);
    act(() => tree.unmount());
  });

  it("hides the hint while a row holds focus and shows it again on blur", () => {
    const tree = renderCard();
    showWindow(tree);
    const middle = rows(tree)[1];
    act(() => middle.place.onFocus!());
    expect(rows(tree)[1].place.moreBelow).toBe(false);
    act(() => rows(tree)[1].place.onBlur!());
    expect(rows(tree)[1].place.moreBelow).toBe(true);
    act(() => tree.unmount());
  });

  it("pins the list to its ends when the first or last row takes focus", () => {
    const tree = renderCard();
    const scrollTo = jest.fn();
    const scrollToEnd = jest.fn();
    const list = tree.root.findByType(ScrollView).instance as { scrollTo: typeof scrollTo; scrollToEnd: typeof scrollToEnd };
    list.scrollTo = scrollTo;
    list.scrollToEnd = scrollToEnd;
    const [first, , last] = rows(tree);
    act(() => first.place.onFocus!());
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    act(() => last.place.onFocus!());
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
    act(() => tree.unmount());
  });
});
