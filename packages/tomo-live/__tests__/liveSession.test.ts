/** liveSession - a live session watched for its whole life: reopens in place, and what an ending asks for. */

const mockLiveListeners = new Map<string, (event: unknown) => void>();
const mockFailureListeners = new Map<string, (failure: { token: string; message: string }) => void>();
const liveListeners = mockLiveListeners;
const failureListeners = mockFailureListeners;
jest.mock("@keiver/tomo-engine", () => ({
  subscribeEngineLive: (token: string, listener: (event: unknown) => void) => {
    mockLiveListeners.set(token, listener);
    return () => mockLiveListeners.delete(token);
  },
  subscribeEngineFailure: (token: string, listener: (failure: { token: string; message: string }) => void) => {
    mockFailureListeners.set(token, listener);
    return () => mockFailureListeners.delete(token);
  },
}));

import { LIVE_RECOVERY_RESET_MS } from "../src/liveRecovery";
import { LiveDropCounter, watchLiveSession } from "../src/liveSession";

beforeEach(() => {
  liveListeners.clear();
  failureListeners.clear();
});

it("passes the engine's in-session reopen and its return to the app", () => {
  const onReopening = jest.fn();
  const onReopened = jest.fn();
  watchLiveSession("t1", new LiveDropCounter(), { onReopening, onReopened });
  liveListeners.get("t1")!({ token: "t1", event: "reopening", reason: "no data for 12s" });
  liveListeners.get("t1")!({ token: "t1", event: "reopened", reason: "no data for 12s", attempts: 2 });
  expect(onReopening).toHaveBeenCalledWith(expect.objectContaining({ event: "reopening" }));
  expect(onReopened).toHaveBeenCalledWith(expect.objectContaining({ attempts: 2 }));
});

it("asks for a fresh start with a growing wait when a session ends, across the channel's sessions", () => {
  let now = 1_000_000;
  const drops = new LiveDropCounter(() => now);
  const onEnded = jest.fn();
  watchLiveSession("t1", drops, { onEnded });
  failureListeners.get("t1")!({ token: "t1", message: "live input lost: the origin ended the stream" });
  watchLiveSession("t2", drops, { onEnded });
  now += 5_000;
  failureListeners.get("t2")!({ token: "t2", message: "live input lost: the origin ended the stream" });
  expect(onEnded.mock.calls.map(([, decision]) => decision)).toEqual([
    { reopen: true, delayMs: 500 },
    { reopen: true, delayMs: 1000 },
  ]);
});

it("starts the wait over once the channel played a minute without a drop", () => {
  let now = 1_000_000;
  const drops = new LiveDropCounter(() => now);
  expect(drops.drop()).toBe(0);
  now += 1000;
  expect(drops.drop()).toBe(1);
  now += LIVE_RECOVERY_RESET_MS;
  expect(drops.drop()).toBe(0);
});

it("asks for nothing more when the channel cannot play", () => {
  const onEnded = jest.fn();
  watchLiveSession("t1", new LiveDropCounter(), { onEnded });
  failureListeners.get("t1")!({ token: "t1", message: "origin refused every variant (HTTP 403)" });
  expect(onEnded).toHaveBeenCalledWith("origin refused every variant (HTTP 403)", { reopen: false });
});

it("stops listening when the watch ends", () => {
  const stop = watchLiveSession("t1", new LiveDropCounter(), {});
  stop();
  expect(liveListeners.has("t1")).toBe(false);
  expect(failureListeners.has("t1")).toBe(false);
});
