/** useChannels: the first page on mount, the next on loadMore while the server has more, a failed load retried. */
import { useChannels } from "@/hooks/useChannels";
import { GUIDE_CHANNEL_PAGE } from "@/hooks/useGuide";
import { fetchChannels } from "@/services/jellyfinApi";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/jellyfinApi", () => ({ fetchChannels: jest.fn() }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

const mockFetch = fetchChannels as jest.Mock;
type Hook = ReturnType<typeof useChannels>;
type HookRef = { get: () => Hook };

const Harness = forwardRef<HookRef, object>((_props, ref) => {
  const result = useChannels();
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

  it("loads the first page, then the next on loadMore until the server's total is reached", async () => {
    const total = GUIDE_CHANNEL_PAGE + 3;
    mockFetch.mockImplementation(async ({ startIndex }: { startIndex: number }) => ({ items: channels(startIndex, Math.min(GUIDE_CHANNEL_PAGE, total - startIndex)), total }));
    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} />);
    });
    await settle();
    expect(mockFetch).toHaveBeenCalledWith({ startIndex: 0, limit: GUIDE_CHANNEL_PAGE });
    expect(ref.current?.get().items).toHaveLength(GUIDE_CHANNEL_PAGE);
    expect(ref.current?.get()).toMatchObject({ isLoading: false, hasMore: true, error: null });

    act(() => ref.current?.get().loadMore());
    await settle();
    expect(mockFetch).toHaveBeenLastCalledWith({ startIndex: GUIDE_CHANNEL_PAGE, limit: GUIDE_CHANNEL_PAGE });
    expect(ref.current?.get().items).toHaveLength(total);
    expect(ref.current?.get()).toMatchObject({ isLoadingMore: false, hasMore: false });

    act(() => ref.current?.get().loadMore());
    await settle();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("reports a failed load and retries it", async () => {
    mockFetch.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ items: channels(0, 2), total: 2 });
    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} />);
    });
    await settle();
    expect(ref.current?.get()).toMatchObject({ isLoading: false, error: "down", items: [] });

    act(() => ref.current?.get().retry());
    await settle();
    expect(ref.current?.get()).toMatchObject({ isLoading: false, error: null, hasMore: false });
    expect(ref.current?.get().items).toHaveLength(2);
  });
});
