/**
 * react-test-renderer through a null-rendering harness (the project's hook-testing pattern).
 */
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { fetchChannels, fetchGuidePrograms, fetchListedChannels, fetchTimers } from "@/services/jellyfinApi";
import { GUIDE_CHANNEL_PAGE, useGuide } from "../useGuide";
import { GUIDE_SPAN_MINUTES, MINUTE_MS } from "@/utils/guide";

jest.mock("@/services/jellyfinApi", () => ({
  fetchChannels: jest.fn(),
  fetchChannelsByIds: jest.fn(),
  fetchGuidePrograms: jest.fn(),
  fetchListedChannels: jest.fn(),
  fetchTimers: jest.fn(),
  fetchTunerGroups: jest.fn().mockResolvedValue([]),
  lastKnownTunerData: jest.fn(() => null),
}));
jest.mock("expo-router", () => ({ useIsFocused: () => true }));
jest.mock("@/services/jellyfin/tunerGroups", () => ({ fetchTunerData: jest.fn(async () => ({ groups: [], tvgById: {}, tvgUrls: [] })) }));
jest.mock("@/services/externalGuide", () => ({ fetchExternalPrograms: jest.fn(async () => []) }));
let mockPreferences = {
  version: 1,
  autoUpdate: true,
  filter: "all" as string,
  sort: "number",
  favorites: [] as { id?: string; number?: string; name: string }[],
  groups: [] as { id: string; name: string; channels: { number?: string; name: string }[] }[],
};
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => mockPreferences }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

type Hook = ReturnType<typeof useGuide>;
type HookRef = { get: () => Hook };

const Harness = forwardRef<HookRef, object>((_props, ref) => {
  const result = useGuide();
  useImperativeHandle(ref, () => ({ get: () => result }), [result]);
  return null;
});
Harness.displayName = "Harness";

/** Lets the chained awaits of a load (channels, programs, timers) settle. */
async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// Unmounted after each test: the hook's minute tick would otherwise keep the run alive.
let mounted: TestRenderer.ReactTestRenderer | null = null;
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
});

async function mount() {
  const ref = React.createRef<HookRef>();
  await act(async () => {
    mounted = TestRenderer.create(<Harness ref={ref} />);
  });
  await settle();
  return ref;
}

const channel = (n: number) => ({ Id: `c${n}`, Name: `Channel ${n}`, Type: "TvChannel", Path: "" });
const program = (id: string, channelId: string, startMin: number, endMin: number, base: number) => ({
  Id: id,
  Name: id,
  ChannelId: channelId,
  StartDate: new Date(base + startMin * MINUTE_MS).toISOString(),
  EndDate: new Date(base + endMin * MINUTE_MS).toISOString(),
});

describe("useGuide", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPreferences = { version: 1, autoUpdate: true, filter: "all", sort: "number", favorites: [], groups: [] };
    (fetchTimers as jest.Mock).mockResolvedValue([]);
  });

  it("held to favorites, fetches the listed channels in one page, asks programs for them alone, and never pages the catalog", async () => {
    mockPreferences = { ...mockPreferences, filter: "favorites", favorites: [{ id: "c2", name: "Channel 2" }, { name: "Channel 9" }] };
    (fetchListedChannels as jest.Mock).mockResolvedValue([channel(2), channel(9)]);
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ channelIds, startMs }: { channelIds: string[]; startMs: number }) => channelIds.map((id) => program(`${id}-p`, id, 0, 30, startMs)));

    const ref = await mount();
    expect(fetchListedChannels).toHaveBeenCalledWith([{ id: "c2", name: "Channel 2" }, { name: "Channel 9" }]);
    expect(fetchChannels).not.toHaveBeenCalled();
    expect(ref.current!.get().rows.map((row) => row.channel.Id)).toEqual(["c2", "c9"]);
    expect((fetchGuidePrograms as jest.Mock).mock.calls.map(([args]) => args.channelIds)).toEqual([["c2", "c9"]]);
    await act(async () => ref.current!.get().loadMoreRows());
    expect(fetchListedChannels).toHaveBeenCalledTimes(1);
  });

  it("held to a category, asks the server for that flag and keeps every row it returns", async () => {
    mockPreferences = { ...mockPreferences, filter: "category:kids" };
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(7)], total: 1 });
    (fetchGuidePrograms as jest.Mock).mockResolvedValue([]);
    const ref = await mount();
    expect((fetchChannels as jest.Mock).mock.calls[0][0]).toEqual({ startIndex: 0, limit: GUIDE_CHANNEL_PAGE, sortBy: "SortName", category: "kids" });
    expect(ref.current!.get().rows.map((row) => row.channel.Id)).toEqual(["c7"]);
  });

  it("held to a group, fetches the group's channels", async () => {
    mockPreferences = { ...mockPreferences, filter: "group:g1", groups: [{ id: "g1", name: "Mine", channels: [{ name: "Channel 4" }] }] };
    (fetchListedChannels as jest.Mock).mockResolvedValue([channel(4)]);
    (fetchGuidePrograms as jest.Mock).mockResolvedValue([]);
    const ref = await mount();
    expect(fetchListedChannels).toHaveBeenCalledWith([{ name: "Channel 4" }]);
    expect(ref.current!.get().rows.map((row) => row.channel.Id)).toEqual(["c4"]);
  });

  it("held to a playlist group, pages its ids in order and keeps paging past ids the server does not know", async () => {
    mockPreferences = { ...mockPreferences, filter: "playlist:News" };
    const { fetchChannelsByIds, fetchTunerGroups } = jest.requireMock("@/services/jellyfinApi") as { fetchChannelsByIds: jest.Mock; fetchTunerGroups: jest.Mock };
    const ids = Array.from({ length: GUIDE_CHANNEL_PAGE + 2 }, (_, index) => `p${index}`);
    fetchTunerGroups.mockResolvedValue([{ name: "News", channelIds: ids }]);
    // p0 never resolves; the page keeps its ids' order without it.
    fetchChannelsByIds.mockImplementation(async (slice: string[]) => slice.filter((id) => id !== "p0").map((id) => ({ Id: id, Name: id, Type: "TvChannel", Path: "" })));
    (fetchGuidePrograms as jest.Mock).mockResolvedValue([]);
    const ref = await mount();
    await settle();
    expect(fetchChannels).not.toHaveBeenCalled();
    expect(fetchChannelsByIds).toHaveBeenCalledWith(ids.slice(0, GUIDE_CHANNEL_PAGE));
    expect(ref.current!.get().rows.map((row) => row.channel.Id)).toEqual(ids.slice(1, GUIDE_CHANNEL_PAGE));
    act(() => ref.current!.get().loadMoreRows());
    await settle();
    expect(fetchChannelsByIds).toHaveBeenLastCalledWith(ids.slice(GUIDE_CHANNEL_PAGE));
    expect(ref.current!.get().rows.map((row) => row.channel.Id)).toEqual(ids.filter((id) => id !== "p0"));
  });

  it("falls back to the playlist-declared guide for channels the server has no programs for", async () => {
    const { fetchTunerData } = jest.requireMock("@/services/jellyfin/tunerGroups") as { fetchTunerData: jest.Mock };
    const { fetchExternalPrograms } = jest.requireMock("@/services/externalGuide") as { fetchExternalPrograms: jest.Mock };
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1), channel(2)], total: 2 });
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ startMs }: { startMs: number }) => [program("a", "c1", 0, 60, startMs)]);
    fetchTunerData.mockResolvedValue({ groups: [], tvgById: { c2: "B.us@SD" }, tvgUrls: ["http://g/auto.xml.gz"] });
    fetchExternalPrograms.mockImplementation(async (_url: string, wanted: { channelId: string }[], windowMs: { from: number }) =>
      wanted.map(({ channelId }) => program(`epg:${channelId}`, channelId, 0, 30, windowMs.from)),
    );
    const ref = await mount();
    // No guideUrl preference is set: the URL is the playlist's own, and only the bare channel is asked for.
    expect(fetchExternalPrograms).toHaveBeenCalledWith("http://g/auto.xml.gz", [{ channelId: "c2", tvgId: "B.us@SD" }], expect.anything());
    expect(ref.current!.get().rows[1].programs.map((p) => p.Id)).toEqual(["epg:c2"]);
  });

  it("loads the channels, the first page of programs and the timers", async () => {
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1), channel(2)], total: 2 });
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ startMs }: { startMs: number }) => [program("a", "c1", 0, 60, startMs), program("b", "c2", 30, 90, startMs)]);
    (fetchTimers as jest.Mock).mockResolvedValue([{ Id: "t1", Name: "a", ProgramId: "a", StartDate: "", EndDate: "", Status: "New" }]);

    const ref = await mount();
    const state = ref.current!.get();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.rows.map((row) => row.channel.Id)).toEqual(["c1", "c2"]);
    expect(state.rows[0].programs.map((p) => p.Id)).toEqual(["a"]);
    expect(state.rows[1].programs.map((p) => p.Id)).toEqual(["b"]);
    expect(state.windowEndMs - state.windowStartMs).toBe(GUIDE_SPAN_MINUTES * MINUTE_MS);
    expect(state.windowStartMs % (30 * MINUTE_MS)).toBe(0);
    expect(state.timersByProgramId.get("a")?.Id).toBe("t1");

    const [{ channelIds, startMs, endMs }] = (fetchGuidePrograms as jest.Mock).mock.calls[0];
    expect(channelIds).toEqual(["c1", "c2"]);
    expect(endMs - startMs).toBe(GUIDE_SPAN_MINUTES * MINUTE_MS);
    expect((fetchChannels as jest.Mock).mock.calls[0][0]).toEqual({ startIndex: 0, limit: GUIDE_CHANNEL_PAGE, sortBy: "SortName" });
    // The server has no more channels, so nearing the bottom asks for nothing.
    await act(async () => {
      ref.current!.get().loadMoreRows();
    });
    await settle();
    expect(fetchChannels).toHaveBeenCalledTimes(1);
  });

  it("pages channels with their programs and grows the window on request, merging programs without duplicates", async () => {
    const many = Array.from({ length: GUIDE_CHANNEL_PAGE + 5 }, (_, i) => channel(i + 1));
    (fetchChannels as jest.Mock).mockImplementation(async ({ startIndex, limit }: { startIndex: number; limit: number }) => ({
      items: many.slice(startIndex, startIndex + limit),
      total: many.length,
    }));
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ channelIds, startMs }: { channelIds: string[]; startMs: number }) =>
      channelIds.map((id) => program(`${id}-${startMs}`, id, 0, 30, startMs)),
    );

    const ref = await mount();
    expect((fetchGuidePrograms as jest.Mock).mock.calls[0][0].channelIds).toHaveLength(GUIDE_CHANNEL_PAGE);
    expect(ref.current!.get().rows).toHaveLength(GUIDE_CHANNEL_PAGE);

    await act(async () => {
      ref.current!.get().loadMoreRows();
    });
    await settle();
    expect((fetchChannels as jest.Mock).mock.calls[1][0]).toEqual({ startIndex: GUIDE_CHANNEL_PAGE, limit: GUIDE_CHANNEL_PAGE, sortBy: "SortName" });
    expect(ref.current!.get().rows).toHaveLength(many.length);
    expect(ref.current!.get().rows[GUIDE_CHANNEL_PAGE].programs).toHaveLength(1);
    expect((fetchGuidePrograms as jest.Mock).mock.calls[1][0].channelIds).toEqual(many.slice(GUIDE_CHANNEL_PAGE).map((c) => c.Id));

    // Every channel is loaded: a further request is a no-op.
    await act(async () => {
      ref.current!.get().loadMoreRows();
    });
    await settle();
    expect(fetchChannels).toHaveBeenCalledTimes(2);

    const endBefore = ref.current!.get().windowEndMs;
    await act(async () => {
      ref.current!.get().extendWindow();
    });
    await settle();
    expect(ref.current!.get().windowEndMs).toBe(endBefore + GUIDE_SPAN_MINUTES * MINUTE_MS);
    const extension = (fetchGuidePrograms as jest.Mock).mock.calls[2][0];
    expect(extension.startMs).toBe(endBefore);
    expect(extension.channelIds).toHaveLength(many.length);
    expect(ref.current!.get().rows[0].programs).toHaveLength(2);
  });

  /** Channels 1..count in pages, with the page at `heldStart` held until the returned release runs. */
  function pagedChannels(count: number, heldStart: number) {
    const many = Array.from({ length: count }, (_, i) => channel(i + 1));
    let release: () => void = () => {};
    let held = false;
    (fetchChannels as jest.Mock).mockImplementation(async ({ startIndex, limit }: { startIndex: number; limit: number }) => {
      if (startIndex === heldStart && !held) {
        held = true;
        await new Promise<void>((resolve) => (release = resolve));
      }
      return { items: many.slice(startIndex, startIndex + limit), total: many.length };
    });
    (fetchGuidePrograms as jest.Mock).mockResolvedValue([]);
    return () => release();
  }

  async function changePreferences(ref: React.RefObject<HookRef | null>, patch: Partial<typeof mockPreferences>) {
    mockPreferences = { ...mockPreferences, ...patch };
    await act(async () => mounted!.update(<Harness ref={ref} />));
    await settle();
  }

  it("keeps paging after the sort changes under a page still loading", async () => {
    const release = pagedChannels(3 * GUIDE_CHANNEL_PAGE, GUIDE_CHANNEL_PAGE);
    const ref = await mount();
    await act(async () => ref.current!.get().loadMoreRows());
    await changePreferences(ref, { sort: "name" });
    await act(async () => release());
    await settle();
    // The superseded page lands nowhere and holds nothing: the new list pages from its own start.
    expect(ref.current!.get().rows).toHaveLength(GUIDE_CHANNEL_PAGE);
    await act(async () => ref.current!.get().loadMoreRows());
    await settle();
    expect(ref.current!.get().rows).toHaveLength(2 * GUIDE_CHANNEL_PAGE);
    expect((fetchChannels as jest.Mock).mock.calls.at(-1)![0]).toEqual({ startIndex: GUIDE_CHANNEL_PAGE, limit: GUIDE_CHANNEL_PAGE, sortBy: "Name" });
  });

  it("held to favorites, a favorite added reloads the list with it", async () => {
    mockPreferences = { ...mockPreferences, filter: "favorites", favorites: [{ name: "Channel 2" }] };
    (fetchListedChannels as jest.Mock).mockImplementation(async (list: { name: string }[]) => list.map((entry) => channel(Number(entry.name.split(" ")[1]))));
    (fetchGuidePrograms as jest.Mock).mockResolvedValue([]);
    const ref = await mount();
    await changePreferences(ref, { favorites: [...mockPreferences.favorites, { name: "Channel 3" }] });
    expect(ref.current!.get().rows.map((row) => row.channel.Name)).toEqual(["Channel 2", "Channel 3"]);
  });

  it("drops a window extension that finishes after the list reloaded, and extends again after it", async () => {
    pagedChannels(GUIDE_CHANNEL_PAGE, -1);
    let finishExtension: () => void = () => {};
    const ref = await mount();
    const endBefore = ref.current!.get().windowEndMs;
    (fetchGuidePrograms as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => (finishExtension = () => resolve([]))));
    await act(async () => ref.current!.get().extendWindow());
    await changePreferences(ref, { sort: "name" });
    await act(async () => finishExtension());
    await settle();
    // The reloaded rows hold programs up to the old edge only.
    expect(ref.current!.get().windowEndMs).toBe(endBefore);
    await act(async () => ref.current!.get().extendWindow());
    await settle();
    expect(ref.current!.get().windowEndMs).toBe(endBefore + GUIDE_SPAN_MINUTES * MINUTE_MS);
  });

  it("does not reload when a preference it does not read changes", async () => {
    mockPreferences = { ...mockPreferences, filter: "favorites", favorites: [{ name: "Channel 1" }] };
    pagedChannels(2, -1);
    const ref = await mount();
    const calls = (fetchChannels as jest.Mock).mock.calls.length;
    await changePreferences(ref, { autoUpdate: false });
    expect(fetchChannels).toHaveBeenCalledTimes(calls);
  });

  it("reports a failed load and retries on request", async () => {
    (fetchChannels as jest.Mock).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ items: [channel(1)], total: 1 });
    (fetchGuidePrograms as jest.Mock).mockResolvedValue([]);
    const ref = await mount();
    expect(ref.current!.get().error).toBe("offline");
    expect(ref.current!.get().isLoading).toBe(false);
    await act(async () => {
      ref.current!.get().retry();
    });
    await settle();
    expect(ref.current!.get().rows).toHaveLength(1);
    expect(ref.current!.get().error).toBeNull();
  });
});
