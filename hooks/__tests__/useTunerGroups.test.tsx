/** useTunerGroups and usePlaylistChannelIds: loading, the named group's ids, and the dead-filter reset. */
import { usePlaylistChannelIds, useTunerGroups } from "@/hooks/useTunerGroups";
import { fetchTunerGroups } from "@/services/jellyfinApi";
import { updateLiveTvPreferences, type ChannelFilter } from "@/services/liveTvPreferences";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

let mockLastKnown: { groups: { name: string; channelIds: string[] }[]; complete: boolean } | null = null;
const mockAuthListeners = new Set<() => void>();
jest.mock("@/services/jellyfinApi", () => ({
  fetchTunerGroups: jest.fn(),
  lastKnownTunerData: () => mockLastKnown,
  subscribeAuthChange: (cb: () => void) => {
    mockAuthListeners.add(cb);
    return () => mockAuthListeners.delete(cb);
  },
}));
jest.mock("@/services/liveTvPreferences", () => ({
  activePlaylistGroup: (filter: string) => (filter.startsWith("playlist:") ? filter.slice("playlist:".length) : null),
  updateLiveTvPreferences: jest.fn(),
}));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

const mockFetch = fetchTunerGroups as jest.Mock;
type Ids = ReturnType<typeof usePlaylistChannelIds>;
type HookRef = { ids: () => Ids; groups: () => ReturnType<typeof useTunerGroups> };

const Harness = forwardRef<HookRef, { filter: ChannelFilter }>(({ filter }, ref) => {
  const groups = useTunerGroups();
  const ids = usePlaylistChannelIds(filter);
  useImperativeHandle(ref, () => ({ ids: () => ids, groups: () => groups }), [ids, groups]);
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

describe("usePlaylistChannelIds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLastKnown = null;
  });

  it("is loading until the groups arrive, then the named group's ids", async () => {
    let release: (groups: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} filter="playlist:News" />);
    });
    expect(ref.current?.ids()).toBe("loading");
    await act(async () => release([{ name: "News", channelIds: ["a", "b"] }]));
    await settle();
    expect(ref.current?.ids()).toEqual(["a", "b"]);
    expect(updateLiveTvPreferences).not.toHaveBeenCalled();
  });

  it("a sign-in elsewhere waits for the new server's groups, then reads them", async () => {
    mockLastKnown = { groups: [{ name: "News", channelIds: ["a"] }], complete: true };
    mockFetch.mockResolvedValue([{ name: "News", channelIds: ["a"] }]);
    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} filter="playlist:News" />);
    });
    await settle();
    expect(ref.current?.ids()).toEqual(["a"]);

    // The switch forgot the tuner cache; the last server's ids must not answer meanwhile.
    mockLastKnown = null;
    let release: (groups: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => (release = resolve)));
    await act(async () => mockAuthListeners.forEach((cb) => cb()));
    expect(ref.current?.ids()).toBe("loading");
    await act(async () => release([{ name: "News", channelIds: ["z"] }]));
    await settle();
    expect(ref.current?.ids()).toEqual(["z"]);
  });

  it("is null for a non-playlist filter and never resets it", async () => {
    mockFetch.mockResolvedValue([]);
    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} filter="all" />);
    });
    await settle();
    expect(ref.current?.ids()).toBeNull();
    expect(updateLiveTvPreferences).not.toHaveBeenCalled();
  });

  it("resets a filter whose group a successful load does not name", async () => {
    mockLastKnown = { groups: [{ name: "Kids", channelIds: ["k"] }], complete: true };
    mockFetch.mockResolvedValue([{ name: "Kids", channelIds: ["k"] }]);
    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} filter="playlist:Gone" />);
    });
    await settle();
    expect(updateLiveTvPreferences).toHaveBeenCalledWith({ filter: "all" });
  });

  it("keeps the filter and shows no groups when the first read ever fails", async () => {
    mockFetch.mockRejectedValue(new Error("offline"));
    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} filter="playlist:News" />);
    });
    await settle();
    expect(ref.current?.groups()).toEqual([]);
    expect(ref.current?.ids()).toEqual([]);
    // Failure is not evidence the group is gone; the filter stays.
    expect(updateLiveTvPreferences).not.toHaveBeenCalled();
  });

  it("serves the last good groups when a refetch fails, and never resets the filter", async () => {
    mockLastKnown = { groups: [{ name: "News", channelIds: ["a"] }], complete: true };
    mockFetch.mockRejectedValue(new Error("offline"));
    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} filter="playlist:News" />);
    });
    await settle();
    expect(ref.current?.groups()).toEqual([{ name: "News", channelIds: ["a"] }]);
    expect(ref.current?.ids()).toEqual(["a"]);
    expect(updateLiveTvPreferences).not.toHaveBeenCalled();
  });

  it("keeps a filter a partial read does not name: the refusing tuner may still have it", async () => {
    mockLastKnown = { groups: [{ name: "Kids", channelIds: ["k"] }], complete: false };
    mockFetch.mockResolvedValue([{ name: "Kids", channelIds: ["k"] }]);
    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} filter="playlist:News" />);
    });
    await settle();
    expect(ref.current?.ids()).toEqual([]);
    expect(updateLiveTvPreferences).not.toHaveBeenCalled();
  });
});
