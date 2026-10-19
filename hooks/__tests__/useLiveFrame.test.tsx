/** useLiveFrame follows the sampler: the current frame on mount, the next on notify, another channel on rebind. */
import { useLiveFrame, useLiveFrameSeenAt } from "@/hooks/useLiveFrame";
import { liveFrameFor, liveFrameReel, subscribeLiveFrame } from "@/services/liveFrames";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/liveFrames", () => ({
  liveFrameFor: jest.fn(),
  liveFrameReel: jest.fn(),
  subscribeLiveFrame: jest.fn(),
}));

const mockFrameFor = liveFrameFor as jest.Mock;
const mockReel = liveFrameReel as jest.Mock;
const mockSubscribe = subscribeLiveFrame as jest.Mock;

type Handle = { get: () => { uri: string; cacheKey: string } | undefined };

const Probe = forwardRef<Handle, { channelId: string }>(({ channelId }, ref) => {
  const frame = useLiveFrame(channelId);
  useImperativeHandle(ref, () => ({ get: () => frame }), [frame]);
  return null;
});
Probe.displayName = "Probe";

describe("useLiveFrame", () => {
  const frames = new Map<string, { uri: string; cacheKey: string }>();
  const listeners = new Map<string, () => void>();

  beforeEach(() => {
    frames.clear();
    listeners.clear();
    mockFrameFor.mockImplementation((id: string) => frames.get(id));
    mockSubscribe.mockImplementation((id: string, listener: () => void) => {
      listeners.set(id, listener);
      return () => listeners.delete(id);
    });
  });

  it("reads the frame on mount, follows a grab, and rebinds to another channel", () => {
    frames.set("c1", { uri: "file:///c1/live-1.jpg", cacheKey: "live-c1-1" });
    const ref = React.createRef<Handle>();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<Probe ref={ref} channelId="c1" />);
    });
    expect(ref.current?.get()?.cacheKey).toBe("live-c1-1");

    frames.set("c1", { uri: "file:///c1/live-2.jpg", cacheKey: "live-c1-2" });
    act(() => listeners.get("c1")?.());
    expect(ref.current?.get()?.cacheKey).toBe("live-c1-2");

    act(() => renderer.update(<Probe ref={ref} channelId="c2" />));
    expect(ref.current?.get()).toBeUndefined();
    expect(listeners.has("c1")).toBe(false);
    expect(listeners.has("c2")).toBe(true);
    act(() => renderer.unmount());
    expect(listeners.size).toBe(0);
  });
});

describe("useLiveFrameSeenAt", () => {
  let reel: { frames: { uri: string; cacheKey: string }[]; at: number } | undefined;
  let notify: (() => void) | undefined;
  let seenAt = -1;
  function SeenProbe({ channelId }: { channelId: string }) {
    seenAt = useLiveFrameSeenAt(channelId);
    return null;
  }

  beforeEach(() => {
    reel = undefined;
    mockReel.mockImplementation(() => reel);
    mockSubscribe.mockImplementation((_id: string, listener: () => void) => {
      notify = listener;
      return () => undefined;
    });
  });

  it("is 0 with no picture, the burst's time once one shows, and follows a re-dated burst", () => {
    act(() => {
      TestRenderer.create(<SeenProbe channelId="c1" />);
    });
    expect(seenAt).toBe(0);
    reel = { frames: [], at: 1000 };
    act(() => notify?.());
    expect(seenAt).toBe(0);
    reel = { frames: [{ uri: "file:///c1/live-1.jpg", cacheKey: "live-c1-1" }], at: 1000 };
    act(() => notify?.());
    expect(seenAt).toBe(1000);
    reel = { ...reel, at: 5000 };
    act(() => notify?.());
    expect(seenAt).toBe(5000);
  });
});
