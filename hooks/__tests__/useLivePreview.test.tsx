/** Live TV's player slot: which session command a channel tap sends, and how the screen lets the session go. */
import { useLivePreview } from "@/hooks/useLivePreview";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockSession = {
  requestSession: jest.fn(),
  switchLiveChannel: jest.fn(),
  presentFullscreen: jest.fn(),
  retry: jest.fn(),
  releaseRoute: jest.fn(),
  setHandlers: jest.fn(),
  clearHandlers: jest.fn(),
  sessionVideoId: null as string | null,
  hostMode: "idle",
};
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: () => mockSession }));

let mockFocused = true;
const mockTransitionListeners: ((event: { data: { closing: boolean } }) => void)[] = [];
const mockNavigation = {
  addListener: (_event: string, listener: (event: { data: { closing: boolean } }) => void) => {
    mockTransitionListeners.push(listener);
    return () => mockTransitionListeners.splice(mockTransitionListeners.indexOf(listener), 1);
  },
};
jest.mock("expo-router", () => ({ useIsFocused: () => mockFocused, useNavigation: () => mockNavigation }));

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
async function hostShows(videoId: string | null, hostMode: string) {
  mockSession.sessionVideoId = videoId;
  mockSession.hostMode = hostMode;
  await rerender();
}

describe("useLivePreview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocused = true;
    mockTransitionListeners.length = 0;
    mockSession.sessionVideoId = null;
    mockSession.hostMode = "idle";
  });

  afterEach(async () => {
    await act(async () => renderer.unmount());
  });

  it("starts an inline live session on the first tap and shows the channel in the slot", async () => {
    await mount();
    await act(async () => latest().preview(one as never));

    expect(mockSession.requestSession).toHaveBeenCalledWith(expect.objectContaining({ videoId: "c1", videoName: "One", isLive: true, inline: true }));
    expect(mockSession.setHandlers).toHaveBeenCalledTimes(1);
    expect(latest().channel?.Id).toBe("c1");
  });

  it("switches the slot to another channel in the same player", async () => {
    await mount();
    await act(async () => latest().preview(one as never));
    await hostShows("c1", "video");

    await act(async () => latest().preview(two as never));

    expect(mockSession.switchLiveChannel).toHaveBeenCalledWith({ videoId: "c2", videoName: "Two", picked: true });
    expect(mockSession.requestSession).toHaveBeenCalledTimes(1);
    expect(latest().channel?.Id).toBe("c2");
  });

  it("opens the playing channel full screen on a second tap", async () => {
    await mount();
    await act(async () => latest().preview(one as never));
    await hostShows("c1", "video");

    await act(async () => latest().preview(one as never));

    expect(mockSession.presentFullscreen).toHaveBeenCalledTimes(1);
  });

  it("retries the channel that failed in the slot when it is tapped again", async () => {
    await mount();
    await act(async () => latest().preview(one as never));
    await hostShows("c1", "error");

    await act(async () => latest().preview(one as never));

    expect(mockSession.retry).toHaveBeenCalledTimes(1);
  });

  it("starts its own session over one it does not own, even on the same channel", async () => {
    mockSession.sessionVideoId = "c1";
    mockSession.hostMode = "video";
    await mount();

    await act(async () => latest().preview(one as never));

    expect(mockSession.presentFullscreen).not.toHaveBeenCalled();
    expect(mockSession.requestSession).toHaveBeenCalledWith(expect.objectContaining({ videoId: "c1", inline: true }));
  });

  it("lets the session go, naming the channel playing, as a screen pushed over it starts to appear", async () => {
    await mount();
    await act(async () => latest().preview(one as never));
    const key = mockSession.requestSession.mock.calls[0][0].sessionKey;
    await act(async () => latest().preview(two as never));
    await hostShows("c2", "video");

    await act(async () => mockTransitionListeners.forEach((listener) => listener({ data: { closing: true } })));

    expect(mockSession.clearHandlers).toHaveBeenCalledWith(mockSession.setHandlers.mock.calls[0][0]);
    expect(mockSession.releaseRoute).toHaveBeenCalledWith({ videoId: "c2", sessionKey: key });
    expect(latest().channel).toBeNull();
  });

  it("keeps the session while the screen itself is appearing", async () => {
    await mount();
    await act(async () => latest().preview(one as never));
    await hostShows("c1", "video");

    await act(async () => mockTransitionListeners.forEach((listener) => listener({ data: { closing: false } })));

    expect(mockSession.releaseRoute).not.toHaveBeenCalled();
  });

  it("lets the session go when the screen loses focus, once", async () => {
    await mount();
    await act(async () => latest().preview(one as never));
    await hostShows("c1", "video");

    mockFocused = false;
    await rerender();
    await act(async () => mockTransitionListeners.forEach((listener) => listener({ data: { closing: true } })));

    expect(mockSession.releaseRoute).toHaveBeenCalledTimes(1);
  });

  it("releases nothing when no channel was tapped", async () => {
    await mount();
    mockFocused = false;
    await rerender();

    expect(mockSession.releaseRoute).not.toHaveBeenCalled();
    expect(mockSession.clearHandlers).not.toHaveBeenCalled();
  });
});
