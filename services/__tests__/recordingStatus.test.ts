/** The shared recording reading: what counts as running, when it re-reads by itself, and what wakes it. */
import { getRecordingStatus, recordingBoundary, refreshRecordingStatus, resetRecordingStatusForTests, runningTimers, stopRunningTimers, subscribeRecordingStatus } from "@/services/recordingStatus";
import { cancelTimer, fetchTimers, subscribeAuthChange, subscribeRecordingsChange } from "@/services/jellyfinApi";
import { getLiveTvAvailability, subscribeLiveTvAvailability } from "@/services/liveTvAvailability";
import type { JellyfinTimer } from "@/types/jellyfin";
import { AppState } from "react-native";

jest.mock("@/services/jellyfinApi", () => ({
  cancelTimer: jest.fn(async () => {}),
  fetchTimers: jest.fn(async () => []),
  subscribeAuthChange: jest.fn(() => jest.fn()),
  subscribeRecordingsChange: jest.fn(() => jest.fn()),
}));
jest.mock("@/services/liveTvAvailability", () => ({
  getLiveTvAvailability: jest.fn(() => true),
  subscribeLiveTvAvailability: jest.fn(() => jest.fn()),
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const now = Date.parse("2026-10-03T20:00:00Z");
const at = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();
const timer = (overrides: Partial<JellyfinTimer>): JellyfinTimer => ({ Id: "t", Name: "Show", ChannelId: "ch", StartDate: at(-30), EndDate: at(90), Status: "InProgress", ...overrides });

async function flush() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe("recordingStatus", () => {
  let appStateListener: ((state: string) => void) | null = null;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.clearAllMocks();
    jest.mocked(fetchTimers).mockResolvedValue([]);
    jest.mocked(getLiveTvAvailability).mockReturnValue(true);
    appStateListener = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, cb) => {
      appStateListener = cb as (state: string) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    resetRecordingStatusForTests();
  });
  afterEach(() => {
    resetRecordingStatusForTests();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("runningTimers keeps InProgress timers and live ones whose padded span holds the clock", () => {
    const running = timer({ Id: "a" });
    const justCreated = timer({ Id: "e", Status: "New", StartDate: at(0) });
    const inPrePadding = timer({ Id: "g", Status: "New", StartDate: at(3), PrePaddingSeconds: 300 });
    const inPostPadding = timer({ Id: "h", Status: "InProgress", EndDate: at(-1), PostPaddingSeconds: 120 });
    const timers = [
      running,
      justCreated,
      inPrePadding,
      inPostPadding,
      timer({ Id: "b", Status: "New", StartDate: at(10) }),
      timer({ Id: "c", Status: "Cancelled" }),
      timer({ Id: "d", Status: "Completed" }),
      timer({ Id: "f", Status: "New", EndDate: at(-1) }),
    ];
    expect(runningTimers(timers, now).map((entry) => entry.Id)).toEqual(["a", "e", "g", "h"]);
  });

  it("recordingBoundary is the nearest padded end of a running timer or padded start of an upcoming one", () => {
    const timers = [
      timer({ Id: "a", EndDate: at(90), PostPaddingSeconds: 600 }),
      timer({ Id: "b", Status: "New", StartDate: at(20), EndDate: at(50), PrePaddingSeconds: 120 }),
      timer({ Id: "c", Status: "Cancelled", StartDate: at(5), EndDate: at(6) }),
    ];
    expect(recordingBoundary(timers, now)).toBe(now + 18 * 60_000);
    expect(recordingBoundary([timer({ Id: "a", EndDate: at(90), PostPaddingSeconds: 600 })], now)).toBe(now + 100 * 60_000);
    expect(recordingBoundary([timer({ Id: "a", Status: "New", EndDate: at(-1) })], now)).toBeNull();
    expect(recordingBoundary([], now)).toBeNull();
  });

  it("a timer still InProgress past its padded end is looked at again half a minute later", () => {
    expect(recordingBoundary([timer({ Id: "a", Status: "InProgress", EndDate: at(-1) })], now)).toBe(now + 30_000);
  });

  it("reads on the first subscriber and re-reads at the running timer's end", async () => {
    jest.mocked(fetchTimers).mockResolvedValue([timer({ Id: "a", EndDate: at(90) })]);
    const listener = jest.fn();
    subscribeRecordingStatus(listener);
    await flush();
    expect(fetchTimers).toHaveBeenCalledTimes(1);
    expect(getRecordingStatus().running.map((entry) => entry.Id)).toEqual(["a"]);
    expect(listener).toHaveBeenCalledTimes(1);

    jest.mocked(fetchTimers).mockResolvedValue([timer({ Id: "a", Status: "Completed" })]);
    jest.advanceTimersByTime(90 * 60_000 - 1);
    expect(fetchTimers).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2_000);
    await flush();
    expect(fetchTimers).toHaveBeenCalledTimes(2);
    expect(getRecordingStatus().running).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("re-reads on a timer write, an auth change, a foreground and a Live TV availability change", async () => {
    subscribeRecordingStatus(jest.fn());
    await flush();
    expect(fetchTimers).toHaveBeenCalledTimes(1);

    jest.mocked(subscribeRecordingsChange).mock.calls[0][0]();
    await flush();
    expect(fetchTimers).toHaveBeenCalledTimes(2);

    jest.mocked(subscribeAuthChange).mock.calls[0][0]();
    await flush();
    expect(fetchTimers).toHaveBeenCalledTimes(3);

    jest.mocked(subscribeLiveTvAvailability).mock.calls[0][0]();
    await flush();
    expect(fetchTimers).toHaveBeenCalledTimes(4);

    appStateListener!("background");
    appStateListener!("active");
    await flush();
    expect(fetchTimers).toHaveBeenCalledTimes(5);
  });

  it("an auth change clears the reading before the re-read lands", async () => {
    jest.mocked(fetchTimers).mockResolvedValue([timer({ Id: "a" })]);
    const listener = jest.fn();
    subscribeRecordingStatus(listener);
    await flush();
    expect(getRecordingStatus().running).toHaveLength(1);
    jest.mocked(fetchTimers).mockReturnValue(new Promise(() => {}));
    jest.mocked(subscribeAuthChange).mock.calls[0][0]();
    expect(getRecordingStatus().running).toEqual([]);
  });

  it("a failed read tries again a minute later", async () => {
    jest.mocked(fetchTimers).mockRejectedValueOnce(new Error("Jellyfin server not configured."));
    subscribeRecordingStatus(jest.fn());
    await flush();
    expect(fetchTimers).toHaveBeenCalledTimes(1);
    jest.mocked(fetchTimers).mockResolvedValue([timer({ Id: "a" })]);
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(fetchTimers).toHaveBeenCalledTimes(2);
    expect(getRecordingStatus().running.map((entry) => entry.Id)).toEqual(["a"]);
  });

  it("skips the server while it offers no Live TV", async () => {
    jest.mocked(getLiveTvAvailability).mockReturnValue(false);
    subscribeRecordingStatus(jest.fn());
    await flush();
    expect(fetchTimers).not.toHaveBeenCalled();
    expect(getRecordingStatus().running).toEqual([]);
  });

  it("drops a read overtaken by a newer one and keeps the last reading on a failed read", async () => {
    let resolveFirst!: (timers: JellyfinTimer[]) => void;
    jest.mocked(fetchTimers).mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    subscribeRecordingStatus(jest.fn());
    jest.mocked(fetchTimers).mockResolvedValueOnce([timer({ Id: "new" })]);
    await refreshRecordingStatus();
    resolveFirst([timer({ Id: "old" })]);
    await flush();
    expect(getRecordingStatus().running.map((entry) => entry.Id)).toEqual(["new"]);

    jest.mocked(fetchTimers).mockRejectedValueOnce(new Error("offline"));
    await refreshRecordingStatus();
    expect(getRecordingStatus().running.map((entry) => entry.Id)).toEqual(["new"]);
  });

  it("the last unsubscribe stops the sources and the boundary timer", async () => {
    const unsubscribeSource = jest.fn();
    jest.mocked(subscribeRecordingsChange).mockReturnValue(unsubscribeSource);
    jest.mocked(fetchTimers).mockResolvedValue([timer({ Id: "a" })]);
    const unsubscribe = subscribeRecordingStatus(jest.fn());
    await flush();
    unsubscribe();
    expect(unsubscribeSource).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(24 * 60 * 60_000);
    await flush();
    expect(fetchTimers).toHaveBeenCalledTimes(1);
  });

  it("stopRunningTimers deletes every timer and names the ones that failed", async () => {
    jest.mocked(cancelTimer).mockImplementation(async (id: string) => {
      if (id === "b") throw new Error("409");
    });
    await expect(stopRunningTimers([timer({ Id: "a" }), timer({ Id: "b" }), timer({ Id: "c" })])).resolves.toEqual(["b"]);
    expect(cancelTimer).toHaveBeenCalledTimes(3);
  });
});
