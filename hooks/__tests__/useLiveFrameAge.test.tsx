/** useLiveFrameAge counts the marks a picture's age has passed, re-rendering at each mark only. */
import React, { Profiler } from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

let mockReel: { frames: { uri: string }[]; at: number } | undefined;
let mockDueAt: number | undefined;
const mockListeners = new Set<() => void>();
jest.mock("@/services/liveFrames", () => ({
  liveFrameReel: () => mockReel,
  liveFrameDueAt: () => mockDueAt,
  subscribeLiveFrame: (_id: string, listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
}));

import { useLiveFrameAge } from "@/hooks/useLiveFrameAge";

const MARKS = [15_000, 60_000, 120_000];
function Probe() {
  return <Text>{String(useLiveFrameAge("c1", MARKS))}</Text>;
}

function mount() {
  const commits = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <Profiler id="age" onRender={commits}>
        <Probe />
      </Profiler>,
    );
  });
  const step = () => Number(tree.root.findByType(Text).props.children);
  return { tree, step, commits };
}

describe("useLiveFrameAge", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    mockListeners.clear();
    mockReel = undefined;
    mockDueAt = undefined;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("steps through every mark from the picture's landing, then stops", () => {
    mockReel = { frames: [{ uri: "a" }], at: 1_000_000 };
    const { tree, step, commits } = mount();
    expect(step()).toBe(0);
    for (const [ms, expected] of [
      [15_000, 1],
      [45_000, 2],
      [60_000, 3],
    ] as const) {
      act(() => {
        jest.advanceTimersByTime(ms);
      });
      expect(step()).toBe(expected);
    }
    const settled = commits.mock.calls.length;
    act(() => {
      jest.advanceTimersByTime(600_000);
    });
    expect(commits.mock.calls.length).toBe(settled);
    act(() => tree.unmount());
  });

  it("starts an old picture past its marks, and a re-dated verify brings it back to fresh", () => {
    mockReel = { frames: [{ uri: "a" }], at: 1_000_000 - 70_000 };
    const { tree, step } = mount();
    expect(step()).toBe(2);
    mockReel.at = Date.now();
    mockDueAt = Date.now() + 120_000;
    act(() => {
      for (const listener of mockListeners) listener();
    });
    expect(step()).toBe(0);
    act(() => tree.unmount());
  });

  it("is -1 without a picture", () => {
    const { tree, step } = mount();
    expect(step()).toBe(-1);
    act(() => tree.unmount());
  });
});
