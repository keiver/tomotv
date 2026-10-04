/**
 * The line under the spinner: nothing for a load that settles before the status threshold, one
 * status line after it, and what the current stage waits on once the attempt runs longer still.
 */
import { PlayerLoadingOverlay } from "@/components/player-loading-overlay";
import { REASON_AFTER_MS, STATUS_AFTER_MS } from "@/hooks/usePlaybackStage";
import { resetPlaybackStages, setPlaybackStage } from "@/services/playbackStage";
import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const texts = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root
    .findAllByType(Text)
    .map((text) => text.props.children)
    .filter((child): child is string => typeof child === "string");

describe("PlayerLoadingOverlay line", () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  const mount = (element: React.ReactElement = <PlayerLoadingOverlay />) =>
    act(() => {
      renderer = TestRenderer.create(element);
    });
  beforeEach(() => {
    jest.useFakeTimers();
    resetPlaybackStages();
  });
  afterEach(() => {
    act(() => resetPlaybackStages());
    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  it("shows the bare spinner until the status threshold, then the status line", () => {
    mount();
    act(() => setPlaybackStage("details"));
    act(() => jest.advanceTimersByTime(STATUS_AFTER_MS - 1));
    expect(texts(renderer)).toEqual([]);
    act(() => jest.advanceTimersByTime(1));
    expect(texts(renderer)).toEqual(["Still getting your video ready"]);
  });

  it("never shows a load that settles before the threshold", () => {
    mount();
    act(() => setPlaybackStage("details"));
    act(() => jest.advanceTimersByTime(STATUS_AFTER_MS - 1000));
    act(() => resetPlaybackStages());
    act(() => jest.advanceTimersByTime(REASON_AFTER_MS));
    expect(texts(renderer)).toEqual([]);
  });

  it("counts from the attempt's first stage, however often the stage changes", () => {
    mount();
    act(() => setPlaybackStage("details"));
    act(() => jest.advanceTimersByTime(3000));
    act(() => setPlaybackStage("engine"));
    act(() => jest.advanceTimersByTime(3000));
    act(() => setPlaybackStage("reading"));
    act(() => jest.advanceTimersByTime(STATUS_AFTER_MS - 6000));
    expect(texts(renderer)).toEqual(["Still getting your video ready"]);
    act(() => jest.advanceTimersByTime(REASON_AFTER_MS - STATUS_AFTER_MS));
    expect(texts(renderer)).toEqual(["Still getting your video ready", "Waiting for the video to arrive"]);
  });

  it("names a reason only while the current stage pins one", () => {
    mount();
    act(() => setPlaybackStage("reading"));
    act(() => jest.advanceTimersByTime(REASON_AFTER_MS));
    expect(texts(renderer)).toEqual(["Still getting your video ready", "Waiting for the video to arrive"]);
    act(() => setPlaybackStage("preparing"));
    expect(texts(renderer)).toEqual(["Still getting your video ready"]);
    act(() => setPlaybackStage("server"));
    expect(texts(renderer)).toEqual(["Still getting your video ready", "Your server is preparing this video"]);
  });

  it("names no network wait for a file read off this device", () => {
    mount(<PlayerLoadingOverlay local />);
    act(() => setPlaybackStage("reading"));
    act(() => jest.advanceTimersByTime(REASON_AFTER_MS));
    expect(texts(renderer)).toEqual(["Still getting your video ready"]);
  });

  it("speaks of the channel for a live attempt", () => {
    mount(<PlayerLoadingOverlay live />);
    act(() => setPlaybackStage("server"));
    act(() => jest.advanceTimersByTime(REASON_AFTER_MS));
    expect(texts(renderer)).toEqual(["Still tuning in", "Your server is preparing this channel"]);
  });

  it("shows the line at once when it mounts on an attempt already past the threshold", () => {
    act(() => setPlaybackStage("details"));
    act(() => jest.advanceTimersByTime(STATUS_AFTER_MS + 500));
    mount();
    expect(texts(renderer)).toEqual(["Still getting your video ready"]);
    act(() => jest.advanceTimersByTime(REASON_AFTER_MS - STATUS_AFTER_MS));
    expect(texts(renderer)).toEqual(["Still getting your video ready", "Waiting for your server to respond"]);
  });

  it("starts the next attempt quiet", () => {
    mount();
    act(() => setPlaybackStage("details"));
    act(() => jest.advanceTimersByTime(REASON_AFTER_MS));
    act(() => resetPlaybackStages());
    act(() => setPlaybackStage("details"));
    expect(texts(renderer)).toEqual([]);
    act(() => jest.advanceTimersByTime(STATUS_AFTER_MS));
    expect(texts(renderer)).toEqual(["Still getting your video ready"]);
  });
});
