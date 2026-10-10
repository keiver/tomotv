/**
 * useServerSearch: pages append without repeating a card an earlier page showed, the next page
 * starts from the cursor the last one returned, and a page for an older term lands nothing.
 */
import { appendUnique, useServerSearch } from "@/hooks/useServerSearch";
import { searchVideos } from "@/services/jellyfinApi";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/jellyfinApi", () => ({ searchVideos: jest.fn(), searchLiveTv: jest.fn(async () => []), warmLiveTvSearch: jest.fn(async () => {}), subscribeLiveTvSearchIndex: () => () => {} }));

const mockSearch = searchVideos as jest.MockedFunction<typeof searchVideos>;
const item = (Id: string) => ({ Id, Name: Id, Type: "Movie", Path: "" }) as JellyfinVideoItem;

type Search = ReturnType<typeof useServerSearch>;
const Probe = forwardRef<{ get: () => Search }>((_props, ref) => {
  const search = useServerSearch();
  useImperativeHandle(ref, () => ({ get: () => search }), [search]);
  return null;
});
Probe.displayName = "Probe";

let tree: TestRenderer.ReactTestRenderer | undefined;
async function mount() {
  const ref = React.createRef<{ get: () => Search }>();
  await act(async () => {
    tree = TestRenderer.create(<Probe ref={ref} />);
  });
  return () => ref.current!.get();
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSearch.mockReset();
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.useRealTimers();
});

it("appendUnique keeps the shown order and drops repeats", () => {
  const shown = [item("a"), item("b")];
  expect(appendUnique(shown, [item("b"), item("c")]).map((video) => video.Id)).toEqual(["a", "b", "c"]);
  expect(appendUnique(shown, [item("a")])).toBe(shown);
});

it("asks the next page from the returned cursor and never repeats a card", async () => {
  mockSearch.mockResolvedValueOnce({ items: [item("a"), item("b")], next: { title: 2, genre: 1 } }).mockResolvedValueOnce({ items: [item("b"), item("c")], next: null });
  const latest = await mount();

  act(() => latest().search("film"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(latest().hasMore).toBe(true);

  await act(async () => latest().loadMore());
  expect(mockSearch).toHaveBeenLastCalledWith("film", { limit: 60, cursor: { title: 2, genre: 1 } });
  expect(latest().results.map((video) => video.Id)).toEqual(["a", "b", "c"]);
  expect(latest().hasMore).toBe(false);
});

it("lands nothing from a term the viewer has typed past", async () => {
  let finishOld!: (page: { items: JellyfinVideoItem[]; next: null }) => void;
  mockSearch.mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve))).mockResolvedValueOnce({ items: [item("new")], next: null });
  const latest = await mount();

  act(() => latest().search("fil"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  act(() => latest().search("film"));
  await act(async () => {
    finishOld({ items: [item("old")], next: null });
  });
  expect(latest().results).toEqual([]);

  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(latest().results.map((video) => video.Id)).toEqual(["new"]);
});

it("paints once per term: the live name tier and the library page land in one commit, live first", async () => {
  const { searchLiveTv } = require("@/services/jellyfinApi") as { searchLiveTv: jest.Mock };
  let emit!: (items: JellyfinVideoItem[]) => void;
  searchLiveTv.mockImplementationOnce((_term: string, onUpdate: (items: JellyfinVideoItem[]) => void) => {
    emit = onUpdate;
    return new Promise(() => {});
  });
  mockSearch.mockResolvedValueOnce({ items: [item("a"), item("channel")], next: null });
  const latest = await mount();

  act(() => latest().search("film"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(latest().items).toEqual([]);
  expect(latest().isSearching).toBe(true);

  await act(async () => emit([item("channel")]));
  expect(latest().items.map(({ Id }) => Id)).toEqual(["channel", "a"]);
  expect(latest().isSearching).toBe(false);
});

it("holds an intermediate tier after the paint; the finished request applies it and ends the gather", async () => {
  const { searchLiveTv } = require("@/services/jellyfinApi") as { searchLiveTv: jest.Mock };
  let emit!: (items: JellyfinVideoItem[]) => void;
  let finishLive!: (items: JellyfinVideoItem[]) => void;
  searchLiveTv.mockImplementationOnce((_term: string, onUpdate: (items: JellyfinVideoItem[]) => void) => {
    emit = onUpdate;
    return new Promise((resolve) => (finishLive = resolve));
  });
  mockSearch.mockResolvedValueOnce({ items: [item("a")], next: null });
  const latest = await mount();

  act(() => latest().search("film"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await act(async () => emit([item("channel")]));
  expect(latest().items.map(({ Id }) => Id)).toEqual(["channel", "a"]);
  expect(latest().isLiveSearching).toBe(true);

  await act(async () => emit([item("channel"), item("programme")]));
  expect(latest().items.map(({ Id }) => Id)).toEqual(["channel", "a"]);

  await act(async () => finishLive([item("channel"), item("programme")]));
  expect(latest().items.map(({ Id }) => Id)).toEqual(["channel", "programme", "a"]);
  expect(latest().isLiveSearching).toBe(false);
});

it("applies a late fill in place when it only completes the cards already shown", async () => {
  const { searchLiveTv } = require("@/services/jellyfinApi") as { searchLiveTv: jest.Mock };
  let emit!: (items: JellyfinVideoItem[]) => void;
  searchLiveTv.mockImplementationOnce((_term: string, onUpdate: (items: JellyfinVideoItem[]) => void) => {
    emit = onUpdate;
    return new Promise(() => {});
  });
  mockSearch.mockResolvedValueOnce({ items: [], next: null });
  const latest = await mount();

  act(() => latest().search("film"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await act(async () => emit([item("programme")]));
  expect(latest().items.map(({ Id }) => Id)).toEqual(["programme"]);

  await act(async () => emit([{ ...item("programme"), Name: "Completed" }]));
  expect(latest().items[0].Name).toBe("Completed");
});

it("lands nothing from a live partial for a term the viewer has typed past", async () => {
  const { searchLiveTv } = require("@/services/jellyfinApi") as { searchLiveTv: jest.Mock };
  let emitOld!: (items: JellyfinVideoItem[]) => void;
  searchLiveTv
    .mockImplementationOnce((_term: string, onUpdate: (items: JellyfinVideoItem[]) => void) => {
      emitOld = onUpdate;
      return new Promise(() => {});
    })
    .mockResolvedValueOnce([]);
  mockSearch.mockResolvedValue({ items: [], next: null });
  const latest = await mount();

  act(() => latest().search("fil"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  act(() => latest().search("film"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await act(async () => emitOld([item("stale-channel")]));
  expect(latest().liveResults).toEqual([]);
});

it("drops a live page for a term the viewer has typed past", async () => {
  const { searchLiveTv } = require("@/services/jellyfinApi") as { searchLiveTv: jest.Mock };
  let finishOldLive!: (channels: JellyfinVideoItem[]) => void;
  searchLiveTv.mockImplementationOnce(() => new Promise((resolve) => (finishOldLive = resolve))).mockResolvedValueOnce([]);
  mockSearch.mockResolvedValue({ items: [], next: null });
  const latest = await mount();

  act(() => latest().search("fil"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  act(() => latest().search("film"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await act(async () => {
    finishOldLive([item("stale-channel")]);
  });
  expect(latest().liveResults).toEqual([]);
});

it("keeps the live cards already shown when the library request fails", async () => {
  const { searchLiveTv } = require("@/services/jellyfinApi") as { searchLiveTv: jest.Mock };
  searchLiveTv.mockResolvedValueOnce([item("channel")]);
  let failLibrary!: (reason: Error) => void;
  mockSearch.mockImplementationOnce(() => new Promise((_resolve, reject) => (failLibrary = reject)));
  const latest = await mount();

  act(() => latest().search("film"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  await act(async () => {
    failLibrary(new Error("server down"));
  });
  expect(latest().error).not.toBeNull();
  expect(latest().results).toEqual([]);
  expect(latest().items.map(({ Id }) => Id)).toEqual(["channel"]);
});

it("warms the live guide once at mount, before any query", async () => {
  const { warmLiveTvSearch } = require("@/services/jellyfinApi") as { warmLiveTvSearch: jest.Mock };
  warmLiveTvSearch.mockClear();
  await mount();
  expect(warmLiveTvSearch).toHaveBeenCalledTimes(1);
});

it("keeps the previous term's live cards on screen until the new term's land", async () => {
  const { searchLiveTv } = require("@/services/jellyfinApi") as { searchLiveTv: jest.Mock };
  let finishNewLive!: (channels: JellyfinVideoItem[]) => void;
  searchLiveTv.mockResolvedValueOnce([item("old-channel")]).mockImplementationOnce(() => new Promise((resolve) => (finishNewLive = resolve)));
  mockSearch.mockResolvedValue({ items: [], next: null });
  const latest = await mount();

  act(() => latest().search("th"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(latest().liveResults.map(({ Id }) => Id)).toEqual(["old-channel"]);

  act(() => latest().search("the"));
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(latest().liveResults.map(({ Id }) => Id)).toEqual(["old-channel"]);

  await act(async () => {
    finishNewLive([item("new-channel")]);
  });
  expect(latest().liveResults.map(({ Id }) => Id)).toEqual(["new-channel"]);
});
