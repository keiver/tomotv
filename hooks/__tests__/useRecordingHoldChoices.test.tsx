/** A channel a recording holds the provider for: why it cannot play, and the two ways out of it. */
import { isRecordingHold, useRecordingHoldChoices } from "@/hooks/useRecordingHoldChoices";
import type { VideoPlayerState } from "@/hooks/useVideoPlayback";
import { PLAYBACK_ERROR_IDS } from "@/utils/errorIds";
import React from "react";
import { Alert } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockTimer = { Id: "t1", Name: "News at Nine", ChannelId: "c1", ChannelName: "News", Status: "InProgress", StartDate: "2026-11-03T20:00:00Z", EndDate: "2026-11-03T21:00:00Z" };
jest.mock("@/hooks/useRecordingStatus", () => ({ useHeldRecording: (_channelId: string, active: boolean) => (active ? mockTimer : null) }));
const mockStopRecordingAndPlay = jest.fn(async () => {});
const mockRecordingWhenReady = jest.fn(async () => ({ Id: "rec-1", Name: "News at Nine" }));
const mockAdmitUntilPlaying = jest.fn();
jest.mock("@/services/recordingHold", () => ({
  stopRecordingAndPlay: (...args: unknown[]) => mockStopRecordingAndPlay(...(args as [])),
  recordingWhenReady: (...args: unknown[]) => mockRecordingWhenReady(...(args as [])),
  admitUntilPlaying: (...args: unknown[]) => mockAdmitUntilPlaying(...args),
}));
jest.mock("@/services/liveTvPreferences", () => ({ getLiveTvPreferences: () => ({}), channelDisplayName: (_prefs: unknown, channel: { Name: string }) => channel.Name }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => (key === "player.error.recordingHold" ? "one stream; {channel} until {time}" : key) }));
jest.mock("@/services/toast", () => ({ showToast: jest.fn() }));
jest.mock("@/utils/logger", () => ({ logger: { warn: jest.fn() } }));
jest.mock("@/utils/guide", () => ({ formatClock: () => "9:00 PM" }));

const held: VideoPlayerState = { type: "ERROR", error: "live origin is held by a recording", canRetryWithTranscode: false, ref: { id: PLAYBACK_ERROR_IDS.LIVE_RECORDING } } as VideoPlayerState;
const other: VideoPlayerState = { type: "ERROR", error: "boom", canRetryWithTranscode: false } as VideoPlayerState;

const renders: ReturnType<typeof useRecordingHoldChoices>[] = [];
const latest = () => renders[renders.length - 1];
function Probe({ state, retry, open }: { state: VideoPlayerState; retry: () => void; open: (item: { Id: string }) => void }) {
  renders.push(useRecordingHoldChoices("c1", state, retry, open));
  return null;
}

describe("useRecordingHoldChoices", () => {
  let renderer: TestRenderer.ReactTestRenderer;
  const retry = jest.fn();
  const open = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    renders.length = 0;
  });
  afterEach(async () => {
    await act(async () => renderer.unmount());
  });
  const mount = async (state: VideoPlayerState) => {
    await act(async () => {
      renderer = TestRenderer.create(<Probe state={state} retry={retry} open={open} />);
    });
  };

  it("says the provider allows one stream and names the recording's channel and end time", async () => {
    await mount(held);
    expect(latest().held).toBe(true);
    expect(latest().reason).toBe("one stream; News until 9:00 PM");
  });

  it("is not a hold for any other failure", async () => {
    await mount(other);
    expect(isRecordingHold(other)).toBe(false);
    expect(latest().held).toBe(false);
    expect(latest().reason).toBeNull();
  });

  it("stops the recording after the viewer confirms, then plays the channel again", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await mount(held);
    await act(async () => latest().stopAndPlay());
    const confirm = (alert.mock.calls[0][2] as { style?: string; onPress?: () => void }[]).find((choice) => choice.style === "destructive")!;
    await act(async () => confirm.onPress!());
    expect(mockStopRecordingAndPlay).toHaveBeenCalledWith(mockTimer, "c1");
    expect(retry).toHaveBeenCalledTimes(1);
    expect(latest().stopping).toBe(false);
    alert.mockRestore();
  });

  it("opens the recording", async () => {
    await mount(held);
    await act(async () => latest().watch());
    expect(open).toHaveBeenCalledWith({ Id: "rec-1", Name: "News at Nine" });
  });

  it("clears the one-connection admission when the screen goes", async () => {
    await mount(held);
    await act(async () => renderer.unmount());
    expect(mockAdmitUntilPlaying).toHaveBeenCalledWith(null);
    await act(async () => {
      renderer = TestRenderer.create(<Probe state={other} retry={retry} open={open} />);
    });
  });
});
