/** The seam grip: placed once where the thumb rests, then kept inside its band when a rotation shrinks it. */
import { GuideColumnDivider } from "@/components/live-tv/guide-column-divider";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { View } from "react-native";

jest.mock("react-native-gesture-handler", () => {
  const { View: RNView } = jest.requireActual("react-native");
  return {
    GestureHandlerRootView: RNView,
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    Gesture: {},
  };
});
jest.mock("@/components/live-tv/guide-grip", () => ({ GuideGrip: () => null }));

const shared = (initial: number) => {
  let value = initial;
  return { get: () => value, set: (next: number) => (value = next), value };
};

describe("GuideColumnDivider", () => {
  it("clamps the grip back inside a band that shrank", async () => {
    const gripY = shared(0);
    const bandH = shared(0);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<GuideColumnDivider columnW={shared(200) as never} topInset={0} bottomInset={0} gesture={{} as never} gripY={gripY as never} bandH={bandH as never} />);
    });
    const band = renderer.root.findAll((node) => node.type === View && typeof node.props.onLayout === "function")[0];
    await act(async () => band.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 48, height: 800 } } }));
    // A drag left the grip low in the tall portrait band.
    gripY.set(360);
    await act(async () => band.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 48, height: 300 } } }));
    expect(bandH.get()).toBe(300);
    expect(gripY.get()).toBe((300 - 64) / 2);
  });
});
