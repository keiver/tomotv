/**
 * Tests for useFolderPreview: a cover-less video folder fetches its first videos, a folder the
 * server pictures never asks, audio and photo kinds never ask, and a recycled card drops the
 * previous folder's videos, and a server switch refetches even on the same folder id.
 */
import { useFolderPreview } from "@/hooks/useFolderPreview";
import { fetchFolderPreviewItems, subscribeAuthChange } from "@/services/jellyfinApi";
import type { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/jellyfinApi", () => ({ fetchFolderPreviewItems: jest.fn(), subscribeAuthChange: jest.fn() }));

const mockFetch = fetchFolderPreviewItems as jest.Mock;
const mockSubscribe = subscribeAuthChange as jest.Mock;

// Every mounted probe's auth listener, so a test can fire the switch the app fires.
let authListeners: (() => void)[] = [];
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
    authListeners = [];
    mockSubscribe.mockImplementation((cb: () => void) => {
      authListeners.push(cb);
      return () => {
        authListeners = authListeners.filter((listener) => listener !== cb);
      };
    });
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

  it("refetches on a server switch that reuses the same folder id", async () => {
    const SWITCHED = [{ Id: "e9", Type: "Movie" }] as JellyfinVideoItem[];
    mockFetch.mockResolvedValueOnce(VIDEOS).mockResolvedValueOnce(SWITCHED);

    const { ref } = await mount(folder("shows", "CollectionFolder"));
    expect(ref.current!.get()).toBe(VIDEOS);

    // Same id on the new server: Jellyfin derives it from the library path.
    await act(async () => {
      authListeners.forEach((cb) => cb());
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(ref.current!.get()).toBe(SWITCHED);
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
