/**
 * Tests for useViewItemCount: a view card streams its count in, a non-view never asks, a
 * recycled card drops the previous folder's count, and a server switch (auth change) clears
 * the badge and refetches even though both servers hand out the same view id.
 */
import { useViewItemCount } from "@/hooks/useViewItemCount";
import { fetchViewItemCount, subscribeAuthChange } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/jellyfinApi", () => ({ fetchViewItemCount: jest.fn(), subscribeAuthChange: jest.fn() }));

const mockFetch = fetchViewItemCount as jest.Mock;
const mockSubscribe = subscribeAuthChange as jest.Mock;

// Every mounted probe's auth listener, so a test can fire the switch the app fires.
let authListeners: (() => void)[] = [];

type Result = { count: number | undefined; loading: boolean };
type Handle = { get: () => Result };

const Probe = forwardRef<Handle, { folder: JellyfinItem }>(({ folder }, ref) => {
  const result = useViewItemCount(folder);
  useImperativeHandle(ref, () => ({ get: () => result }), [result]);
  return null;
});
Probe.displayName = "Probe";

const view = (id: string, type = "CollectionFolder") => ({ Id: id, Name: id, Type: type }) as JellyfinItem;

async function mount(folder: JellyfinItem) {
  const ref = React.createRef<Handle>();
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<Probe ref={ref} folder={folder} />);
  });
  return { ref, tree };
}

describe("useViewItemCount", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authListeners = [];
    mockSubscribe.mockImplementation((cb: () => void) => {
      authListeners.push(cb);
      return () => {
        authListeners = authListeners.filter((listener) => listener !== cb);
      };
    });
  });

  it("streams a view's count in and reports loading until it lands", async () => {
    let resolveCount!: (value: number) => void;
    mockFetch.mockReturnValue(new Promise<number>((resolve) => (resolveCount = resolve)));

    const { ref } = await mount(view("shows"));
    expect(ref.current!.get()).toEqual({ count: undefined, loading: true });

    await act(async () => {
      resolveCount(6);
    });
    expect(ref.current!.get()).toEqual({ count: 6, loading: false });
  });

  it("never asks for a non-view folder", async () => {
    const { ref } = await mount(view("season-1", "Folder"));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(ref.current!.get()).toEqual({ count: undefined, loading: false });
  });

  it("drops the count when a card is recycled onto another view", async () => {
    mockFetch.mockResolvedValueOnce(6).mockReturnValueOnce(new Promise(() => {}));

    const { ref, tree } = await mount(view("shows"));
    expect(ref.current!.get().count).toBe(6);

    await act(async () => {
      tree.update(<Probe ref={ref} folder={view("music")} />);
    });
    expect(ref.current!.get()).toEqual({ count: undefined, loading: true });
  });

  it("clears the badge and refetches on a server switch that reuses the same view id", async () => {
    mockFetch.mockResolvedValueOnce(51).mockResolvedValueOnce(6);

    const { ref } = await mount(view("shows"));
    expect(ref.current!.get().count).toBe(51);

    // Same id on the new server: Jellyfin derives it from the library path.
    await act(async () => {
      authListeners.forEach((cb) => cb());
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(ref.current!.get()).toEqual({ count: 6, loading: false });
  });

  it("shows no badge when the count fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("View item count unavailable"));

    const { ref } = await mount(view("shows"));
    expect(ref.current!.get()).toEqual({ count: undefined, loading: false });
  });
});
