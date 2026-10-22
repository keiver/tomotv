/** useCategoryChannelIds: every category's ids for the sort, none for a failed read, read again on another sign-in. */
import { useCategoryChannelIds } from "@/hooks/useCategoryChannelIds";
import { fetchCategoryChannelIds } from "@/services/jellyfinApi";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockAuthListeners = new Set<() => void>();
jest.mock("@/services/jellyfinApi", () => ({
  fetchCategoryChannelIds: jest.fn(),
  subscribeAuthChange: (cb: () => void) => {
    mockAuthListeners.add(cb);
    return () => mockAuthListeners.delete(cb);
  },
}));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ sort: "number" }) }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

const mockFetch = fetchCategoryChannelIds as jest.Mock;
type HookRef = { get: () => ReturnType<typeof useCategoryChannelIds> };
const Harness = forwardRef<HookRef>((_props, ref) => {
  const ids = useCategoryChannelIds();
  useImperativeHandle(ref, () => ({ get: () => ids }), [ids]);
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

describe("useCategoryChannelIds", () => {
  beforeEach(() => mockFetch.mockReset());

  it("reads every category's ids in the sort's order, and a category whose read fails holds none", async () => {
    mockFetch.mockImplementation(async (category: string) => {
      if (category === "news") throw new Error("down");
      return category === "kids" ? ["k1"] : [];
    });
    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} />);
    });
    await settle();
    expect(mockFetch).toHaveBeenCalledWith("kids", "SortName");
    expect(ref.current!.get()).toEqual({ news: [], sports: [], kids: ["k1"], movie: [], series: [] });
  });

  it("reads again on another sign-in, holding none until it answers", async () => {
    mockFetch.mockResolvedValue(["k1"]);
    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} />);
    });
    await settle();
    const answers: ((ids: string[]) => void)[] = [];
    mockFetch.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    await act(async () => mockAuthListeners.forEach((cb) => cb()));
    expect(ref.current!.get()).toEqual({});
    await act(async () => answers.forEach((answer) => answer(["k2"])));
    await settle();
    expect(ref.current!.get().kids).toEqual(["k2"]);
  });
});
