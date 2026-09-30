/** Record writes: a write that landed stands even when the re-read fails, and a cancel on that stand-in reads first. */
import { useRecordActions, type RecordTarget } from "@/hooks/useRecordActions";
import { cancelSeriesTimer, cancelTimer, createSeriesTimer, createTimer, fetchTimerDefaults, fetchTimers } from "@/services/jellyfinApi";
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
    expect(ref.current!.get().timer?.SeriesTimerId).toBeTruthy();
    await act(async () => ref.current!.get().cancelSeries());
    expect(cancelSeriesTimer).not.toHaveBeenCalled();
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
