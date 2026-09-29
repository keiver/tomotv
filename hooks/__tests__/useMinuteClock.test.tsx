/** The shared minute clock: moves on the minute boundary while enabled, stays 0 and silent otherwise. */
import { useMinuteClock } from "@/hooks/useMinuteClock";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

let seen: number[] = [];
function Probe({ enabled }: { enabled: boolean }) {
  seen.push(useMinuteClock(enabled));
  return null;
}

describe("useMinuteClock", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(Date.UTC(2026, 8, 29, 20, 0, 30));
    seen = [];
  });
  afterEach(() => jest.useRealTimers());

  it("re-renders on the next minute boundary, then every minute", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<Probe enabled />);
    });
    const first = seen.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(29_000);
    });
    expect(seen.length).toBe(first);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(seen.at(-1)).toBe(Date.UTC(2026, 8, 29, 20, 1, 0));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(seen.at(-1)).toBe(Date.UTC(2026, 8, 29, 20, 2, 0));
    await act(async () => renderer.unmount());
    // React's own 0ms scheduler timer may still be queued; the minute timer must not be.
    jest.advanceTimersByTime(10);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("stays 0 and runs no timer while disabled", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<Probe enabled={false} />);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(120_000);
    });
    expect(new Set(seen)).toEqual(new Set([0]));
    expect(jest.getTimerCount()).toBe(0);
    await act(async () => renderer.unmount());
  });
});
