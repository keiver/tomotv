/**
 * Starting playback from Downloads. What matters is the queue it builds: an item opened with
 * nothing behind it stops dead at its own end, and a queue that mixes kinds advances into a
 * player that cannot take the next item.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useDownloadPlayback } from "@/hooks/useDownloadPlayback";
import { usePlayQueue } from "@/contexts/PlayQueueContext";
import type { DownloadEntry, DownloadState } from "@/services/downloads/manifest";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

const mockBuildQueueFromItems = jest.fn();
jest.mock("@/contexts/PlayQueueContext", () => ({ usePlayQueue: jest.fn() }));

jest.mock("@/services/jellyfinApi", () => ({ isAudioItem: (item: { Type?: string }) => item?.Type === "Audio" }));

// Fixed order, so "did it shuffle" is a question about the call and not about luck.
jest.mock("@/utils/shuffle", () => ({ shuffled: (items: unknown[]) => [...items].reverse() }));

function entry(id: string, overrides: Partial<DownloadEntry> = {}): DownloadEntry {
  return {
    itemId: id,
    fileUri: `file:///doc/${id}`,
    artworkUri: null,
    bytesWritten: 1,
    totalBytes: 1,
    state: "ready" as DownloadState,
    addedAt: 1,
    item: { Id: id, Name: `Item ${id}`, Type: "Audio" } as never,
    ...overrides,
  };
}

function video(id: string, overrides: Partial<DownloadEntry> = {}) {
  return entry(id, { item: { Id: id, Name: `Video ${id}`, Type: "Movie" } as never, ...overrides });
}

function mount() {
  const result = { current: null as ReturnType<typeof useDownloadPlayback> | null };
  function Probe() {
    result.current = useDownloadPlayback();
    return null;
  }
  act(() => {
    TestRenderer.create(<Probe />);
  });
  return result;
}

/** The items handed to the queue by the last call. */
function queuedIds(): string[] {
  return (mockBuildQueueFromItems.mock.calls.at(-1)?.[0] as { Id: string }[]).map((item) => item.Id);
}

beforeEach(() => {
  jest.clearAllMocks();
  (usePlayQueue as jest.Mock).mockReturnValue({ buildQueueFromItems: mockBuildQueueFromItems });
});

describe("play", () => {
  it("queues the rest of the row behind the item, not the item alone", () => {
    const scope = [entry("a"), entry("b"), entry("c")];
    mount().current?.play(scope[1], scope, "album", "Veckatimest");

    expect(queuedIds()).toEqual(["a", "b", "c"]);
    // Starts on the one that was pressed, wherever it sits.
    expect(mockBuildQueueFromItems).toHaveBeenCalledWith(expect.anything(), "album", "Veckatimest", "b", false);
  });

  it("opens the player the queue's kind belongs to, in queue mode", () => {
    const scope = [entry("a")];
    mount().current?.play(scope[0], scope, "album", "Veckatimest");

    expect(mockPush).toHaveBeenCalledWith({ pathname: "/audio-player", params: { videoId: "a", videoName: "Item a", queueMode: "true" } });
  });

  it("sends video to the video player", () => {
    const scope = [video("v")];
    mount().current?.play(scope[0], scope, "season", "Season 1");
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/player" }));
  });

  it("never mixes kinds: a queue that changed player mid-advance would stall", () => {
    const scope = [entry("a"), video("v"), entry("b")];
    mount().current?.play(scope[0], scope, "mixed", "Mixed");
    expect(queuedIds()).toEqual(["a", "b"]);
  });

  it("leaves out anything not finished downloading", () => {
    const scope = [entry("a"), entry("b", { state: "downloading" }), entry("c", { state: "paused" })];
    mount().current?.play(scope[0], scope, "album", "Veckatimest");
    expect(queuedIds()).toEqual(["a"]);
  });
});

describe("shuffle", () => {
  it("shuffles the set and wraps at the end", () => {
    const scope = [entry("a"), entry("b"), entry("c")];
    mount().current?.shuffle(scope, "album", "Veckatimest");

    expect(queuedIds()).toEqual(["c", "b", "a"]);
    // loop true is what this queue has always called shuffle: endless, not stop-at-end.
    expect(mockBuildQueueFromItems).toHaveBeenCalledWith(expect.anything(), "album", "Veckatimest", "c", true);
  });

  it("shuffles a mixed set as its music, since one queue can only hold one kind", () => {
    mount().current?.shuffle([entry("a"), video("v"), entry("b")], "all", "Downloads");
    expect(queuedIds()).toEqual(["b", "a"]);
  });

  it("falls back to video when there is no audio at all", () => {
    mount().current?.shuffle([video("v"), video("w")], "all", "Downloads");
    expect(queuedIds()).toEqual(["w", "v"]);
  });

  it("does nothing, and says so, when nothing has finished downloading", () => {
    const started = mount().current?.shuffle([entry("a", { state: "downloading" })], "all", "Downloads");
    expect(started).toBe(false);
    expect(mockBuildQueueFromItems).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("canShuffle", () => {
  it("is true only once something is ready to play", () => {
    const hook = mount().current!;
    expect(hook.canShuffle([entry("a", { state: "queued" })])).toBe(false);
    expect(hook.canShuffle([entry("a")])).toBe(true);
    expect(hook.canShuffle([])).toBe(false);
  });
});
