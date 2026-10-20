/** The shelf's end guide on TV: the empty space after the last card leads focus to that card. */
import React from "react";
import { Platform, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) }));
jest.mock("expo-router", () => ({ useScrollToTop: () => {} }));
// A wrapper's handle, read off the card it holds: card "a" is 1, "b" is 2, "c" is 3.
const mockHandleOf: Record<string, number> = { a: 1, b: 2, c: 3 };
jest.mock("react-native/Libraries/ReactNative/RendererProxy", () => ({
  ...jest.requireActual("react-native/Libraries/ReactNative/RendererProxy"),
  findNodeHandle: (node: { props?: { children?: { props?: { testID?: string } } } } | null) => mockHandleOf[node?.props?.children?.props?.testID ?? ""] ?? null,
}));
jest.mock("react-native/Libraries/Components/TV/TVFocusGuideView", () => {
  const { View } = jest.requireActual("react-native");
  return { __esModule: true, default: (props: object) => require("react").createElement(View, props) };
});

Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
// Read after the flag: the shelf fixes its platform at import.
const { MediaShelf } = require("@/components/media-shelf") as typeof import("@/components/media-shelf");
const TVFocusGuideView = jest.requireMock("react-native/Libraries/Components/TV/TVFocusGuideView").default;
// The list wraps itself in a guide of its own, which names no destinations.
const endGuides = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => node.type === TVFocusGuideView && node.props.destinations !== undefined);

function shelf(data: string[]) {
  return <MediaShelf title="New" data={data} slotShapeFor={() => "portrait"} renderItem={(id: string) => <View testID={id} />} keyExtractor={(id: string) => id} />;
}

test("the guide after the cards leads to the last card", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(shelf(["a", "b"]));
  });
  expect(endGuides(tree).map((guide) => guide.props.destinations)).toEqual([[2]]);
  act(() => tree.unmount());
});

test("a shelf that gains a card mounts a fresh guide leading to the new last card", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(shelf(["a", "b"]));
  });
  const before = endGuides(tree)[0].findByType(View);
  act(() => tree.update(shelf(["a", "b", "c"])));
  const after = endGuides(tree);
  expect(after.map((guide) => guide.props.destinations)).toEqual([[3]]);
  expect(after[0].findByType(View)).not.toBe(before);
  act(() => tree.unmount());
});
