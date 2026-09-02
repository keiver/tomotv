/**
 * Tests for usePosterFrame: an eligible card asks once and shows the frame, a postered card
 * or a photo never asks, a settled item resolves on first render, leaving withdraws the
 * request, and a recycled card never shows the previous item's picture.
 */
import { usePosterFrame } from "@/hooks/usePosterFrame";
import { cancelPosterFrame, posterFrameIfCached, requestPosterFrame } from "@/services/localRemux";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/jellyfinApi", () => ({
  hasPoster: (item: { ImageTags?: { Primary?: string } }) => item.ImageTags?.Primary !== undefined,
}));
jest.mock("@/services/localRemux", () => ({
  requestPosterFrame: jest.fn(),
  cancelPosterFrame: jest.fn(),
  posterFrameIfCached: jest.fn(() => undefined),
}));

const mockRequest = requestPosterFrame as jest.Mock;
const mockCached = posterFrameIfCached as jest.Mock;

type Handle = { get: () => string | null };

const Probe = forwardRef<Handle, { item: JellyfinVideoItem }>(({ item }, ref) => {
  const uri = usePosterFrame(item);
  useImperativeHandle(ref, () => ({ get: () => uri }), [uri]);
  return null;
});
Probe.displayName = "Probe";

const movie = (id: string, extra: Partial<JellyfinVideoItem> = {}): JellyfinVideoItem =>
  ({ Id: id, Name: id, Type: "Movie", RunTimeTicks: 600 * 10_000_000, Path: `/m/${id}.mkv`, ...extra }) as JellyfinVideoItem;

async function mount(item: JellyfinVideoItem) {
  const ref = React.createRef<Handle>();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<Probe ref={ref} item={item} />);
  });
  return { renderer, ref, latest: () => ref.current!.get() };
}

describe("usePosterFrame", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCached.mockReturnValue(undefined);
    mockRequest.mockResolvedValue("file:///pool/a/poster.jpg");
  });

  it("asks once for a video without a poster and shows the frame when it lands", async () => {
    const { latest } = await mount(movie("a"));

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith({ Id: "a", RunTimeTicks: 600 * 10_000_000 });
    expect(latest()).toBe("file:///pool/a/poster.jpg");
  });

  it("never asks for a card that has a poster, or for a photo", async () => {
    const postered = await mount(movie("a", { ImageTags: { Primary: "tag" } }));
    const photo = await mount({ Id: "p", Name: "p", Type: "Photo", RunTimeTicks: 0, Path: "/p.jpg" } as JellyfinVideoItem);

    expect(mockRequest).not.toHaveBeenCalled();
    expect(postered.latest()).toBeNull();
    expect(photo.latest()).toBeNull();
  });

  it("resolves a settled item on the first render without asking", async () => {
    mockCached.mockReturnValue("file:///pool/a/poster.jpg");

    const { latest } = await mount(movie("a"));

    expect(latest()).toBe("file:///pool/a/poster.jpg");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("withdraws the request when the card leaves", async () => {
    const { renderer } = await mount(movie("a"));

    await act(async () => {
      renderer.unmount();
    });

    expect(cancelPosterFrame).toHaveBeenCalledWith("a");
  });

  it("never shows the previous item's frame on a recycled card", async () => {
    let settleB: (uri: string | null) => void = () => {};
    const { renderer, ref, latest } = await mount(movie("a"));
    expect(latest()).toBe("file:///pool/a/poster.jpg");
    mockRequest.mockImplementation(() => new Promise((resolve) => (settleB = resolve)));

    await act(async () => {
      renderer.update(<Probe ref={ref} item={movie("b")} />);
    });

    expect(cancelPosterFrame).toHaveBeenCalledWith("a");
    expect(latest()).toBeNull();

    await act(async () => {
      settleB("file:///pool/b/poster.jpg");
    });
    expect(latest()).toBe("file:///pool/b/poster.jpg");
  });
});
