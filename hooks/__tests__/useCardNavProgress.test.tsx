/**
 * Tests for useCardNavProgress: the per-card "navigation in progress" state
 * machine. Press shows the bar; the focus/navigation handoff (or a safety
 * timeout) clears it a linger later. Timer-driven, so fake timers throughout.
 */
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

import { useCardNavProgress } from "@/hooks/useCardNavProgress";

const LINGER_MS = 350;
const SAFETY_TIMEOUT_MS = 5000;

type Hook = ReturnType<typeof useCardNavProgress>;
type HookRef = { get: () => Hook };

const Harness = forwardRef<HookRef>((_props, ref) => {
  const result = useCardNavProgress();
  useImperativeHandle(ref, () => ({ get: () => result }), [result]);
  return null;
});
Harness.displayName = "Harness";

const rendered: TestRenderer.ReactTestRenderer[] = [];

function render() {
  const ref = React.createRef<HookRef>();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Harness ref={ref} />);
  });
  rendered.push(renderer);
  return { hook: () => ref.current!.get() };
}

describe("useCardNavProgress", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      rendered.forEach((r) => r.unmount());
    });
    rendered.length = 0;
    jest.useRealTimers();
  });

  it("is idle before any press", () => {
    const { hook } = render();
    expect(hook().navigating).toBe(false);
    expect(hook().visible).toBe(false);
  });

  it("shows the bar on press and hides it a linger after reset", () => {
    const { hook } = render();
    act(() => {
      hook().startNavProgress();
    });
    expect(hook().navigating).toBe(true);
    expect(hook().visible).toBe(true);

    act(() => {
      hook().resetNavProgress();
    });
    expect(hook().navigating).toBe(false);
    expect(hook().visible).toBe(true);

    act(() => {
      jest.advanceTimersByTime(LINGER_MS);
    });
    expect(hook().visible).toBe(false);
  });

  it("clears itself when navigation never hands off", () => {
    const { hook } = render();
    act(() => {
      hook().startNavProgress();
    });
    act(() => {
      jest.advanceTimersByTime(SAFETY_TIMEOUT_MS);
    });
    expect(hook().navigating).toBe(false);
    act(() => {
      jest.advanceTimersByTime(LINGER_MS);
    });
    expect(hook().visible).toBe(false);
  });

  it("ignores a reset when no navigation is in flight", () => {
    const { hook } = render();
    act(() => {
      hook().resetNavProgress();
    });
    expect(hook().navigating).toBe(false);
    expect(hook().visible).toBe(false);
    act(() => {
      jest.advanceTimersByTime(LINGER_MS);
    });
    expect(hook().visible).toBe(false);
  });
});
