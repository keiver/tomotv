/**
 * A downloads row hands Remove to a screen reader as a named action, because the gesture that
 * otherwise reaches it (a left swipe opening the panel) is one VoiceOver cannot perform. The
 * swipe wrapper is mocked to a pass-through: what is under test is the row's own contract.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { DownloadRow } from "@/components/settings/DownloadRow";
import type { DownloadEntry, DownloadState } from "@/services/downloads/manifest";

jest.mock("@/components/settings/SwipeToRemove", () => ({
  SwipeToRemove: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock("@/services/downloads/manager", () => ({
  downloadManager: { subscribeProgress: jest.fn(() => () => {}) },
}));

const ENTRY = (state: DownloadState, overrides: Partial<DownloadEntry> = {}): DownloadEntry =>
  ({
    itemId: "a",
    fileUri: "file:///doc/downloads/a/media.mp4",
    artworkUri: null,
    bytesWritten: 100,
    totalBytes: 100,
    state,
    addedAt: 1,
    item: { Id: "a", Name: "Bloom" },
    ...overrides,
  }) as never;

function render(entry: DownloadEntry, onRemove: () => void) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<DownloadRow entry={entry} selected={false} onPress={() => {}} onRemove={onRemove} />);
  });
  return tree;
}

function actionTarget(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll((node) => typeof node.props?.onAccessibilityAction === "function")[0];
}

describe("DownloadRow", () => {
  it("offers Remove as a named action, which is the only route a screen reader has to it", () => {
    const onRemove = jest.fn();
    const target = actionTarget(render(ENTRY("ready"), onRemove));

    expect(target.props.accessibilityActions).toEqual([{ name: "remove", label: "Remove" }]);

    act(() => target.props.onAccessibilityAction({ nativeEvent: { actionName: "remove" } }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("ignores an action it does not name", () => {
    const onRemove = jest.fn();
    const target = actionTarget(render(ENTRY("ready"), onRemove));

    act(() => target.props.onAccessibilityAction({ nativeEvent: { actionName: "activate" } }));
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("says what a press does, which is not the same thing on every row", () => {
    const hint = (state: DownloadState) => actionTarget(render(ENTRY(state), jest.fn())).props.accessibilityHint;

    expect(hint("ready")).toBe("Plays from this device. Swipe left or press and hold to remove.");
    expect(hint("downloading")).toContain("Pauses this download.");
    expect(hint("paused")).toContain("Resumes this download.");
    expect(hint("failed")).toContain("Retries this download.");
    // A press on either of these re-queues the transfer, which is not what the row offers.
    expect(hint("queued")).toBe("Waiting. Swipe left or press and hold to remove.");
    expect(hint("repackaging")).toBe("Waiting. Swipe left or press and hold to remove.");
  });
});
