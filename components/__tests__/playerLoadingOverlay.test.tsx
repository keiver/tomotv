/**
 * The stage line under the spinner: nothing for a load that settles in the first second, one label
 * swapped in place after it, and a burst of stages jumps to the newest instead of queueing.
 */
import { DWELL_MS, OUT_MS, PlayerLoadingOverlay, REVEAL_AFTER_MS } from "@/components/player-loading-overlay";
import { STAGE_HINT_AFTER_SECONDS } from "@/hooks/usePlaybackStage";
import { resetPlaybackStages, setPlaybackStage } from "@/services/playbackStage";
import React from "react";
import { ActivityIndicator, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const texts = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root
    .findAllByType(Text)
    .map((text) => text.props.children)
    .filter((child): child is string => typeof child === "string");
const labels = (renderer: TestRenderer.ReactTestRenderer) => texts(renderer).filter((child) => /^[A-Z]/.test(child));
const clocks = (renderer: TestRenderer.ReactTestRenderer) => texts(renderer).filter((child) => /^\d+s$/.test(child));

describe("PlayerLoadingOverlay stage line", () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    jest.useFakeTimers();
    resetPlaybackStages();
    act(() => {
      renderer = TestRenderer.create(<PlayerLoadingOverlay />);
    });
  });
  afterEach(() => {
    act(() => resetPlaybackStages());
    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  it("shows the bare spinner for the first second, then the current stage", () => {
    act(() => setPlaybackStage("details"));
    act(() => jest.advanceTimersByTime(REVEAL_AFTER_MS - 1));
    expect(labels(renderer)).toEqual([]);
    act(() => jest.advanceTimersByTime(1));
    expect(labels(renderer)).toEqual(["Connecting to the server"]);
  });

  it("never shows a load that settles before the reveal", () => {
    act(() => setPlaybackStage("details"));
    act(() => jest.advanceTimersByTime(REVEAL_AFTER_MS / 2));
    act(() => resetPlaybackStages());
    act(() => jest.advanceTimersByTime(REVEAL_AFTER_MS));
    expect(labels(renderer)).toEqual([]);
  });

  it("holds a label for its dwell, then jumps past the stages that went by to the current one", () => {
    act(() => jest.advanceTimersByTime(REVEAL_AFTER_MS));
    act(() => setPlaybackStage("details"));
    const seen = new Set<string>();
    act(() => {
      setPlaybackStage("engine");
      setPlaybackStage("reading");
    });
    for (let ms = 0; ms < DWELL_MS + OUT_MS; ms += 10) {
      labels(renderer).forEach((label) => seen.add(label));
      act(() => jest.advanceTimersByTime(10));
    }
    expect(labels(renderer)).toEqual(["Reading the stream"]);
    expect([...seen]).toEqual(["Connecting to the server"]);
  });

  it("swaps a label that already held its dwell after just the fade", () => {
    act(() => jest.advanceTimersByTime(REVEAL_AFTER_MS));
    act(() => setPlaybackStage("details"));
    act(() => jest.advanceTimersByTime(DWELL_MS));
    act(() => setPlaybackStage("engine"));
    act(() => jest.advanceTimersByTime(OUT_MS - 1));
    expect(labels(renderer)).toEqual(["Connecting to the server"]);
    act(() => jest.advanceTimersByTime(1));
    expect(labels(renderer)).toEqual(["Starting the engine"]);
  });

  it("keeps the label when its stage returns during the fade", () => {
    act(() => jest.advanceTimersByTime(REVEAL_AFTER_MS));
    act(() => setPlaybackStage("details"));
    act(() => jest.advanceTimersByTime(DWELL_MS));
    act(() => resetPlaybackStages());
    act(() => jest.advanceTimersByTime(OUT_MS / 2));
    act(() => setPlaybackStage("details"));
    act(() => jest.advanceTimersByTime(OUT_MS * 2));
    expect(labels(renderer)).toEqual(["Connecting to the server"]);
  });

  it("runs the clock after two seconds and adds the hint once the stage runs long", () => {
    act(() => setPlaybackStage("reading"));
    act(() => jest.advanceTimersByTime(REVEAL_AFTER_MS));
    expect(clocks(renderer)).toEqual([]);
    act(() => jest.advanceTimersByTime(1000));
    // The clock and its invisible twin.
    expect(clocks(renderer)).toEqual(["2s", "2s"]);
    act(() => jest.advanceTimersByTime((STAGE_HINT_AFTER_SECONDS - 2) * 1000));
    expect(labels(renderer)).toEqual(["Reading the stream", "Waiting on the stream's first bytes"]);
  });

  it("shows only the spinner in a release build", () => {
    const globals = global as unknown as { __DEV__: boolean };
    globals.__DEV__ = false;
    try {
      act(() => renderer.update(<PlayerLoadingOverlay />));
      act(() => setPlaybackStage("reading"));
      act(() => jest.advanceTimersByTime(STAGE_HINT_AFTER_SECONDS * 1000));
      expect(texts(renderer)).toEqual([]);
      expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    } finally {
      globals.__DEV__ = true;
    }
  });
});
