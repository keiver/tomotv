/** Live TV's pinned channel: what a channel tap sends the session, the close, the airing programme's full screen, and how the screen lets the session go. */
import { useLivePreview } from "@/hooks/useLivePreview";
import React from "react";
import { Alert } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockSession = {
  requestSession: jest.fn(),
  switchLiveChannel: jest.fn(),
  presentFullscreen: jest.fn(),
  retry: jest.fn(),
  releaseRoute: jest.fn(),
  setHandlers: jest.fn(),
  clearHandlers: jest.fn(),
  setInlineFrame: jest.fn(),
  sessionVideoId: null as string | null,
  hostMode: "idle",
  playbackState: { type: "IDLE" } as Record<string, unknown>,
};
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: () => mockSession }));
const mockTapFeedback = jest.fn();
jest.mock("@/services/haptics", () => ({ tapFeedback: () => mockTapFeedback() }));
const mockShowToast = jest.fn();
const mockDismissToast = jest.fn();
jest.mock("@/services/toast", () => ({ showToast: (options: unknown) => mockShowToast(options), dismissToast: (id: string) => mockDismissToast(id) }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
const mockHold = { held: false, holdingTimer: null as object | null, reason: null as string | null, stopping: false, opening: false, stopAndPlay: jest.fn(), watch: jest.fn() };
let mockOpenRecording: (item: { Id: string; Name: string }) => void = () => {};
jest.mock("@/hooks/useRecordingHoldChoices", () => ({
  useRecordingHoldChoices: (_channelId: string, _state: unknown, _retry: unknown, openRecording: typeof mockOpenRecording) => {
    mockOpenRecording = openRecording;
    return mockHold;
  },
}));

let mockFocused = true;
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useIsFocused: () => mockFocused, useRouter: () => ({ push: mockPush }) }));

const one = { Id: "c1", Name: "One", Type: "TvChannel" };
const two = { Id: "c2", Name: "Two", Type: "TvChannel" };

const renders: ReturnType<typeof useLivePreview>[] = [];
const latest = () => renders[renders.length - 1];
function Probe() {
  renders.push(useLivePreview());
  return null;
}

let renderer: TestRenderer.ReactTestRenderer;
async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(<Probe />);
  });
}
async function rerender() {
  await act(async () => renderer.update(<Probe />));
}
/** The host's published state after a command, as the provider would hand it back. */
async function hostShows(videoId: string | null, hostMode: string, playback = "PLAYING") {
  mockSession.sessionVideoId = videoId;
  mockSession.hostMode = hostMode;
  mockSession.playbackState = { type: playback };
  await rerender();
}

describe("useLivePreview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocused = true;
    mockSession.sessionVideoId = null;
    mockSession.hostMode = "idle";
    mockSession.playbackState = { type: "IDLE" };
    Object.assign(mockHold, { held: false, holdingTimer: null, reason: null, stopping: false, opening: false });
  });

  afterEach(async () => {
    await act(async () => renderer.unmount());
  });

  it("pins a tapped channel as an inline live session, with a tap under the finger", async () => {
    await mount();
    await act(async () => latest().pin(one as never));

    expect(mockSession.requestSession).toHaveBeenCalledWith(expect.objectContaining({ videoId: "c1", videoName: "One", isLive: true, inline: true }));
    expect(mockSession.setHandlers).toHaveBeenCalledTimes(1);
    expect(mockTapFeedback).toHaveBeenCalledTimes(1);
    expect(latest().channel?.Id).toBe("c1");
  });

  it("says the pinned channel is opening until it plays", async () => {
    await mount();
    await act(async () => latest().pin(one as never));
    await hostShows("c1", "loading", "FETCHING_METADATA");
    expect(latest().opening).toBe(true);
    await hostShows("c1", "video", "PLAYING");
    expect(latest().opening).toBe(false);
  });

  it("switches the pin to another channel in the same player", async () => {
    await mount();
    await act(async () => latest().pin(one as never));
    await hostShows("c1", "video");

    await act(async () => latest().pin(two as never));

    expect(mockSession.switchLiveChannel).toHaveBeenCalledWith({ videoId: "c2", videoName: "Two", picked: true });
    expect(mockSession.requestSession).toHaveBeenCalledTimes(1);
    expect(latest().channel?.Id).toBe("c2");
  });

  it("does nothing on the pinned channel's own card", async () => {
    await mount();
    await act(async () => latest().pin(one as never));
    await hostShows("c1", "video");

    await act(async () => latest().pin(one as never));

    expect(mockSession.presentFullscreen).not.toHaveBeenCalled();
    expect(mockSession.switchLiveChannel).not.toHaveBeenCalled();
    expect(mockTapFeedback).toHaveBeenCalledTimes(1);
  });

  it("retries the pinned channel once it failed", async () => {
    await mount();
    await act(async () => latest().pin(one as never));
    await hostShows("c1", "error");

    await act(async () => latest().pin(one as never));

    expect(mockSession.retry).toHaveBeenCalledTimes(1);
  });

  it("opens the pinned channel's airing programme full screen without a new session, and leaves any other channel to the caller", async () => {
    await mount();
    await act(async () => latest().pin(one as never));
    await hostShows("c1", "video");

    let handled: boolean[] = [];
    await act(async () => {
      handled = [latest().fullscreen("c1"), latest().fullscreen("c2")];
    });

    expect(handled).toEqual([true, false]);
    expect(mockSession.presentFullscreen).toHaveBeenCalledTimes(1);
    expect(mockSession.requestSession).toHaveBeenCalledTimes(1);
  });

  it("opens the pinned channel full screen from a tap on its band, and nothing with no pin", async () => {
    await mount();
    await act(async () => latest().open());
    expect(mockSession.presentFullscreen).not.toHaveBeenCalled();

    await act(async () => latest().pin(one as never));
    await hostShows("c1", "video");
    await act(async () => latest().open());

    expect(mockSession.presentFullscreen).toHaveBeenCalledTimes(1);
    expect(mockSession.requestSession).toHaveBeenCalledTimes(1);
  });

  it("hands the band's slot to the host, and null to park the player", async () => {
    const slot = { x: 0, y: 120, width: 176, height: 99 };
    await mount();
    await act(async () => latest().setSlot(slot));
    await act(async () => latest().setSlot(null));
    expect(mockSession.setInlineFrame.mock.calls).toEqual([[slot], [null]]);
  });

  it("lets the session go and clears the pin on close, with a tap under the finger", async () => {
    await mount();
    await act(async () => latest().pin(one as never));
    const key = mockSession.requestSession.mock.calls[0][0].sessionKey;
    await hostShows("c1", "video");

    await act(async () => latest().close());

    expect(mockSession.releaseRoute).toHaveBeenCalledWith({ videoId: "c1", sessionKey: key });
    expect(mockSession.clearHandlers).toHaveBeenCalledTimes(1);
    expect(mockSession.setInlineFrame).toHaveBeenLastCalledWith(null);
    expect(mockTapFeedback).toHaveBeenCalledTimes(2);
    expect(latest().channel).toBeNull();
  });

  it("lets the session go, naming the channel playing, when the screen loses focus", async () => {
    await mount();
    await act(async () => latest().pin(one as never));
    const key = mockSession.requestSession.mock.calls[0][0].sessionKey;
    await hostShows("c1", "video");
    await act(async () => latest().pin(two as never));
    await hostShows("c2", "video");

    mockFocused = false;
    await rerender();

    expect(mockSession.releaseRoute).toHaveBeenCalledWith({ videoId: "c2", sessionKey: key });
    expect(latest().channel).toBeNull();
  });

  it("says the channel failed when it cannot play", async () => {
    await mount();
    await act(async () => latest().pin(one as never));
    await hostShows("c1", "error");
    expect(mockShowToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "player.unableToPlay", kind: "error" }));
  });

  it("asks once, with both ways out, when a recording holds the provider", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await mount();
    await act(async () => latest().pin(one as never));
    Object.assign(mockHold, { held: true, holdingTimer: { Id: "t1" }, reason: "held by the recording" });
    await hostShows("c1", "error");
    await rerender();

    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe("One");
    expect(message).toBe("held by the recording");
    expect((buttons ?? []).map((button) => button.text)).toEqual(["common.cancel", "liveTv.stopRecordingAndPlay", "liveTv.watchRecording"]);
    alert.mockRestore();
  });

  /** The band's record press on a one-connection provider: the live read ends and the recording holds it. */
  async function recordHere() {
    await mount();
    await act(async () => latest().pin(one as never));
    await hostShows("c1", "video");
    await act(async () => latest().expectRecording());
    Object.assign(mockHold, { held: true, holdingTimer: { Id: "t1" }, reason: "held by the recording" });
    mockHold.watch.mockImplementationOnce(() => {
      mockHold.opening = true;
    });
    await hostShows("c1", "error");
  }

  it("plays the recording the band started in the band once it has the stream, asking nothing", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await recordHere();
    const key = mockSession.requestSession.mock.calls[0][0].sessionKey;

    expect(mockHold.watch).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "player.unableToPlay" }));
    await act(async () => mockOpenRecording({ Id: "r1", Name: "One recording" }));

    expect(mockSession.requestSession).toHaveBeenLastCalledWith({ videoId: "r1", videoName: "One recording", inline: true, sessionKey: key });
    expect(mockPush).not.toHaveBeenCalled();
    expect(latest().channel?.Id).toBe("c1");
    expect(latest().playsRecording).toBe(true);
    alert.mockRestore();
  });

  it("shows the band opening while it waits for the recording", async () => {
    await mount();
    await act(async () => latest().pin(one as never));
    await hostShows("c1", "video");
    await act(async () => latest().expectRecording());
    await hostShows("c1", "error");
    expect(latest().opening).toBe(true);
  });

  it("keeps the pin on the channel while its recording plays: its own card does nothing, another starts a live session, its programme goes full screen", async () => {
    await recordHere();
    await act(async () => mockOpenRecording({ Id: "r1", Name: "One recording" }));
    Object.assign(mockHold, { held: false, holdingTimer: null, reason: null, opening: false });
    await hostShows("r1", "video");
    mockTapFeedback.mockClear();

    await act(async () => latest().pin(one as never));
    expect(mockTapFeedback).not.toHaveBeenCalled();

    let handled = false;
    await act(async () => {
      handled = latest().fullscreen("c1");
    });
    expect(handled).toBe(true);
    expect(mockSession.presentFullscreen).toHaveBeenCalledTimes(1);

    await act(async () => latest().pin(two as never));
    expect(mockSession.switchLiveChannel).not.toHaveBeenCalled();
    expect(mockSession.requestSession).toHaveBeenLastCalledWith(expect.objectContaining({ videoId: "c2", isLive: true, inline: true }));
  });

  it("brings the channel back when the record write failed", async () => {
    await mount();
    await act(async () => latest().pin(one as never));
    await hostShows("c1", "video");
    await act(async () => latest().expectRecording());
    await hostShows("c1", "error");

    await act(async () => latest().recordingSettled(false));

    expect(mockSession.retry).toHaveBeenCalledTimes(1);
    expect(latest().opening).toBe(false);
  });

  it("plays on when the recording took no connection from this device", async () => {
    await mount();
    await act(async () => latest().pin(one as never));
    await hostShows("c1", "video");
    await act(async () => latest().expectRecording());
    await act(async () => latest().recordingSettled(true));
    Object.assign(mockHold, { held: true, holdingTimer: { Id: "t1" }, reason: "held by the recording" });
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await hostShows("c1", "error");

    expect(mockSession.retry).not.toHaveBeenCalled();
    expect(mockHold.watch).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it("releases nothing when no channel was pinned", async () => {
    await mount();
    mockFocused = false;
    await rerender();
    await act(async () => latest().close());

    expect(mockSession.releaseRoute).not.toHaveBeenCalled();
    expect(mockTapFeedback).not.toHaveBeenCalled();
  });
});
