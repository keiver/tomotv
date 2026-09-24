/** useChannels: the first page on mount, the next on loadMore while the server has more, a new sort starting over, a failed load retried. */
import { CHANNEL_WALL_PAGE, useChannels } from "@/hooks/useChannels";
import { fetchChannels } from "@/services/jellyfinApi";
import type { ChannelSort } from "@/services/liveTvPreferences";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/jellyfinApi", () => ({ fetchChannels: jest.fn() }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

const mockFetch = fetchChannels as jest.Mock;
type Hook = ReturnType<typeof useChannels>;
type HookRef = { get: () => Hook };

const Harness = forwardRef<HookRef, { sort: ChannelSort }>(({ sort }, ref) => {
  const result = useChannels(sort);
  useImperativeHandle(ref, () => ({ get: () => result }), [result]);
  return null;
});
Harness.displayName = "Harness";

async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const channels = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ Id: `c${from + i}`, Name: `Channel ${from + i}`, Type: "TvChannel" }));

describe("useChannels", () => {
  beforeEach(() => mockFetch.mockReset());

  it("loads the first page in the sort's server order, then the next on loadMore until the total is reached", async () => {
    const total = CHANNEL_WALL_PAGE + 3;
    mockFetch.mockImplementation(async ({ startIndex }: { startIndex: number }) => ({ items: channels(startIndex, Math.min(CHANNEL_WALL_PAGE, total - startIndex)), total }));
    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} sort="number" />);
    });
    await settle();
    expect(mockFetch).toHaveBeenCalledWith({ startIndex: 0, limit: CHANNEL_WALL_PAGE, sortBy: "SortName" });
    expect(ref.current?.get().items).toHaveLength(CHANNEL_WALL_PAGE);
    expect(ref.current?.get()).toMatchObject({ isLoading: false, hasMore: true, error: null });

    act(() => ref.current?.get().loadMore());
    await settle();
    expect(mockFetch).toHaveBeenLastCalledWith({ startIndex: CHANNEL_WALL_PAGE, limit: CHANNEL_WALL_PAGE, sortBy: "SortName" });
    expect(ref.current?.get().items).toHaveLength(total);
    expect(ref.current?.get()).toMatchObject({ isLoadingMore: false, hasMore: false });

    act(() => ref.current?.get().loadMore());
    await settle();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("starts over in the server's name order when the sort changes, dropping a page from the old sort", async () => {
    let releaseOld: (value: { items: unknown[]; total: number }) => void = () => {};
    mockFetch.mockImplementation(async ({ startIndex, sortBy }: { startIndex: number; sortBy: string }) => {
      if (sortBy === "SortName" && startIndex > 0) return new Promise((resolve) => (releaseOld = resolve));
      return { items: sortBy === "Name" ? channels(500, 2) : channels(startIndex, CHANNEL_WALL_PAGE), total: CHANNEL_WALL_PAGE * 3 };
    });
    const ref = React.createRef<HookRef>();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<Harness ref={ref} sort="number" />);
    });
    await settle();
    act(() => ref.current?.get().loadMore());
    await settle();

    await act(async () => renderer.update(<Harness ref={ref} sort="name" />));
    await settle();
    expect(mockFetch).toHaveBeenLastCalledWith({ startIndex: 0, limit: CHANNEL_WALL_PAGE, sortBy: "Name" });
    expect(ref.current?.get().items.map((item) => item.Id)).toEqual(["c500", "c501"]);

    await act(async () => releaseOld({ items: channels(CHANNEL_WALL_PAGE, CHANNEL_WALL_PAGE), total: CHANNEL_WALL_PAGE * 3 }));
    await settle();
    expect(ref.current?.get().items.map((item) => item.Id)).toEqual(["c500", "c501"]);
  });

  it("holds a failed page for a backoff that doubles, so the wall cannot ask for it again at once", async () => {
    jest.useFakeTimers();
    try {
      mockFetch.mockImplementation(async ({ startIndex }: { startIndex: number }) => {
        if (startIndex === 0) return { items: channels(0, CHANNEL_WALL_PAGE), total: CHANNEL_WALL_PAGE * 2 };
        throw new Error("down");
      });
      const ref = React.createRef<HookRef>();
      await act(async () => {
        TestRenderer.create(<Harness ref={ref} sort="number" />);
      });
      await settle();

      act(() => ref.current?.get().loadMore());
      await settle();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(ref.current?.get()).toMatchObject({ isLoadingMore: true, hasMore: true });
      act(() => ref.current?.get().loadMore());
      await settle();
      expect(mockFetch).toHaveBeenCalledTimes(2);

      await act(async () => jest.advanceTimersByTime(1_000));
      expect(ref.current?.get().isLoadingMore).toBe(false);
      act(() => ref.current?.get().loadMore());
      await settle();
      expect(mockFetch).toHaveBeenCalledTimes(3);
      await act(async () => jest.advanceTimersByTime(1_999));
      expect(ref.current?.get().isLoadingMore).toBe(true);
      await act(async () => jest.advanceTimersByTime(1));
      expect(ref.current?.get().isLoadingMore).toBe(false);

      mockFetch.mockResolvedValueOnce({ items: channels(CHANNEL_WALL_PAGE, CHANNEL_WALL_PAGE), total: CHANNEL_WALL_PAGE * 2 });
      act(() => ref.current?.get().loadMore());
      await settle();
      expect(ref.current?.get()).toMatchObject({ isLoadingMore: false, hasMore: false });
      expect(ref.current?.get().items).toHaveLength(CHANNEL_WALL_PAGE * 2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("reports a failed load and retries it", async () => {
    mockFetch.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ items: channels(0, 2), total: 2 });
    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} sort="number" />);
    });
    await settle();
    expect(ref.current?.get()).toMatchObject({ isLoading: false, error: "down", items: [] });

    act(() => ref.current?.get().retry());
    await settle();
    expect(ref.current?.get()).toMatchObject({ isLoading: false, error: null, hasMore: false });
    expect(ref.current?.get().items).toHaveLength(2);
  });
});
