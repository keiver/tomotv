/** On TV the focusable is the cell's stretch on screen, an empty body over the pinned label, so one focus scroll reveals a cell. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Animated, Platform, StyleSheet, Text } from "react-native";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/jellyfinApi", () => ({ getPosterUrl: (id: string) => `poster:${id}`, getCachedConfig: () => ({ server: "http://jf" }) }));
jest.mock("@/services/liveFrames", () => ({ liveFrameReel: () => undefined, subscribeLiveFrame: () => () => undefined }));
jest.mock("expo-image", () => ({ Image: (props: { testID?: string }) => require("react").createElement("Image", props) }));

Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
// Read after the flag: the cell fixes its platform at import.
const { GuideCell } = require("@/components/live-tv/guide-cell") as typeof import("@/components/live-tv/guide-cell");
const { MINUTE_MS } = require("@/utils/guide") as typeof import("@/utils/guide");

const T0 = Date.UTC(2026, 8, 12, 4, 0, 0);
const program = { Id: "p1", Name: "Evening News", EpisodeTitle: "Episode 9", StartDate: new Date(T0).toISOString(), EndDate: new Date(T0 + 60 * MINUTE_MS).toISOString() };

function render(overrides: Partial<React.ComponentProps<typeof GuideCell>> = {}) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <GuideCell
        program={program}
        left={100}
        width={400}
        height={90}
        startMs={T0}
        endMs={T0 + 60 * MINUTE_MS}
        past={false}
        airing
        recording={null}
        scrollX={new Animated.Value(0)}
        viewportWidth={1600}
        nextFocusUp={7}
        onPress={jest.fn()}
        onLongPress={jest.fn()}
        {...overrides}
      />,
    );
  });
  return tree;
}

const hostById = (tree: TestRenderer.ReactTestRenderer, id: string) => tree.root.find((node) => node.props.testID === id && typeof node.type === "string");

describe("GuideCell on TV", () => {
  it("focuses an empty 1pt body that spans the cell's stretch on screen, laid over the label", () => {
    const tree = render();
    const focusable = tree.root.find((node) => node.props.isTVSelectable === true && typeof node.type !== "string");
    expect(focusable.props.children).toBeUndefined();
    expect(focusable.props.nextFocusUp).toBe(7);
    expect(focusable.props.accessibilityLabel).toBe("Episode 9, Evening News");
    // Animated nodes sit in the style: compared field by field, never printed whole.
    const style = StyleSheet.flatten(focusable.props.style) as { position?: string; top?: number; bottom?: number; left?: number; width?: number; transform?: unknown[] };
    expect([style.position, style.top, style.bottom, style.left, style.width]).toEqual(["absolute", 0, 0, -0.5, 1]);
    expect(style.transform?.length).toBe(2);
    // Last in its clip, so nothing sits over it.
    const clip = hostById(tree, "guide-cell-label-clip");
    const last = clip.children.at(-1) as TestRenderer.ReactTestInstance;
    expect(last.props.testID).toBe("guide-cell-focusable");
    const flatText = (node: TestRenderer.ReactTestInstance): string => node.children.map((child) => (typeof child === "string" ? child : flatText(child))).join("");
    const shown = hostById(tree, "guide-cell-label")
      .findAllByType(Text)
      .map((node) => flatText(node));
    expect(shown).toContain("Episode 9  ·  Evening News");
  });

  it("keeps the label itself out of focus and presses on the body", () => {
    const onPress = jest.fn();
    const tree = render({ onPress });
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.focusable === true)).toHaveLength(1);
    act(() => tree.root.find((node) => node.props.isTVSelectable === true && typeof node.type !== "string").props.onPress());
    expect(onPress).toHaveBeenCalledWith(program);
  });

  it("hands the focusable's node to onHandle, so the canvas can refocus it after a covering screen", () => {
    const onHandle = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <GuideCell
          program={program}
          left={100}
          width={400}
          height={90}
          startMs={T0}
          endMs={T0 + 60 * MINUTE_MS}
          past={false}
          airing
          recording={null}
          scrollX={new Animated.Value(0)}
          viewportWidth={1600}
          onPress={jest.fn()}
          onLongPress={jest.fn()}
          onHandle={onHandle}
        />,
        { createNodeMock: () => ({}) },
      );
    });
    // Compared by identity: a failing matcher would print the whole host instance.
    const calls = () => onHandle.mock.calls.map(([id, , handed]) => [id, handed != null]);
    expect(calls()).toEqual([["p1", true]]);
    act(() => tree.unmount());
    expect(calls().at(-1)).toEqual(["p1", false]);
  });
});
