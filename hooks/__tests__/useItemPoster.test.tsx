/**
 * Tests for useItemPoster: a postered item answers at once without asking the engine, an
 * item without one takes the frame the hook requests, and a null item answers nothing.
 */
import { useItemPoster } from "@/hooks/useItemPoster";
import type { PosterItem } from "@/services/itemArtwork";
import { requestPosterFrame } from "@/services/localRemux";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/jellyfinApi", () => ({
  subscribeAuthChange: jest.fn(() => () => {}),
  hasPoster: (item: { ImageTags?: { Primary?: string } }) => item.ImageTags?.Primary !== undefined,
  getPosterUrl: (id: string, height: number) => `https://jf/Items/${id}/Images/Primary?maxHeight=${height}`,
}));
jest.mock("@/services/localRemux", () => ({
  requestPosterFrame: jest.fn(async () => "file:///pool/a/poster.jpg"),
  cancelPosterFrame: jest.fn(),
  posterFrameIfCached: jest.fn(() => undefined),
  posterFrameGeneration: jest.fn(() => 0),
  posterFrameRevision: jest.fn(() => 0),
}));

type Handle = { get: () => { uri: string; cacheKey: string } | undefined };

const Probe = forwardRef<Handle, { item: PosterItem | null }>(({ item }, ref) => {
  const source = useItemPoster(item, 300);
  useImperativeHandle(ref, () => ({ get: () => source }), [source]);
  return null;
});
Probe.displayName = "Probe";

async function mount(item: PosterItem | null) {
  const ref = React.createRef<Handle>();
  await act(async () => {
    TestRenderer.create(<Probe ref={ref} item={item} />);
  });
  return ref.current!.get();
}

describe("useItemPoster", () => {
  beforeEach(() => jest.clearAllMocks());

  it("answers the server poster at once and never asks the engine", async () => {
    expect(await mount({ Id: "a", Type: "Movie", ImageTags: { Primary: "tag" }, RunTimeTicks: 0 })).toEqual({ uri: "https://jf/Items/a/Images/Primary?maxHeight=300", cacheKey: "a-tag-300" });
    expect(requestPosterFrame).not.toHaveBeenCalled();
  });

  it("takes the keyframe for an item the server left blank", async () => {
    expect(await mount({ Id: "a", Type: "Movie", RunTimeTicks: 0 })).toEqual({ uri: "file:///pool/a/poster.jpg", cacheKey: "a-keyframe-0.0" });
    expect(requestPosterFrame).toHaveBeenCalledWith({ Id: "a", RunTimeTicks: 0 });
  });

  it("answers nothing for no item", async () => {
    expect(await mount(null)).toBeUndefined();
    expect(requestPosterFrame).not.toHaveBeenCalled();
  });
});
