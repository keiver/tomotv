/**
 * The stage log under the spinner: a burst of stages arrives one row at a time, a passed row holds long
 * enough to read before it leaves, and a row leaves only after its fade and fold have run.
 */
import { FADE_MS, GAP_MS, HOLD_MS, MAX_ROWS, markLeaving, PlayerLoadingOverlay, type StageRowState } from "@/components/player-loading-overlay";
import { resetPlaybackStages, setPlaybackStage } from "@/services/playbackStage";
import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const labels = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root
    .findAllByType(Text)
    .map((text) => text.props.children)
    .filter((child): child is string => typeof child === "string" && /^[A-Z]/.test(child));

const row = (key: number, until: number, shownAt = 0): StageRowState => ({ key, stage: "engine", since: 0, until, shownAt, hint: false, leaving: false });

describe("PlayerLoadingOverlay stage log", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetPlaybackStages();
  });
  afterEach(() => {
    act(() => resetPlaybackStages());
    jest.useRealTimers();
  });

  it("paces a burst of stages one row per gap and keeps every row on screen", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<PlayerLoadingOverlay />);
    });
    act(() => setPlaybackStage("details"));
    expect(labels(renderer)).toEqual(["Connecting to the server"]);

    act(() => {
      setPlaybackStage("engine");
      setPlaybackStage("reading");
    });
    expect(labels(renderer)).toEqual(["Connecting to the server"]);
    act(() => jest.advanceTimersByTime(GAP_MS));
    expect(labels(renderer)).toEqual(["Connecting to the server", "Starting the engine"]);
    act(() => jest.advanceTimersByTime(GAP_MS));
    expect(labels(renderer)).toEqual(["Connecting to the server", "Starting the engine", "Reading the stream"]);
  });

  it("holds a passed row for reading, then removes it only after its fade and fold", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<PlayerLoadingOverlay />);
    });
    act(() => setPlaybackStage("details"));
    act(() => jest.advanceTimersByTime(1000));
    act(() => setPlaybackStage("engine"));
    act(() => jest.advanceTimersByTime(GAP_MS));
    expect(labels(renderer)).toEqual(["Connecting to the server", "Starting the engine"]);

    // Passed at 1000ms: due at 4000ms, then the fade plays out (no layout under the test renderer, so no fold).
    act(() => jest.advanceTimersByTime(HOLD_MS - GAP_MS - 1));
    expect(labels(renderer)).toEqual(["Connecting to the server", "Starting the engine"]);
    act(() => jest.advanceTimersByTime(2));
    act(() => jest.advanceTimersByTime(FADE_MS + 40));
    expect(labels(renderer)).toEqual(["Connecting to the server", "Starting the engine"]);
    act(() => jest.advanceTimersByTime(20));
    expect(labels(renderer)).toEqual(["Starting the engine"]);
  });

  it("freezes a passed row's clock at the stage's length and runs the live one", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<PlayerLoadingOverlay />);
    });
    act(() => setPlaybackStage("details"));
    act(() => jest.advanceTimersByTime(3000));
    act(() => setPlaybackStage("engine"));
    act(() => jest.advanceTimersByTime(GAP_MS));
    const clocks = () =>
      renderer.root
        .findAllByType(Text)
        .map((text) => text.props.children)
        .filter((child) => typeof child === "string" && /^\d+s$/.test(child));
    expect(clocks()).toEqual(["3s"]);
    act(() => jest.advanceTimersByTime(2000));
    expect(clocks()).toEqual(["3s", "2s"]);
  });
});

describe("markLeaving", () => {
  it("returns the same rows while none is due", () => {
    const rows = [row(1, 0), row(2, 0)];
    expect(markLeaving(rows, 10_000)).toBe(rows);
  });

  it("marks rows whose hold has run since they were both shown and passed", () => {
    const rows = [row(1, 500, 2000), row(2, 4000, 0), row(3, 0)];
    expect(markLeaving(rows, 2000 + HOLD_MS).map((r) => r.leaving)).toEqual([true, false, false]);
    expect(markLeaving(rows, 4000 + HOLD_MS).map((r) => r.leaving)).toEqual([true, true, false]);
  });

  it("sends the oldest rows off early past the cap, never the running one", () => {
    const rows = Array.from({ length: MAX_ROWS + 2 }, (_, i) => row(i, i < MAX_ROWS + 1 ? 100 : 0, 50));
    expect(markLeaving(rows, 200).map((r) => r.leaving)).toEqual([true, true, ...Array(MAX_ROWS).fill(false)]);
  });
});
