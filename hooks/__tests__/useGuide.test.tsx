/**
 * react-test-renderer through a null-rendering harness (the project's hook-testing pattern).
 */
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { fetchChannels, fetchGuidePrograms, fetchTimers } from "@/services/jellyfinApi";
import { GUIDE_CHANNEL_PAGE, useGuide } from "../useGuide";
import { GUIDE_SPAN_MINUTES, MINUTE_MS } from "@/utils/guide";

jest.mock("@/services/jellyfinApi", () => ({
  fetchChannels: jest.fn(),
  fetchGuidePrograms: jest.fn(),
  fetchTimers: jest.fn(),
}));
jest.mock("expo-router", () => ({ useIsFocused: () => true }));
let mockPreferences = { version: 1, autoUpdate: true, favoritesOnly: false, sort: "number", favorites: [] as { number?: string; name: string }[] };
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
    mockPreferences = { version: 1, autoUpdate: true, favoritesOnly: false, sort: "number", favorites: [] };
    (fetchTimers as jest.Mock).mockResolvedValue([]);
  });

  it("held to favorites, keeps only their rows, asks programs for them alone, and pages on by itself until every channel is seen", async () => {
    const many = Array.from({ length: GUIDE_CHANNEL_PAGE + 5 }, (_, i) => channel(i + 1));
    mockPreferences = { ...mockPreferences, favoritesOnly: true, favorites: [{ name: "Channel 2" }, { name: `Channel ${GUIDE_CHANNEL_PAGE + 3}` }] };
    (fetchChannels as jest.Mock).mockImplementation(async ({ startIndex, limit }: { startIndex: number; limit: number }) => ({
      items: many.slice(startIndex, startIndex + limit),
      total: many.length,
    }));
    (fetchGuidePrograms as jest.Mock).mockImplementation(async ({ channelIds, startMs }: { channelIds: string[]; startMs: number }) => channelIds.map((id) => program(`${id}-p`, id, 0, 30, startMs)));

    const ref = await mount();
    await settle();
    expect(ref.current!.get().rows.map((row) => row.channel.Id)).toEqual(["c2", `c${GUIDE_CHANNEL_PAGE + 3}`]);
    expect((fetchChannels as jest.Mock).mock.calls.map(([args]) => args.startIndex)).toEqual([0, GUIDE_CHANNEL_PAGE]);
    expect((fetchGuidePrograms as jest.Mock).mock.calls.map(([args]) => args.channelIds)).toEqual([["c2"], [`c${GUIDE_CHANNEL_PAGE + 3}`]]);
    expect(ref.current!.get().rows[1].programs).toHaveLength(1);
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
