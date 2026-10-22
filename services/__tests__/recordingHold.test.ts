/** recordingHold: the engine learns which providers a recording reads, a minute's warning comes first, and a new recording counts once its file holds video. */
import type { JellyfinTimer } from "@/types/jellyfin";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/toast", () => ({ showToast: jest.fn() }));
jest.mock("@/services/jellyfinApi", () => ({
  cancelTimer: jest.fn(async () => undefined),
  createTimer: jest.fn(async () => undefined),
  fetchInProgressRecording: jest.fn(async () => null),
  fetchTimerDefaults: jest.fn(async (programId?: string) => ({ ProgramId: programId, PrePaddingSeconds: 0 })),
  fetchTimers: jest.fn(async () => []),
  readRecordingStart: jest.fn(async () => new Uint8Array(0)),
}));
const mockStatus: { running: JellyfinTimer[]; active: JellyfinTimer[] } = { running: [], active: [] };
jest.mock("@/services/recordingStatus", () => {
  const actual = jest.requireActual("@/services/recordingStatus");
  return {
    recordingWindow: actual.recordingWindow,
    getRecordingStatus: () => mockStatus,
    subscribeRecordingStatus: jest.fn(() => () => {}),
    refreshRecordingStatus: jest.fn(async () => undefined),
  };
});
jest.mock("@/services/jellyfin/session", () => ({ getCachedConfig: jest.fn(() => ({ server: "", apiKey: "", userId: "", deviceId: "" })) }));
jest.mock("@keiver/tomo-engine", () => ({
  setOriginRecording: jest.fn(async () => true),
  originConnections: jest.fn(async () => ({ budget: 1, active: 0, held: false })),
  originConnectionLimit: jest.fn(() => 1),
  originHeld: jest.fn(() => false),
}));
jest.mock("@keiver/tomo-live", () => ({
  playlistChannelById: (id: string) => ({ "ch-a": { originKey: "a.example" }, "ch-a2": { originKey: "a.example" }, "ch-b": { originKey: "b.example" } })[id] ?? null,
  subscribePlaylistChannels: jest.fn(() => () => {}),
}));

import { cancelTimer, createTimer, fetchInProgressRecording, fetchTimers, readRecordingStart } from "@/services/jellyfinApi";
import {
  adjacentPlayableChannelId,
  checkNewRecording,
  heldRecording,
  isAdmitting,
  nextHoldEdge,
  recordingChecking,
  recordingOrigins,
  reserveForRecording,
  resetRecordingHoldsForTests,
  stopRecordingAndPlay,
  stopRecordingCheck,
  syncRecordingHolds,
} from "@/services/recordingHold";
import { showToast } from "@/services/toast";
import { originConnectionLimit, originConnections, setOriginRecording } from "@keiver/tomo-engine";

const NOW = Date.parse("2026-10-22T20:00:00Z");
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const timer = (id: string, channelId: string, startOffset: number, endOffset: number, status = "New", programId?: string): JellyfinTimer =>
  ({ Id: id, ChannelId: channelId, ChannelName: `Channel ${channelId}`, Name: id, StartDate: at(startOffset), EndDate: at(endOffset), Status: status, ProgramId: programId }) as JellyfinTimer;
const VIDEO = new Uint8Array([0x47, 0x40, 0x00]);
const REFUSAL = new TextEncoder().encode('{"error": "Stream limit exceeded"}');
const EMPTY = new Uint8Array(0);

/** A server whose recordings go through `items` in order: each one is in progress until its timer is cancelled. */
function serveRecordings(timers: JellyfinTimer[], reads: Uint8Array[]): void {
  let current = 0;
  const cancelled = new Set<string>();
  (fetchTimers as jest.Mock).mockImplementation(async () => {
    const live = timers[Math.min(current, timers.length - 1)];
    return [{ ...live, Status: cancelled.has(live.Id) ? "Cancelled" : "InProgress" }];
  });
  (fetchInProgressRecording as jest.Mock).mockImplementation(async (timerId: string) => (cancelled.has(timerId) ? null : { Id: `rec-${timerId}`, ChannelId: "ch-a" }));
  (cancelTimer as jest.Mock).mockImplementation(async (timerId: string) => {
    cancelled.add(timerId);
  });
  (createTimer as jest.Mock).mockImplementation(async () => {
    current += 1;
    // A program's airing comes back under its own id.
    cancelled.delete(timers[Math.min(current, timers.length - 1)].Id);
  });
  (readRecordingStart as jest.Mock).mockReset();
  for (const read of reads) (readRecordingStart as jest.Mock).mockResolvedValueOnce(read);
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.clearAllMocks();
  (originConnections as jest.Mock).mockReset().mockResolvedValue({ budget: 1, active: 0, held: false });
  (originConnectionLimit as jest.Mock).mockReset().mockReturnValue(1);
  (fetchInProgressRecording as jest.Mock).mockReset().mockResolvedValue(null);
  (fetchTimers as jest.Mock).mockReset().mockResolvedValue([]);
  (cancelTimer as jest.Mock).mockReset().mockResolvedValue(undefined);
  (createTimer as jest.Mock).mockReset().mockResolvedValue(undefined);
  resetRecordingHoldsForTests();
  mockStatus.running = [];
  mockStatus.active = [];
});
afterEach(() => {
  resetRecordingHoldsForTests();
  jest.useRealTimers();
});

describe("recordingOrigins", () => {
  it("holds a recording's provider while it runs or inside its padded span, never before it starts", () => {
    expect(recordingOrigins([timer("t", "ch-a", 0, 60_000, "InProgress")], NOW)).toEqual(new Set(["a.example"]));
    expect(recordingOrigins([timer("t", "ch-a", -1_000, 60_000)], NOW)).toEqual(new Set(["a.example"]));
    expect(recordingOrigins([timer("t", "ch-a", 1_000, 60_000)], NOW)).toEqual(new Set());
    expect(recordingOrigins([timer("t", "ch-x", 0, 60_000, "InProgress")], NOW)).toEqual(new Set());
    expect(recordingOrigins([timer("t", "ch-a", 0, 60_000, "Cancelled")], NOW)).toEqual(new Set());
  });
});

describe("nextHoldEdge", () => {
  it("is the nearest of the warning, the start and the end", () => {
    expect(nextHoldEdge([timer("t", "ch-a", 120_000, 300_000)], NOW)).toBe(NOW + 60_000);
    expect(nextHoldEdge([timer("t", "ch-a", 30_000, 300_000)], NOW)).toBe(NOW + 30_000);
    expect(nextHoldEdge([], NOW)).toBeNull();
  });
});

describe("syncRecordingHolds", () => {
  it("tells the engine once when a recording starts and once when it ends", async () => {
    const running = timer("t", "ch-a", -1_000, 60_000, "InProgress");
    mockStatus.running = [running];
    mockStatus.active = [running];
    syncRecordingHolds(NOW);
    syncRecordingHolds(NOW);
    await jest.advanceTimersByTimeAsync(0);
    expect(setOriginRecording).toHaveBeenCalledTimes(1);
    expect(setOriginRecording).toHaveBeenCalledWith("a.example", true);
    mockStatus.running = [];
    mockStatus.active = [];
    syncRecordingHolds(NOW + 1_000);
    expect(setOriginRecording).toHaveBeenLastCalledWith("a.example", false);
  });

  it("warns once a minute ahead of a recording on a one-connection provider, and not on another", async () => {
    mockStatus.active = [timer("soon", "ch-a", 50_000, 300_000)];
    syncRecordingHolds(NOW);
    syncRecordingHolds(NOW);
    await jest.advanceTimersByTimeAsync(0);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith({ title: "player.limitedConnections", message: "liveTv.recordingSoon" });
    (originConnectionLimit as jest.Mock).mockReturnValue(null);
    (originConnections as jest.Mock).mockResolvedValue({ budget: 2, active: 0, held: false });
    mockStatus.active = [timer("other", "ch-b", 50_000, 300_000)];
    syncRecordingHolds(NOW);
    await jest.advanceTimersByTimeAsync(0);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("checks a scheduled recording that starts while this device reads its provider, making a program's airing again from its defaults", async () => {
    const starting = timer("t", "ch-a", -500, 60_000, "New", "prog-1");
    mockStatus.active = [starting];
    (originConnections as jest.Mock).mockResolvedValueOnce({ budget: 1, active: 1, held: false });
    serveRecordings([starting, { ...starting, Id: "t" }], [EMPTY, REFUSAL, VIDEO]);
    syncRecordingHolds(NOW);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(cancelTimer).toHaveBeenCalledWith("t");
    expect(createTimer).toHaveBeenCalledWith({ ProgramId: "prog-1", PrePaddingSeconds: 0 });
    expect(recordingChecking("ch-a")).toBe(false);
  });

  it("makes a manual timer again with its own end", async () => {
    const starting = timer("t", "ch-a", -500, 60_000);
    mockStatus.active = [starting];
    (originConnections as jest.Mock).mockResolvedValueOnce({ budget: 1, active: 1, held: false });
    serveRecordings([starting, timer("t2", "ch-a", 0, 60_000)], [EMPTY, REFUSAL, VIDEO]);
    syncRecordingHolds(NOW);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(createTimer).toHaveBeenCalledWith(expect.objectContaining({ ChannelId: "ch-a", Name: "t", EndDate: at(60_000) }));
  });

  it("leaves a scheduled recording alone when this device was not reading its provider", async () => {
    mockStatus.active = [timer("t", "ch-a", -500, 60_000)];
    syncRecordingHolds(NOW);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(fetchInProgressRecording).not.toHaveBeenCalled();
  });
});

describe("checkNewRecording", () => {
  it("is done when the recording's first byte is video", async () => {
    serveRecordings([timer("t", "ch-a", 0, 60_000, "InProgress")], [VIDEO]);
    const recreate = jest.fn(async () => undefined);
    await checkNewRecording("ch-a", undefined, recreate);
    expect(cancelTimer).not.toHaveBeenCalled();
    expect(recreate).not.toHaveBeenCalled();
  });

  it("cancels an empty recording that turns out refused and makes it again until a read finds video", async () => {
    serveRecordings(
      [timer("t1", "ch-a", 0, 60_000, "InProgress"), timer("t2", "ch-a", 0, 60_000, "InProgress"), timer("t3", "ch-a", 0, 60_000, "InProgress")],
      [EMPTY, REFUSAL, EMPTY, REFUSAL, VIDEO],
    );
    const recreate = jest.fn(async () => {
      await (createTimer as jest.Mock)();
    });
    const checked = checkNewRecording("ch-a", undefined, recreate);
    await jest.advanceTimersByTimeAsync(5_000);
    await checked;
    expect((cancelTimer as jest.Mock).mock.calls).toEqual([["t1"], ["t2"]]);
    expect(recreate).toHaveBeenCalledTimes(2);
  });

  it("stops after two cancels that found video, making the recording once more", async () => {
    serveRecordings([timer("t1", "ch-a", 0, 60_000, "InProgress"), timer("t2", "ch-a", 0, 60_000, "InProgress"), timer("t3", "ch-a", 0, 60_000, "InProgress")], [EMPTY, VIDEO, EMPTY, VIDEO]);
    const recreate = jest.fn(async () => {
      await (createTimer as jest.Mock)();
    });
    const checked = checkNewRecording("ch-a", undefined, recreate);
    await jest.advanceTimersByTimeAsync(5_000);
    await checked;
    expect(cancelTimer).toHaveBeenCalledTimes(2);
    expect(recreate).toHaveBeenCalledTimes(2);
    expect(readRecordingStart).toHaveBeenCalledTimes(4);
  });

  it("keeps the provider held while the recording is checked", async () => {
    serveRecordings([timer("t1", "ch-a", 0, 60_000, "InProgress")], []);
    (fetchInProgressRecording as jest.Mock).mockResolvedValue(null);
    void checkNewRecording(
      "ch-a",
      undefined,
      jest.fn(async () => undefined),
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(recordingChecking("ch-a")).toBe(true);
    expect(setOriginRecording).toHaveBeenCalledWith("a.example", true);
    syncRecordingHolds(NOW);
    expect(setOriginRecording).not.toHaveBeenCalledWith("a.example", false);
  });

  it("ends and lets the provider go when the timer is cancelled anywhere before its recording appears", async () => {
    serveRecordings([timer("t1", "ch-a", 0, 60_000, "InProgress")], []);
    (fetchInProgressRecording as jest.Mock).mockResolvedValue(null);
    const recreate = jest.fn(async () => undefined);
    const checked = checkNewRecording("ch-a", undefined, recreate);
    await jest.advanceTimersByTimeAsync(500);
    expect(recordingChecking("ch-a")).toBe(true);
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    await jest.advanceTimersByTimeAsync(500);
    await checked;
    expect(recordingChecking("ch-a")).toBe(false);
    expect(recreate).not.toHaveBeenCalled();
    expect(setOriginRecording).toHaveBeenLastCalledWith("a.example", false);
  });

  it("ends without making the recording again once it is stopped on purpose", async () => {
    serveRecordings([timer("t1", "ch-a", 0, 60_000, "InProgress")], [EMPTY, REFUSAL]);
    (fetchInProgressRecording as jest.Mock).mockResolvedValue(null);
    const recreate = jest.fn(async () => undefined);
    const checked = checkNewRecording("ch-a", undefined, recreate);
    await jest.advanceTimersByTimeAsync(500);
    stopRecordingCheck("ch-a2");
    await jest.advanceTimersByTimeAsync(500);
    await checked;
    expect(recordingChecking("ch-a")).toBe(false);
    expect(recreate).not.toHaveBeenCalled();
  });
});

describe("heldRecording", () => {
  it("is the timer recording on any channel of the same provider now, never a later one", () => {
    mockStatus.active = [timer("later", "ch-a", 3_600_000, 7_200_000), timer("now", "ch-a2", -1_000, 60_000, "InProgress")];
    expect(heldRecording("ch-a", NOW)?.Id).toBe("now");
    expect(heldRecording("ch-b", NOW)).toBeNull();
  });
});

describe("adjacentPlayableChannelId", () => {
  const ring = [{ Id: "ch-b" }, { Id: "ch-a" }, { Id: "ch-a2" }, { Id: "ch-c" }];
  const heldA = (id: string) => id === "ch-a" || id === "ch-a2";

  it("passes over channels whose provider a recording holds", () => {
    expect(adjacentPlayableChannelId(ring, "ch-b", 1, heldA)).toBe("ch-c");
    expect(adjacentPlayableChannelId(ring, "ch-c", -1, heldA)).toBe("ch-b");
  });

  it("is null when every other channel is held", () => {
    expect(adjacentPlayableChannelId([{ Id: "ch-b" }, { Id: "ch-a" }], "ch-b", 1, heldA)).toBeNull();
  });
});

describe("reserveForRecording", () => {
  it("marks the provider recording and resolves once this device's reads close, with no further wait", async () => {
    (originConnections as jest.Mock).mockResolvedValueOnce({ budget: 1, active: 1, held: true }).mockResolvedValueOnce({ budget: 1, active: 1, held: true });
    let done = false;
    const reserved = reserveForRecording("ch-a").then((release) => {
      done = true;
      return release;
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(setOriginRecording).toHaveBeenCalledWith("a.example", true);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(500);
    expect(done).toBe(true);
    (await reserved)?.();
    expect(setOriginRecording).toHaveBeenLastCalledWith("a.example", false);
  });

  it("does nothing for a provider with more than one connection", async () => {
    (originConnectionLimit as jest.Mock).mockReturnValue(2);
    (originConnections as jest.Mock).mockResolvedValue({ budget: 2, active: 1, held: false });
    expect(await reserveForRecording("ch-a")).toBeNull();
    expect(setOriginRecording).not.toHaveBeenCalled();
  });
});

describe("stopRecordingAndPlay", () => {
  it("cancels the timer, resolves once the provider is free, and opens the channel again on every refusal until it plays", async () => {
    (originConnections as jest.Mock).mockResolvedValueOnce({ budget: 1, active: 0, held: true }).mockResolvedValue({ budget: 1, active: 0, held: false });
    let done = false;
    const stopping = stopRecordingAndPlay(timer("t", "ch-a", -1_000, 60_000, "InProgress"), "ch-a2").then(() => {
      done = true;
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(cancelTimer).toHaveBeenCalledWith("t");
    await jest.advanceTimersByTimeAsync(300);
    await stopping;
    expect(done).toBe(true);
    expect(isAdmitting("ch-a2")).toBe(true);
  });
});
