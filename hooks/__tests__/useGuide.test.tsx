/**
 * react-test-renderer through a null-rendering harness (the project's hook-testing pattern).
 */
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { AppState, type AppStateStatus } from "react-native";
import { fetchChannels, fetchGuidePrograms, fetchListedChannels, fetchTimers } from "@/services/jellyfinApi";
import { GUIDE_CHANNEL_PAGE, useGuide } from "../useGuide";
import { GUIDE_HORIZON_MINUTES, GUIDE_SPAN_MINUTES, MINUTE_MS } from "@/utils/guide";
import { noteChannelAlive, noteChannelOpenFailure } from "@/services/channelHealth";

jest.mock("@/services/jellyfinApi", () => ({
  fetchChannels: jest.fn(),
  fetchChannelsByIds: jest.fn(),
  fetchGuidePrograms: jest.fn(),
  fetchListedChannels: jest.fn(),
  fetchTimers: jest.fn(),
  fetchTunerGroups: jest.fn().mockResolvedValue([]),
  lastKnownTunerData: jest.fn(() => null),
  subscribeAuthChange: (cb: () => void) => {
    mockAuthListeners.add(cb);
    return () => mockAuthListeners.delete(cb);
  },
}));
const mockAuthListeners = new Set<() => void>();
jest.mock("expo-router", () => ({ useIsFocused: () => true }));
jest.mock("@/services/jellyfin/tunerGroups", () => ({ fetchTunerData: jest.fn(async () => ({ groups: [], tvgById: {}, tvgNameById: {}, tvgUrls: [] })) }));
jest.mock("@/services/externalGuide", () => {
  const fetchExternalPrograms = jest.fn();
  fetchExternalPrograms.mockResolvedValue([]);
  return {
    fetchExternalPrograms,
    fetchExternalProgramWindow: jest.fn(async (...args: unknown[]) => ({ programs: await fetchExternalPrograms(...args), failedChannelIds: [] })),
    activeGuideUrls: jest.requireActual("@/services/externalGuide").activeGuideUrls,
  };
});
let mockPreferences = {
  version: 1,
  autoUpdate: true,
  filter: "all" as string,
  sort: "number",
  favorites: [] as { id?: string; number?: string; name: string }[],
  groups: [] as { id: string; name: string; channels: { number?: string; name: string }[] }[],
  hideOffline: false,
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
    mockPreferences = { version: 1, autoUpdate: true, filter: "all", sort: "number", favorites: [], groups: [], hideOffline: false };
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

  it("a sign-in elsewhere drops the last server's rows and programs before the new server's land", async () => {
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1)], total: 1 });
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ startMs }: { startMs: number }) => [program("old", "c1", 0, 30, startMs)]);
    const ref = await mount();
    expect(ref.current!.get().rows[0].programs.map((p) => p.Id)).toEqual(["old"]);

    // The next server reuses the channel id; its programs must not merge into the last one's.
    (fetchChannels as jest.Mock).mockReturnValue(new Promise(() => {}));
    await act(async () => mockAuthListeners.forEach((cb) => cb()));
    expect(ref.current!.get().rows).toEqual([]);
    expect(ref.current!.get().isLoading).toBe(true);

    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1)], total: 1 });
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ startMs }: { startMs: number }) => [program("new", "c1", 0, 30, startMs)]);
    await act(async () => mockAuthListeners.forEach((cb) => cb()));
    await settle();
    expect(ref.current!.get().rows[0].programs.map((p) => p.Id)).toEqual(["new"]);
  });

  it("drops the last sign-in's timers when they land after the switch", async () => {
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1)], total: 1 });
    (fetchGuidePrograms as jest.Mock).mockResolvedValue([]);
    let landOld: (timers: unknown[]) => void = () => {};
    (fetchTimers as jest.Mock).mockReturnValueOnce(new Promise((resolve) => (landOld = resolve)));
    const ref = await mount();

    await act(async () => mockAuthListeners.forEach((cb) => cb()));
    await settle();
    await act(async () => landOld([{ Id: "t-old", Name: "a", ProgramId: "a", StartDate: "", EndDate: "", Status: "New" }]));
    expect(ref.current!.get().timersByProgramId.size).toBe(0);
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
    fetchTunerData.mockResolvedValue({ groups: [], tvgById: { c2: "B.us@SD" }, tvgNameById: {}, tvgUrls: ["http://g/auto.xml.gz"] });
    fetchExternalPrograms.mockImplementation(async (_urls: string[], wanted: { channelId: string }[], windowMs: { from: number }) =>
      wanted.map(({ channelId }) => program(`epg:${channelId}`, channelId, 0, 30, windowMs.from)),
    );
    const ref = await mount();
    // No guide of the viewer's own: the playlist's declared one is asked, for the bare channel alone.
    expect(fetchExternalPrograms).toHaveBeenCalledWith(["http://g/auto.xml.gz"], [{ channelId: "c2", tvgId: "B.us@SD", tvgName: undefined, name: "Channel 2" }], expect.anything());
    expect(ref.current!.get().rows[1].programs.map((p) => p.Id)).toEqual(["epg:c2"]);
  });

  it("asks the viewer's guides by name when no tuner playlist answers", async () => {
    const { fetchTunerData } = jest.requireMock("@/services/jellyfin/tunerGroups") as { fetchTunerData: jest.Mock };
    const { fetchExternalPrograms } = jest.requireMock("@/services/externalGuide") as { fetchExternalPrograms: jest.Mock };
    const { updateLiveTvPreferences } = jest.requireActual("@/services/liveTvPreferences") as typeof import("@/services/liveTvPreferences");
    updateLiveTvPreferences({ guideUrls: ["http://mine/guide.xml"] });
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1)], total: 1 });
    (fetchGuidePrograms as jest.Mock).mockResolvedValue([]);
    fetchTunerData.mockRejectedValueOnce(new Error("403"));
    await mount();
    expect(fetchExternalPrograms).toHaveBeenCalledWith(["http://mine/guide.xml"], [{ channelId: "c1", tvgId: undefined, tvgName: undefined, name: "Channel 1" }], expect.anything());
    updateLiveTvPreferences({ guideUrls: [] });
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
      ref.current!.get().holdWindow(ref.current!.get().windowStartMs, endBefore + 1);
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
    await act(async () => ref.current!.get().holdWindow(ref.current!.get().windowStartMs, endBefore + 1));
    await changePreferences(ref, { sort: "name" });
    await act(async () => finishExtension());
    await settle();
    // The reloaded rows hold programs up to the old edge only.
    expect(ref.current!.get().windowEndMs).toBe(endBefore);
    await act(async () => ref.current!.get().holdWindow(ref.current!.get().windowStartMs, endBefore + 1));
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

  it("a guide source turned off takes its listings off the rows", async () => {
    const { fetchTunerData } = jest.requireMock("@/services/jellyfin/tunerGroups") as { fetchTunerData: jest.Mock };
    const { fetchExternalPrograms } = jest.requireMock("@/services/externalGuide") as { fetchExternalPrograms: jest.Mock };
    const { updateLiveTvPreferences } = jest.requireActual("@/services/liveTvPreferences") as typeof import("@/services/liveTvPreferences");
    const url = "http://g/auto.xml.gz";
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1), channel(2)], total: 2 });
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ startMs }: { startMs: number }) => [program("a", "c1", 0, 60, startMs)]);
    fetchTunerData.mockResolvedValue({ groups: [], tvgById: { c2: "B.us@SD" }, tvgNameById: {}, tvgUrls: [url] });
    fetchExternalPrograms.mockImplementation(async (_urls: string[], wanted: { channelId: string }[], windowMs: { from: number }) =>
      wanted.map(({ channelId }) => program(`epg:${channelId}`, channelId, 0, 30, windowMs.from)),
    );
    const ref = await mount();
    expect(ref.current!.get().rows[1].programs.map((p) => p.Id)).toEqual(["epg:c2"]);
    updateLiveTvPreferences({ guideSourcesOff: [url] });
    await changePreferences(ref, { guideSourcesOff: [url] } as Partial<typeof mockPreferences>);
    expect(ref.current!.get().rows[0].programs.map((p) => p.Id)).toEqual(["a"]);
    expect(ref.current!.get().rows[1].programs).toEqual([]);
    updateLiveTvPreferences({ guideSourcesOff: [] });
  });

  it("a guide request still loading when its source is turned off lands without that source's listings", async () => {
    const { fetchTunerData } = jest.requireMock("@/services/jellyfin/tunerGroups") as { fetchTunerData: jest.Mock };
    const { fetchExternalPrograms } = jest.requireMock("@/services/externalGuide") as { fetchExternalPrograms: jest.Mock };
    const { updateLiveTvPreferences } = jest.requireActual("@/services/liveTvPreferences") as typeof import("@/services/liveTvPreferences");
    const url = "http://g/auto.xml.gz";
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1), channel(2)], total: 2 });
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ startMs }: { startMs: number }) => [program("a", "c1", 0, 60, startMs)]);
    fetchTunerData.mockResolvedValue({ groups: [], tvgById: { c2: "B.us@SD" }, tvgNameById: {}, tvgUrls: [url] });
    let land!: () => void;
    fetchExternalPrograms.mockImplementationOnce(
      (_urls: string[], wanted: { channelId: string }[], windowMs: { from: number }) =>
        new Promise((resolve) => (land = () => resolve(wanted.map(({ channelId }) => program(`epg:${channelId}`, channelId, 0, 30, windowMs.from))))),
    );
    const ref = await mount();
    updateLiveTvPreferences({ guideSourcesOff: [url] });
    await changePreferences(ref, { guideSourcesOff: [url] } as Partial<typeof mockPreferences>);
    await act(async () => land());
    await settle();
    expect(ref.current!.get().rows[0].programs.map((p) => p.Id)).toEqual(["a"]);
    expect(ref.current!.get().rows[1].programs).toEqual([]);
    updateLiveTvPreferences({ guideSourcesOff: [] });
  });

  it("keeps the window edge when a guide source change drops an extension, and extends from it after", async () => {
    const { fetchTunerData } = jest.requireMock("@/services/jellyfin/tunerGroups") as { fetchTunerData: jest.Mock };
    const { fetchExternalPrograms } = jest.requireMock("@/services/externalGuide") as { fetchExternalPrograms: jest.Mock };
    const { updateLiveTvPreferences } = jest.requireActual("@/services/liveTvPreferences") as typeof import("@/services/liveTvPreferences");
    const url = "http://g/auto.xml.gz";
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1), channel(2)], total: 2 });
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ startMs }: { startMs: number }) => [program(`a-${startMs}`, "c1", 0, 60, startMs)]);
    fetchTunerData.mockResolvedValue({ groups: [], tvgById: { c2: "B.us@SD" }, tvgNameById: {}, tvgUrls: [url] });
    fetchExternalPrograms.mockImplementation(async (_urls: string[], wanted: { channelId: string }[], windowMs: { from: number }) =>
      wanted.map(({ channelId }) => program(`epg:${channelId}`, channelId, 0, 30, windowMs.from)),
    );
    const ref = await mount();
    const endBefore = ref.current!.get().windowEndMs;
    let land!: () => void;
    fetchExternalPrograms.mockImplementationOnce(() => new Promise((resolve) => (land = () => resolve([]))));
    await act(async () => ref.current!.get().holdWindow(ref.current!.get().windowStartMs, endBefore + 1));
    await settle();
    try {
      updateLiveTvPreferences({ guideSourcesOff: [url] });
      await changePreferences(ref, { guideSourcesOff: [url] } as Partial<typeof mockPreferences>);
      await act(async () => land());
      await settle();
      // The source change's reload reaches the old edge only; the dropped extension must not move it.
      expect(ref.current!.get().windowEndMs).toBe(endBefore);
      await act(async () => ref.current!.get().holdWindow(ref.current!.get().windowStartMs, endBefore + 1));
      await settle();
      expect(ref.current!.get().windowEndMs).toBe(endBefore + GUIDE_SPAN_MINUTES * MINUTE_MS);
      expect((fetchGuidePrograms as jest.Mock).mock.calls.at(-1)![0].startMs).toBe(endBefore);
    } finally {
      updateLiveTvPreferences({ guideSourcesOff: [] });
    }
  });

  it("a channel's health verdict leaves the rows untouched while Hide offline is off, and drops a down channel once it is on", async () => {
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(41), channel(42)], total: 2 });
    (fetchGuidePrograms as jest.Mock).mockResolvedValue([]);
    const ref = await mount();
    const rows = ref.current!.get().rows;
    await act(async () => {
      noteChannelAlive("c41");
      noteChannelOpenFailure("c42", "HTTP 404");
      noteChannelOpenFailure("c42", "HTTP 404");
    });
    expect(ref.current!.get().rows).toBe(rows);

    await changePreferences(ref, { hideOffline: true });
    expect(ref.current!.get().rows.map((row) => row.channel.Id)).toEqual(["c41"]);
    await act(async () => noteChannelAlive("c42"));
    expect(ref.current!.get().rows.map((row) => row.channel.Id)).toEqual(["c41", "c42"]);
  });

  it("a row whose programmes have not landed keeps one programme list across a rows rebuild", async () => {
    mockPreferences = { ...mockPreferences, hideOffline: true };
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(51), channel(52)], total: 2 });
    (fetchGuidePrograms as jest.Mock).mockReturnValue(new Promise(() => {}));
    const ref = await mount();
    const before = ref.current!.get().rows;
    expect(before.map((row) => row.programs)).toEqual([[], []]);
    await act(async () => noteChannelAlive("c52"));
    const after = ref.current!.get().rows;
    expect(after).not.toBe(before);
    expect(after[0].programs).toBe(before[0].programs);
  });

  it("replaces every requested channel on refresh, including empty responses and removed tails", async () => {
    const { fetchTunerData } = jest.requireMock("@/services/jellyfin/tunerGroups") as { fetchTunerData: jest.Mock };
    fetchTunerData.mockResolvedValue({ groups: [], tvgById: {}, tvgNameById: {}, tvgUrls: [] });
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1), channel(2)], total: 2 });
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ startMs }: { startMs: number }) => [
      program("a", "c1", 0, 30, startMs),
      program("tail", "c1", 30, 60, startMs),
      program("b", "c2", 0, 30, startMs),
    ]);
    const ref = await mount();
    expect(ref.current!.get().rows.map((row) => row.programs.length)).toEqual([2, 1]);
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ startMs }: { startMs: number }) => [program("a", "c1", 0, 30, startMs)]);
    await act(async () => ref.current!.get().retry());
    await settle();
    expect(ref.current!.get().rows.map((row) => row.programs.map((p) => p.Id))).toEqual([["a"], []]);
    (fetchGuidePrograms as jest.Mock).mockResolvedValue([]);
    await act(async () => ref.current!.get().retry());
    await settle();
    expect(ref.current!.get().rows.map((row) => row.programs)).toEqual([[], []]);
  });

  it("preserves failed external channels while applying successful server and empty external refreshes", async () => {
    const { fetchTunerData } = jest.requireMock("@/services/jellyfin/tunerGroups") as { fetchTunerData: jest.Mock };
    const { fetchExternalProgramWindow } = jest.requireMock("@/services/externalGuide") as { fetchExternalProgramWindow: jest.Mock };
    fetchTunerData.mockResolvedValue({ groups: [], tvgById: {}, tvgNameById: {}, tvgUrls: ["http://g/refresh.xml"] });
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1), channel(2), channel(3)], total: 3 });
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ startMs }: { startMs: number }) => [program("old-server", "c1", 0, 30, startMs)]);
    fetchExternalProgramWindow.mockImplementationOnce(async (_urls: string[], _wanted: unknown, window: { from: number }) => ({
      programs: [program("epg:c2", "c2", 0, 30, window.from), program("epg:c3", "c3", 0, 30, window.from)],
      failedChannelIds: [],
    }));
    const ref = await mount();
    expect(ref.current!.get().rows.map((row) => row.programs.map((p) => p.Id))).toEqual([["old-server"], ["epg:c2"], ["epg:c3"]]);
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ startMs }: { startMs: number }) => [program("new-server", "c1", 0, 30, startMs)]);
    fetchExternalProgramWindow.mockResolvedValueOnce({ programs: [], failedChannelIds: ["c2"] });
    await act(async () => ref.current!.get().retry());
    await settle();
    expect(ref.current!.get().rows.map((row) => row.programs.map((p) => p.Id))).toEqual([["new-server"], ["epg:c2"], []]);
    fetchExternalProgramWindow.mockResolvedValueOnce({ programs: [], failedChannelIds: [] });
    await act(async () => ref.current!.get().retry());
    await settle();
    expect(ref.current!.get().rows.map((row) => row.programs.map((p) => p.Id))).toEqual([["new-server"], [], []]);
  });

  describe("window", () => {
    const span = GUIDE_SPAN_MINUTES * MINUTE_MS;
    /** One programme per channel at the head of every stretch fetched, named by channel and stretch start. */
    const listEveryStretch = () =>
      (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ channelIds, startMs }: { channelIds: string[]; startMs: number }) =>
        channelIds.map((id) => program(`${id}-${startMs}`, id, 0, 30, startMs)),
      );
    /** Asks for spans 1..last in turn, twice each: the canvas asks again once a stretch has landed. */
    async function walkRight(ref: React.RefObject<HookRef | null>, last: number) {
      const start = ref.current!.get().windowStartMs;
      for (let k = 1; k <= last; k++) {
        await act(async () => ref.current!.get().holdWindow(start + k * span, start + (k + 1) * span));
        await settle();
        await act(async () => ref.current!.get().holdWindow(start + k * span, start + (k + 1) * span));
      }
      return start;
    }
    const lastFetch = () => (fetchGuidePrograms as jest.Mock).mock.calls.at(-1)![0] as { channelIds: string[]; startMs: number; endMs: number };

    it("loads toward the stretch asked for and lets go of the listings two spans behind it", async () => {
      (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1)], total: 1 });
      listEveryStretch();
      const ref = await mount();
      const start = await walkRight(ref, 5);
      expect(ref.current!.get().windowEndMs).toBe(start + 6 * span);
      expect(ref.current!.get().rows[0].programs.map((p) => p.Id)).toEqual([3, 4, 5].map((k) => `c1-${start + k * span}`));
    });

    it("a channel whose listings end behind the loaded stretch keeps its last programme, so its row never reads as one without listings", async () => {
      (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1), channel(2)], total: 2 });
      const { fetchTunerData } = jest.requireMock("@/services/jellyfin/tunerGroups") as { fetchTunerData: jest.Mock };
      fetchTunerData.mockResolvedValue({ groups: [], tvgById: {}, tvgNameById: {}, tvgUrls: [] });
      // Channel 2 has listings in the first two spans only; the first fetch opens on the window's start.
      let origin: number | undefined;
      (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ channelIds, startMs }: { channelIds: string[]; startMs: number }) => {
        origin ??= startMs;
        const early = startMs < origin + 2 * span;
        return channelIds.filter((id) => id === "c1" || early).map((id) => program(`${id}-${startMs}`, id, 0, 30, startMs));
      });
      const ref = await mount();
      const start = await walkRight(ref, 5);
      expect(ref.current!.get().rows[1].programs.map((p) => p.Id)).toEqual([`c2-${start + span}`]);
    });

    it("going back reloads the span it let go, and after a jump loads the stretch asked for alone", async () => {
      (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1)], total: 1 });
      listEveryStretch();
      const ref = await mount();
      const start = await walkRight(ref, 5);
      await act(async () => ref.current!.get().holdWindow(start + 2.5 * span, start + 3.5 * span));
      await settle();
      expect(lastFetch()).toMatchObject({ startMs: start + 2 * span, endMs: start + 3 * span });
      expect(ref.current!.get().rows[0].programs.map((p) => p.Id)).toEqual([2, 3, 4, 5].map((k) => `c1-${start + k * span}`));

      await act(async () => ref.current!.get().holdWindow(start, start + span));
      await settle();
      expect(lastFetch()).toMatchObject({ startMs: start, endMs: start + span });
      expect(ref.current!.get().windowEndMs).toBe(start + span);
      expect(ref.current!.get().rows[0].programs.map((p) => p.Id)).toEqual([`c1-${start}`]);
    });

    it("ends two days out: a stretch crossing the horizon loads up to it, one past it loads nothing", async () => {
      (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1)], total: 1 });
      listEveryStretch();
      const ref = await mount();
      const start = await walkRight(ref, 6);
      const horizon = start + GUIDE_HORIZON_MINUTES * MINUTE_MS;
      expect(GUIDE_HORIZON_MINUTES).toBe(48 * 60);
      await act(async () => ref.current!.get().holdWindow(horizon - span / 2, horizon + span));
      await settle();
      expect(lastFetch()).toMatchObject({ startMs: horizon - span, endMs: horizon });
      expect(ref.current!.get().windowEndMs).toBe(horizon);

      const asked = (fetchGuidePrograms as jest.Mock).mock.calls.length;
      await act(async () => ref.current!.get().holdWindow(horizon + span, horizon + 2 * span));
      await settle();
      expect((fetchGuidePrograms as jest.Mock).mock.calls).toHaveLength(asked);
      expect(ref.current!.get().windowEndMs).toBe(horizon);
    });

    it("a page loaded after a trim asks listings for the loaded stretch alone", async () => {
      const many = Array.from({ length: GUIDE_CHANNEL_PAGE + 1 }, (_, i) => channel(i + 1));
      (fetchChannels as jest.Mock).mockImplementation(async ({ startIndex, limit }: { startIndex: number; limit: number }) => ({
        items: many.slice(startIndex, startIndex + limit),
        total: many.length,
      }));
      listEveryStretch();
      const ref = await mount();
      const start = await walkRight(ref, 5);
      await act(async () => ref.current!.get().loadMoreRows());
      await settle();
      expect(lastFetch()).toEqual({ channelIds: [`c${GUIDE_CHANNEL_PAGE + 1}`], startMs: start + 3 * span, endMs: start + 6 * span });
    });

    it("a group change opens the next group at the window's start and lets go of the last group's listings", async () => {
      (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1)], total: 1 });
      (fetchListedChannels as jest.Mock).mockResolvedValue([channel(2)]);
      listEveryStretch();
      const ref = await mount();
      const start = await walkRight(ref, 3);
      // A channel recording marks every listing its channel still holds.
      (fetchTimers as jest.Mock).mockResolvedValue([
        { Id: "t1", Name: "Channel 1", ChannelId: "c1", StartDate: new Date(start).toISOString(), EndDate: new Date(start + 9 * span).toISOString(), Status: "New" },
      ]);
      await act(async () => ref.current!.get().refreshTimers());
      await settle();
      expect(ref.current!.get().timersByProgramId.size).toBeGreaterThan(0);

      await changePreferences(ref, { filter: "favorites", favorites: [{ name: "Channel 2" }] });
      expect(lastFetch()).toEqual({ channelIds: ["c2"], startMs: start, endMs: start + span });
      expect(ref.current!.get().windowEndMs).toBe(start + span);
      expect(ref.current!.get().rows.map((row) => row.programs.map((p) => p.Id))).toEqual([[`c2-${start}`]]);
      expect(ref.current!.get().timersByProgramId.size).toBe(0);
    });
  });

  it("keeps the previous programmes when their refresh fails", async () => {
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1)], total: 1 });
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ startMs }: { startMs: number }) => [program("a", "c1", 0, 30, startMs)]);
    const ref = await mount();
    (fetchGuidePrograms as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    await act(async () => ref.current!.get().retry());
    await settle();
    expect(ref.current!.get().rows[0].programs.map((p) => p.Id)).toEqual(["a"]);
    expect(ref.current!.get().error).toBe("offline");
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

describe("useGuide minute tick", () => {
  let appStateListener: ((state: AppStateStatus) => void) | null = null;
  const at = (h: number, m: number, sec: number) => new Date(2026, 8, 27, h, m, sec).getTime();

  beforeEach(() => {
    jest.clearAllMocks();
    mockPreferences = { version: 1, autoUpdate: true, filter: "all", sort: "number", favorites: [], groups: [], hideOffline: false };
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [], total: 0 });
    (fetchGuidePrograms as jest.Mock).mockResolvedValue([]);
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      appStateListener = handler as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    jest.useFakeTimers({ now: at(12, 28, 31) });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("ticks on the clock's minute boundary, not a minute after mount", async () => {
    const ref = await mount();
    act(() => jest.advanceTimersByTime(28_999));
    expect(ref.current!.get().nowMs).toBe(at(12, 28, 31));
    act(() => jest.advanceTimersByTime(1));
    expect(ref.current!.get().nowMs).toBe(at(12, 29, 0));
    act(() => jest.advanceTimersByTime(60_000));
    expect(ref.current!.get().nowMs).toBe(at(12, 30, 0));
  });

  it("a channel recording started after the last tick wears REC and marks the cells its span overlaps", async () => {
    const recorded = { Id: "t1", Name: "Channel 1", ChannelId: "c1", StartDate: new Date(at(12, 28, 45)).toISOString(), EndDate: new Date(at(13, 28, 45)).toISOString(), Status: "InProgress" };
    (fetchChannels as jest.Mock).mockResolvedValue({ items: [channel(1), channel(2)], total: 2 });
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ startMs }: { startMs: number }) => [
      program("a", "c1", 0, 30, startMs),
      program("b", "c1", 30, 60, startMs),
      program("c", "c1", 60, 90, startMs),
      program("d", "c2", 0, 60, startMs),
    ]);
    const ref = await mount();
    jest.setSystemTime(at(12, 28, 55));
    (fetchTimers as jest.Mock).mockResolvedValue([recorded]);
    await act(async () => ref.current!.get().refreshTimers());
    await settle();
    const state = ref.current!.get();
    expect(state.nowMs).toBe(at(12, 28, 55));
    expect([...state.recordingChannelIds]).toEqual(["c1"]);
    expect([...state.timersByProgramId.keys()]).toEqual(["a", "b", "c"]);
  });

  it("resyncs on a return to the foreground and keeps the boundary", async () => {
    const ref = await mount();
    jest.setSystemTime(at(12, 40, 12));
    act(() => appStateListener!("active"));
    expect(ref.current!.get().nowMs).toBe(at(12, 40, 12));
    act(() => jest.advanceTimersByTime(48_000));
    expect(ref.current!.get().nowMs).toBe(at(12, 41, 0));
  });
});
