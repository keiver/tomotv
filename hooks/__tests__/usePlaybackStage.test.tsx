/**
 * Tests for usePlaybackStage: the pure label/hint lookups and the once-a-second
 * elapsed clock the loading overlay reads. Rendered through the project's
 * null-harness pattern; the playbackStage service is a module singleton, reset
 * between cases.
 */
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

import { stageHint, stageLabel, usePlaybackStage } from "@/hooks/usePlaybackStage";
import { resetPlaybackStages, setPlaybackStage, type PlaybackStage } from "@/services/playbackStage";

const STAGES: PlaybackStage[] = ["details", "opening", "engine", "reading", "analysing", "preparing", "server", "player", "buffering", "reopening"];

type Hook = ReturnType<typeof usePlaybackStage>;
type HookRef = { get: () => Hook };

const Harness = forwardRef<HookRef>((_props, ref) => {
  const result = usePlaybackStage();
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

describe("stageLabel / stageHint", () => {
  it("gives every stage a distinct, non-empty label and hint", () => {
    const labels = STAGES.map(stageLabel);
    const hints = STAGES.map(stageHint);
    for (const text of [...labels, ...hints]) expect(text).toBeTruthy();
    expect(new Set(labels).size).toBe(STAGES.length);
    expect(new Set(hints).size).toBe(STAGES.length);
  });
});

describe("usePlaybackStage", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetPlaybackStages();
  });

  afterEach(() => {
    act(() => {
      rendered.forEach((r) => r.unmount());
    });
    rendered.length = 0;
    resetPlaybackStages();
    jest.useRealTimers();
  });

  it("reports no stage and zero elapsed at rest", () => {
    const { hook } = render();
    expect(hook().stage).toBeNull();
    expect(hook().elapsedSeconds).toBe(0);
  });

  it("counts elapsed seconds once a stage is running", () => {
    const { hook } = render();
    act(() => {
      setPlaybackStage("opening");
    });
    expect(hook().stage).toBe("opening");
    expect(hook().elapsedSeconds).toBe(0);
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(hook().elapsedSeconds).toBe(3);
  });

  it("records the prior stage and resets the clock on a stage change", () => {
    const { hook } = render();
    act(() => {
      setPlaybackStage("opening");
    });
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    act(() => {
      setPlaybackStage("engine");
    });
    expect(hook().stage).toBe("engine");
    expect(hook().passed).toContain("opening");
    expect(hook().elapsedSeconds).toBe(0);
  });
});
