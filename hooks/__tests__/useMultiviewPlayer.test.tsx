/** Multiview's spot with the sound: one inline session, switched in place, presented full screen on a press, and let go with the screen. */
import { useMultiviewPlayer } from "@/hooks/useMultiviewPlayer";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockSession = {
  requestSession: jest.fn(),
  switchLiveChannel: jest.fn(),
  presentFullscreen: jest.fn(),
  releaseRoute: jest.fn(),
  setHandlers: jest.fn(),
  clearHandlers: jest.fn(),
  setInlineFrame: jest.fn(),
  setInlineOverlay: jest.fn(),
  setInlineMuted: jest.fn(),
  sessionVideoId: null as string | null,
  hostMode: "idle",
  playbackState: { type: "IDLE" } as Record<string, unknown>,
};
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: () => mockSession }));
jest.mock("@/services/haptics", () => ({ tapFeedback: jest.fn() }));

const one = { Id: "c1", Name: "One" };
const two = { Id: "c2", Name: "Two" };
const renders: ReturnType<typeof useMultiviewPlayer>[] = [];
const latest = () => renders[renders.length - 1];
function Probe({ channel, focused = true }: { channel: typeof one | null; focused?: boolean }) {
  renders.push(useMultiviewPlayer(channel, focused));
  return null;
}

let renderer: TestRenderer.ReactTestRenderer;
async function mount(channel: typeof one | null) {
  await act(async () => {
    renderer = TestRenderer.create(<Probe channel={channel} />);
  });
}
async function show(channel: typeof one | null, focused = true) {
  await act(async () => renderer.update(<Probe channel={channel} focused={focused} />));
}
async function hostPlays(videoId: string | null, hostMode = "video") {
  mockSession.sessionVideoId = videoId;
  mockSession.hostMode = hostMode;
  mockSession.playbackState = { type: "PLAYING" };
}

describe("useMultiviewPlayer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    renders.length = 0;
    mockSession.sessionVideoId = null;
    mockSession.hostMode = "idle";
    mockSession.playbackState = { type: "IDLE" };
  });

  afterEach(async () => {
    await act(async () => renderer.unmount());
  });

  it("asks the player for an inline Multiview session on the channel with the sound", async () => {
    await mount(one);
    expect(mockSession.requestSession).toHaveBeenCalledWith(expect.objectContaining({ videoId: "c1", isLive: true, inline: true, multiview: true }));
  });

  it("switches the same player to the new channel when the sound moves, with no new session", async () => {
    await mount(one);
    await hostPlays("c1");
    await show(two);
    expect(mockSession.requestSession).toHaveBeenCalledTimes(1);
    expect(mockSession.switchLiveChannel).toHaveBeenCalledWith({ videoId: "c2", videoName: "Two", picked: true });
  });

  it("presents the same player full screen on a press", async () => {
    await mount(one);
    act(() => latest().open());
    expect(mockSession.presentFullscreen).toHaveBeenCalledTimes(1);
    expect(mockSession.requestSession).toHaveBeenCalledTimes(1);
  });

  it("lets the session go when the screen leaves, by the channel the player plays now", async () => {
    await mount(one);
    await hostPlays("c1");
    await show(one);
    await act(async () => renderer.unmount());
    expect(mockSession.releaseRoute).toHaveBeenCalledWith({ videoId: "c1", sessionKey: expect.stringMatching(/^multiview:/) });
    expect(mockSession.setInlineFrame).toHaveBeenLastCalledWith(null);
    await mount(null);
  });

  it("asks again on focus once another screen took the player", async () => {
    await mount(one);
    await hostPlays("c1");
    await show(one);
    await hostPlays("movie");
    await show(one, false);
    expect(mockSession.requestSession).toHaveBeenCalledTimes(1);
    await show(one, true);
    expect(mockSession.requestSession).toHaveBeenCalledTimes(2);
  });

  it("reports playing only for its own channel, and mutes the inline picture on demand", async () => {
    await mount(one);
    await hostPlays("c1");
    await show(one);
    expect(latest().playing).toBe(true);
    act(() => latest().toggleMute());
    expect(mockSession.setInlineMuted).toHaveBeenLastCalledWith(true);
  });
});
