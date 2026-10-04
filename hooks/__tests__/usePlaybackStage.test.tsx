/**
 * Tests for usePlaybackStage: the status, reason and stopped-at lookups and the threshold phase the
 * loading overlay and the channel interstitial read. Rendered through the project's null-harness pattern;
 * the playbackStage service is a module singleton, reset between cases.
 */
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

import { REASON_AFTER_MS, STATUS_AFTER_MS, stageReason, stageStatus, stageStopped, usePlaybackStage } from "@/hooks/usePlaybackStage";
import { resetPlaybackStages, setPlaybackStage, type PlaybackStage } from "@/services/playbackStage";

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

describe("stageStatus / stageReason", () => {
  it("words the status for a video and for a channel", () => {
    expect(stageStatus(false)).toBe("Still getting your video ready");
    expect(stageStatus(true)).toBe("Still tuning in");
  });

  it("names a reason only for the stages that wait on one thing", () => {
    const named: PlaybackStage[] = ["details", "opening", "reopening", "reading", "analysing", "server"];
    const unnamed: PlaybackStage[] = ["engine", "preparing", "player", "buffering"];
    for (const stage of named) expect(stageReason(stage)).toBeTruthy();
    for (const stage of unnamed) expect(stageReason(stage)).toBeNull();
  });

  it("names no network wait for a local file, and the channel for a live server wait", () => {
    expect(stageReason("reading", { local: true })).toBeNull();
    expect(stageReason("analysing", { local: true })).toBeNull();
    expect(stageReason("details", { local: true })).toBe("Waiting for your server to respond");
    expect(stageReason("server", { live: true })).toBe("Your server is preparing this channel");
  });
});

describe("stageStopped", () => {
  it("says where every stage stopped, in words a viewer reads", () => {
    const stages: PlaybackStage[] = ["details", "opening", "engine", "reading", "analysing", "preparing", "server", "player", "buffering", "reopening"];
    for (const stage of stages) expect(stageStopped(stage)).toMatch(/^Stopped /);
  });

  it("names a downloaded file for a local read and the channel for a live server stop", () => {
    expect(stageStopped("reading", { local: true })).toBe("Stopped while reading the downloaded file");
    expect(stageStopped("analysing", { local: true })).toBe("Stopped while reading the downloaded file");
    expect(stageStopped("server", { live: true })).toBe("Stopped while your server was preparing the channel");
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

  it("reports no stage and a quiet phase at rest", () => {
    const { hook } = render();
    expect(hook()).toEqual({ stage: null, phase: "quiet" });
  });

  it("crosses the status and reason thresholds from the attempt's start", () => {
    const { hook } = render();
    act(() => {
      setPlaybackStage("opening");
    });
    expect(hook().phase).toBe("quiet");
    act(() => {
      jest.advanceTimersByTime(STATUS_AFTER_MS);
    });
    expect(hook().phase).toBe("status");
    act(() => {
      setPlaybackStage("engine");
    });
    expect(hook()).toEqual({ stage: "engine", phase: "status" });
    act(() => {
      jest.advanceTimersByTime(REASON_AFTER_MS - STATUS_AFTER_MS);
    });
    expect(hook().phase).toBe("reason");
  });
});
