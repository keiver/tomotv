/**
 * Tests for useFolderPreview: a cover-less video folder fetches its first videos, a folder the
 * server pictures never asks, audio and photo kinds never ask, and a recycled card drops the
 * previous folder's videos.
 */
import { useFolderPreview } from "@/hooks/useFolderPreview";
import { fetchFolderPreviewItems } from "@/services/jellyfinApi";
import type { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/jellyfinApi", () => ({ fetchFolderPreviewItems: jest.fn() }));

const mockFetch = fetchFolderPreviewItems as jest.Mock;
const VIDEOS = [
  { Id: "e1", Type: "Movie" },
  { Id: "e2", Type: "Movie" },
] as JellyfinVideoItem[];

type Handle = { get: () => JellyfinVideoItem[] };

const Probe = forwardRef<Handle, { folder: JellyfinItem | null; wanted: boolean }>(({ folder, wanted }, ref) => {
  const items = useFolderPreview(folder, wanted);
  useImperativeHandle(ref, () => ({ get: () => items }), [items]);
  return null;
});
Probe.displayName = "Probe";

const folder = (id: string, type = "Folder") => ({ Id: id, Name: id, Type: type }) as JellyfinItem;

async function mount(item: JellyfinItem, wanted = true) {
  const ref = React.createRef<Handle>();
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<Probe ref={ref} folder={item} wanted={wanted} />);
  });
  return { ref, tree };
}

describe("useFolderPreview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue(VIDEOS);
  });

  it("fetches the first videos of a cover-less folder", async () => {
    const { ref } = await mount(folder("f1"));
    expect(mockFetch).toHaveBeenCalledWith("f1");
    expect(ref.current!.get()).toBe(VIDEOS);
  });

  it("never asks for a folder the server pictures", async () => {
    const { ref } = await mount(folder("f1"), false);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(ref.current!.get()).toEqual([]);
  });

  it("never asks for an album, an artist or a photo album", async () => {
    await mount(folder("a1", "MusicAlbum"));
    await mount(folder("a2", "MusicArtist"));
    await mount(folder("p1", "PhotoAlbum"));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("drops the previous folder's videos when the card is recycled", async () => {
    const { ref, tree } = await mount(folder("f1"));
    expect(ref.current!.get()).toBe(VIDEOS);

    let release!: (items: JellyfinVideoItem[]) => void;
    mockFetch.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    await act(async () => {
      tree.update(<Probe ref={ref} folder={folder("f2")} wanted />);
    });
    expect(ref.current!.get()).toEqual([]);

    await act(async () => release([VIDEOS[0]]));
    expect(ref.current!.get()).toEqual([VIDEOS[0]]);
  });

  it("answers nothing, and never asks, with no folder", async () => {
    const ref = React.createRef<Handle>();
    await act(async () => {
      TestRenderer.create(<Probe ref={ref} folder={null} wanted />);
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(ref.current!.get()).toEqual([]);
  });

  it("keeps the placeholder when the request fails", async () => {
    mockFetch.mockRejectedValue(new Error("offline"));
    const { ref } = await mount(folder("f1"));
    expect(ref.current!.get()).toEqual([]);
  });
});
