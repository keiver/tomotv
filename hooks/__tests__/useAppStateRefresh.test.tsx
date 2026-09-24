/**
 * The foreground refresh: fires on a return from the background, never on the launch's inactive-to-active.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { AppState, type AppStateStatus } from "react-native";

const mockHeld = jest.fn(() => false);
jest.mock("@/services/playbackHold", () => ({ isPlaybackHeld: () => mockHeld() }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { useAppStateRefresh } from "@/hooks/useAppStateRefresh";

let listener: ((state: AppStateStatus) => void) | null = null;

function Probe({ onForeground }: { onForeground: () => void }) {
  useAppStateRefresh(onForeground, "test");
  return null;
}

function mount(onForeground: () => void) {
  act(() => {
    TestRenderer.create(<Probe onForeground={onForeground} />);
  });
}

describe("useAppStateRefresh", () => {
  beforeEach(() => {
    listener = null;
    mockHeld.mockReset().mockReturnValue(false);
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      listener = handler as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it("does not fire when a release launch goes from inactive to active", () => {
    (AppState as { currentState: string }).currentState = "inactive";
    const onForeground = jest.fn();
    mount(onForeground);
    listener?.("active");
    expect(onForeground).not.toHaveBeenCalled();
  });

  it("fires once on a return from the background, through the inactive step", () => {
    (AppState as { currentState: string }).currentState = "active";
    const onForeground = jest.fn();
    mount(onForeground);
    listener?.("inactive");
    listener?.("background");
    listener?.("inactive");
    listener?.("active");
    expect(onForeground).toHaveBeenCalledTimes(1);
    listener?.("inactive");
    listener?.("active");
    expect(onForeground).toHaveBeenCalledTimes(1);
  });

  it("skips the refresh while playback holds the link", () => {
    (AppState as { currentState: string }).currentState = "active";
    mockHeld.mockReturnValue(true);
    const onForeground = jest.fn();
    mount(onForeground);
    listener?.("background");
    listener?.("active");
    expect(onForeground).not.toHaveBeenCalled();
  });
});
