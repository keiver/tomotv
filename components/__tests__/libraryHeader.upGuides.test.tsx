/** The bar's up guides: under the path only, its left half sends Up to the leading button, its right half to the first right-hand control. */
import React from "react";
import { TVFocusGuideView, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#FFC312" }) }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/components/glass-button", () => {
  const { forwardRef } = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  return { GlassButton: forwardRef((props: { accessibilityLabel?: string }, ref: React.Ref<unknown>) => <View ref={ref} testID={props.accessibilityLabel} />) };
});
// A node's handle, read off its testID: Back 11, Settings 22, search 44.
const mockHandleOf: Record<string, number> = { "common.back": 11, settings: 22, search: 44 };
jest.mock("react-native/Libraries/ReactNative/RendererProxy", () => ({
  ...jest.requireActual("react-native/Libraries/ReactNative/RendererProxy"),
  findNodeHandle: (node: { props?: { testID?: string } } | null) => mockHandleOf[node?.props?.testID ?? ""] ?? null,
}));

import { LibraryHeader } from "@/components/library-header";

const stack = [{ id: "channels", name: "Channels", type: "livetv" as const }];

function render(props: Partial<React.ComponentProps<typeof LibraryHeader>>) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<LibraryHeader stack={stack} onGoHome={jest.fn()} homeAsBack action={{ icon: "settings-outline", accessibilityLabel: "settings", onPress: jest.fn() }} {...props} />);
  });
  const path = tree.root.findAll((n) => n.type === View && n.props.pointerEvents === "none")[0];
  act(() => path.props.onLayout?.({ nativeEvent: { layout: { x: 100, y: 0, width: 600, height: 40 } } }));
  return tree;
}

test("splits the path's span into two guides, Back on the left and the first right control on the right", () => {
  const tree = render({ upGuides: true });
  const guides = tree.root.findAllByType(TVFocusGuideView);
  expect(guides.map((guide) => guide.props.destinations)).toEqual([[11], [22]]);
  expect(guides.map((guide) => guide.props.style.width)).toEqual([300, 300]);
  const row = tree.root.findAll((n) => n.props.testID === "library-header-up-guides")[0];
  expect(row.findAllByType(View)[1].props.style).toEqual({ width: 100 });
  act(() => tree.unmount());
});

test("the right half leads to the trailing control when one is named", () => {
  const trailing = { props: { testID: "search" } } as unknown as View;
  const tree = render({ upGuides: true, trailingTarget: trailing });
  expect(tree.root.findAllByType(TVFocusGuideView).map((guide) => guide.props.destinations)).toEqual([[11], [44]]);
  act(() => tree.unmount());
});

test("a new right-hand target mounts a fresh right guide and leaves the left one in place", () => {
  const props = { stack, onGoHome: jest.fn(), homeAsBack: true, upGuides: true, action: { icon: "settings-outline" as const, accessibilityLabel: "settings", onPress: jest.fn() } };
  const tree = render({ upGuides: true, trailingTarget: { props: { testID: "search" } } as unknown as View });
  const [left, right] = tree.root.findAllByType(TVFocusGuideView).map((guide) => guide.findByType(View));
  act(() => tree.update(<LibraryHeader {...props} trailingTarget={{ props: { testID: "settings" } } as unknown as View} />));
  const after = tree.root.findAllByType(TVFocusGuideView);
  expect(after.map((guide) => guide.props.destinations)).toEqual([[11], [22]]);
  expect(after[0].findByType(View)).toBe(left);
  expect(after[1].findByType(View)).not.toBe(right);
  act(() => tree.unmount());
});

test("draws no guides unless asked", () => {
  const tree = render({});
  expect(tree.root.findAllByType(TVFocusGuideView)).toHaveLength(0);
  act(() => tree.unmount());
});
