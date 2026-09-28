/** The focused card's preview clip hands its file to the native looping view, and stands down under Reduce Motion. */
import React from "react";
import * as Reanimated from "react-native-reanimated";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/modules/live-clip", () => ({ LiveClipView: (props: object) => require("react").createElement("LiveClipView", props) }));

import { LiveClip } from "@/components/live-tv/live-clip";

const clip = { uri: "file:///pool/m1/live-1-clip.mp4", cacheKey: "live-m1-1-clip" };

describe("LiveClip", () => {
  afterEach(() => jest.restoreAllMocks());

  it("plays the clip file in the native view, filling the card", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<LiveClip clip={clip} />);
    });
    const view = tree.root.findByType("LiveClipView" as never);
    expect((view.props as { uri: string }).uri).toBe(clip.uri);
    expect((view.props as { style: object }).style).toMatchObject({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 });
  });

  it("renders nothing under Reduce Motion", () => {
    jest.spyOn(Reanimated, "useReducedMotion").mockReturnValue(true);
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<LiveClip clip={clip} />);
    });
    expect(tree.toJSON()).toBeNull();
  });
});
