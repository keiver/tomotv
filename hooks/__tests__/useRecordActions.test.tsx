/** Record writes: a write that landed stands even when the re-read fails, and a cancel on that stand-in reads first. */
import { useRecordActions, type RecordTarget } from "@/hooks/useRecordActions";
import { cancelSeriesTimer, cancelTimer, createSeriesTimer, createTimer, fetchSeriesTimers, fetchTimerDefaults, fetchTimers } from "@/services/jellyfinApi";
import { showToast } from "@/services/toast";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/jellyfinApi", () => ({
  cancelSeriesTimer: jest.fn(async () => {}),
  cancelTimer: jest.fn(async () => {}),
  createSeriesTimer: jest.fn(async () => {}),
  createTimer: jest.fn(async () => {}),
  fetchTimerDefaults: jest.fn(async () => ({})),
  fetchTimers: jest.fn(async () => []),
  fetchSeriesTimers: jest.fn(async () => []),
}));
jest.mock("@/services/toast", () => ({ showToast: jest.fn() }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/liveTvPreferences", () => ({ getLiveTvPreferences: () => ({ recordingMinutes: 60 }) }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

type Actions = ReturnType<typeof useRecordActions>;
const Harness = forwardRef<{ get: () => Actions }, { target: RecordTarget }>(({ target }, ref) => {
  const actions = useRecordActions(target);
  useImperativeHandle(ref, () => ({ get: () => actions }), [actions]);
  return null;
});
Harness.displayName = "Harness";

const now = Date.now();
const program = { StartDate: new Date(now - 60_000).toISOString(), EndDate: new Date(now + 3_600_000).toISOString() };
const target: RecordTarget = { programId: "p1", channelId: "ch1", channelName: "News", program };
const serverTimer = { Id: "t1", Name: "News", ChannelId: "ch1", ProgramId: "p1", Status: "InProgress", StartDate: program.StartDate, EndDate: program.EndDate };

async function mount() {
  const ref = React.createRef<{ get: () => Actions }>();
  await act(async () => {
    TestRenderer.create(<Harness ref={ref} target={target} />);
  });
  return ref;
}

describe("useRecordActions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(fetchTimers).mockResolvedValue([]);
    jest.mocked(fetchSeriesTimers).mockResolvedValue([]);
  });

  it("a later program on a channel recording another offers Record, never the other's Stop", async () => {
    const later = { StartDate: new Date(now + 3_600_000).toISOString(), EndDate: new Date(now + 7_200_000).toISOString() };
    jest.mocked(fetchTimers).mockResolvedValue([serverTimer] as never);
    const ref = React.createRef<{ get: () => Actions }>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} target={{ programId: "p2", channelId: "ch1", channelName: "News", program: later }} />);
    });
    expect(ref.current!.get().timer).toBeNull();
    await act(async () => ref.current!.get().cancel());
    expect(cancelTimer).not.toHaveBeenCalled();
  });

  it("a timer id pins the read to that timer while it is live, then falls back once it is cancelled", async () => {
    const future = { Id: "t9", Name: "News", ChannelId: "ch1", Status: "New", StartDate: new Date(now + 3_600_000).toISOString(), EndDate: new Date(now + 7_200_000).toISOString() };
    jest.mocked(fetchTimers).mockResolvedValue([future] as never);
    const ref = React.createRef<{ get: () => Actions }>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} target={{ channelId: "ch1", channelName: "News", timerId: "t9" }} />);
    });
    expect(ref.current!.get().timer).toMatchObject({ Id: "t9" });
    jest.mocked(fetchTimers).mockResolvedValue([{ ...future, Status: "Cancelled" }] as never);
    await act(async () => ref.current!.get().cancel());
    expect(cancelTimer).toHaveBeenCalledWith("t9");
    expect(ref.current!.get().timer).toBeNull();
  });

  it("settles after the first read, a failed one included", async () => {
    expect((await mount()).current!.get().settled).toBe(true);
    jest.mocked(fetchTimers).mockRejectedValueOnce(new Error("offline"));
    const failed = await mount();
    expect(failed.current!.get().settled).toBe(true);
    expect(failed.current!.get().timer).toBeUndefined();
  });

  it("keeps a created timer as recording when the re-read fails, without a failure toast", async () => {
    const ref = await mount();
    expect(ref.current!.get().timer).toBeNull();
    jest.mocked(fetchTimers).mockRejectedValueOnce(new Error("offline"));
    await act(async () => ref.current!.get().record());
    expect(createTimer).toHaveBeenCalledTimes(1);
    expect(ref.current!.get().timer).toMatchObject({ Id: "", Status: "InProgress" });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("liveTv.recordingStartedFor"), "success");
  });

  it("reads the real timer before cancelling a stand-in, then cancels it by id", async () => {
    const ref = await mount();
    jest.mocked(fetchTimers).mockRejectedValueOnce(new Error("offline"));
    await act(async () => ref.current!.get().record());
    jest.mocked(fetchTimers).mockResolvedValue([serverTimer] as never);
    await act(async () => ref.current!.get().cancel());
    expect(cancelTimer).not.toHaveBeenCalled();
    expect(ref.current!.get().timer).toMatchObject({ Id: "t1" });
    await act(async () => ref.current!.get().cancel());
    expect(cancelTimer).toHaveBeenCalledWith("t1");
  });

  it("marks a series stand-in as set, so the rule is not written twice, and never cancels it by a made-up id", async () => {
    const ref = await mount();
    jest.mocked(fetchTimers).mockRejectedValueOnce(new Error("offline"));
    await act(async () => ref.current!.get().recordSeries());
    expect(createSeriesTimer).toHaveBeenCalledTimes(1);
    expect(ref.current!.get().seriesTimerId).toBeTruthy();
    await act(async () => ref.current!.get().cancelSeries());
    expect(cancelSeriesTimer).not.toHaveBeenCalled();
  });

  it("an airing cancelled out of a series still shows the rule set and cancels the rule by its id", async () => {
    jest.mocked(fetchTimers).mockResolvedValue([{ ...serverTimer, Status: "Cancelled", SeriesTimerId: "s1" }] as never);
    jest.mocked(fetchSeriesTimers).mockResolvedValue([{ Id: "s1", Name: "News", ProgramId: "p0" }] as never);
    const ref = await mount();
    expect(ref.current!.get().timer).toBeNull();
    expect(ref.current!.get().seriesTimerId).toBe("s1");
    jest.mocked(fetchSeriesTimers).mockResolvedValue([]);
    await act(async () => ref.current!.get().cancelSeries());
    expect(cancelSeriesTimer).toHaveBeenCalledWith("s1");
    expect(ref.current!.get().seriesTimerId).toBeNull();
  });

  it("a timer linked to a deleted rule reads as no series", async () => {
    jest.mocked(fetchTimers).mockResolvedValue([{ ...serverTimer, Status: "Cancelled", SeriesTimerId: "gone" }] as never);
    const ref = await mount();
    expect(ref.current!.get().seriesTimerId).toBeNull();
  });

  it("clears the timer when a stop landed but the re-read failed", async () => {
    jest.mocked(fetchTimers).mockResolvedValue([serverTimer] as never);
    const ref = await mount();
    jest.mocked(fetchTimers).mockRejectedValueOnce(new Error("offline"));
    await act(async () => ref.current!.get().cancel());
    expect(cancelTimer).toHaveBeenCalledWith("t1");
    expect(ref.current!.get().timer).toBeNull();
  });

  it("reports a failed write and keeps the timer as read", async () => {
    const ref = await mount();
    jest.mocked(createTimer).mockRejectedValueOnce(new Error("500"));
    jest.mocked(fetchTimerDefaults).mockResolvedValueOnce({} as never);
    await act(async () => ref.current!.get().record());
    expect(showToast).toHaveBeenCalledWith("liveTv.recordingFailed", "error");
    expect(ref.current!.get().timer).toBeNull();
  });
});
