/** Live TV's player slot: what it shows under the player while the channel opens, fails, or is held by a recording. */
import { LivePreviewSlot } from "@/components/live-tv/live-preview-slot";
import React from "react";
import { ActivityIndicator, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockSession = {
  setInlineFrame: jest.fn(),
  retry: jest.fn(),
  hostMode: "loading",
  playbackState: { type: "LOADING" } as Record<string, unknown>,
  sessionVideoId: "c1" as string | null,
};
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: () => mockSession }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("@/hooks/useLiveFrame", () => ({ useLiveFrame: () => undefined }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
const mockHold = {
  held: false,
  holdingTimer: null as object | null,
  reason: null as string | null,
  stopping: false,
  opening: false,
  stopAndPlay: jest.fn(),
  watch: jest.fn(),
};
const mockHoldArgs: unknown[][] = [];
jest.mock("@/hooks/useRecordingHoldChoices", () => ({
  useRecordingHoldChoices: (...args: unknown[]) => {
    mockHoldArgs.push(args);
    return mockHold;
  },
}));

const { FocusableButton } = jest.requireMock("@/components/FocusableButton") as { FocusableButton: React.ComponentType };
const channel = { Id: "c1", Name: "One", Type: "TvChannel" };

describe("LivePreviewSlot", () => {
  let renderer: TestRenderer.ReactTestRenderer;
  beforeEach(() => {
    jest.clearAllMocks();
    mockHoldArgs.length = 0;
    Object.assign(mockSession, { hostMode: "loading", playbackState: { type: "LOADING" }, sessionVideoId: "c1" });
    Object.assign(mockHold, { held: false, holdingTimer: null, reason: null, stopping: false, opening: false });
  });
  afterEach(async () => {
    await act(async () => renderer.unmount());
  });
  const mount = async () => {
    await act(async () => {
      renderer = TestRenderer.create(<LivePreviewSlot channel={channel as never} />);
    });
  };
  const buttons = () => renderer.root.findAllByType(FocusableButton).map((node) => node.props as { title: string; onPress: () => void });
  const texts = () => renderer.root.findAllByType(Text).map((node) => node.props.children);

  it("shows a spinner while the channel opens", async () => {
    await mount();
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(buttons()).toHaveLength(0);
  });

  it("says why the channel cannot play while a recording holds its provider, with both ways out", async () => {
    Object.assign(mockSession, { hostMode: "error", playbackState: { type: "ERROR", ref: { id: "PB-LIVE-RECORDING" } } });
    Object.assign(mockHold, { held: true, holdingTimer: { Id: "t1" }, reason: "Your provider allows one stream at a time, and the recording on News is using it until 9:00 PM." });
    await mount();

    expect(texts()).toEqual(["Your provider allows one stream at a time, and the recording on News is using it until 9:00 PM."]);
    expect(buttons().map((button) => button.title)).toEqual(["liveTv.stopRecordingAndPlay", "liveTv.watchRecording"]);
    buttons()[0].onPress();
    buttons()[1].onPress();
    expect(mockHold.stopAndPlay).toHaveBeenCalledTimes(1);
    expect(mockHold.watch).toHaveBeenCalledTimes(1);
  });

  it("reads the hold for the channel the session plays, and opens the recording in the player", async () => {
    mockSession.sessionVideoId = "c2";
    await mount();
    const [channelId, state, retry, open] = mockHoldArgs[mockHoldArgs.length - 1] as [string, unknown, unknown, (item: { Id: string; Name: string }) => void];
    expect(channelId).toBe("c2");
    expect(state).toBe(mockSession.playbackState);
    expect(retry).toBe(mockSession.retry);
    open({ Id: "rec-1", Name: "News at Nine" });
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/player", params: { videoId: "rec-1", videoName: "News at Nine" } });
  });

  it("shows a spinner while the recording stops and the channel opens again", async () => {
    Object.assign(mockSession, { hostMode: "error" });
    Object.assign(mockHold, { held: true, holdingTimer: { Id: "t1" }, reason: "held", stopping: true });
    await mount();
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(buttons()).toHaveLength(0);
  });

  it("offers Retry for any other failure", async () => {
    Object.assign(mockSession, { hostMode: "error", playbackState: { type: "ERROR", error: "boom" } });
    await mount();
    expect(texts()).toEqual(["player.unableToPlay"]);
    expect(buttons().map((button) => button.title)).toEqual(["common.retry"]);
    buttons()[0].onPress();
    expect(mockSession.retry).toHaveBeenCalledTimes(1);
  });

  it("draws nothing over a playing channel", async () => {
    mockSession.hostMode = "video";
    await mount();
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(buttons()).toHaveLength(0);
  });
});
