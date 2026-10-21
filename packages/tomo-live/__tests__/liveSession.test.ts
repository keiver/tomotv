/** liveSession - a live session watched for its whole life: reopens in place, and what an ending asks for. */

const mockLiveListeners = new Map<string, (event: unknown) => void>();
const mockFailureListeners = new Map<string, (failure: { token: string; message: string }) => void>();
const liveListeners = mockLiveListeners;
const failureListeners = mockFailureListeners;
const mockStopped: string[] = [];
jest.mock("@keiver/tomo-engine", () => ({
  LIVE_BUFFER_SECONDS: 15,
  engineProgress: async () => null,
  localRemuxToken: (url: string) => /^http:\/\/127\.0\.0\.1\/([^/]+)\//.exec(url)?.[1] ?? null,
  stopLocalRemux: async (token: string) => {
    mockStopped.push(token);
  },
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
import { LiveDropCounter, LivePlayback, watchLiveSession } from "../src/liveSession";
import type { RingSession } from "../src/liveRing";

beforeEach(() => {
  liveListeners.clear();
  failureListeners.clear();
  mockStopped.length = 0;
});

type Channel = { Id: string; LiveStreamId: string };

function controller(hot: RingSession<Channel> | null = null, warm: Channel | null = null) {
  const closed: string[] = [];
  const retained: string[] = [];
  const live = new LivePlayback<Channel>({
    closeChannel: (item) => closed.push(item.LiveStreamId),
    takeHot: async () => hot,
    takeWarm: () => warm,
    retain: (channel) => {
      retained.push(channel.token);
      return true;
    },
  });
  return { live, closed, retained };
}

describe("LivePlayback", () => {
  const ring: RingSession<Channel> = { channelId: "c1", details: { Id: "c1", LiveStreamId: "ls-ring" }, url: "http://127.0.0.1/t-ring/master.m3u8", token: "t-ring", ready: true };

  it("takes the ring's session for the channel and binds it once", async () => {
    const { live } = controller(ring);
    expect(await live.acquire("c1", () => true)).toEqual(ring.details);
    expect(live.takeAdopted("c1")).toEqual({ url: ring.url, token: "t-ring", ready: true });
    expect(live.takeAdopted("c1")).toBeNull();
  });

  it("lets go of a ring session taken for an attempt the viewer already left", async () => {
    const { live, closed } = controller(ring);
    expect(await live.acquire("c1", () => false)).toBeNull();
    expect(mockStopped).toEqual(["t-ring"]);
    expect(closed).toEqual(["ls-ring"]);
  });

  it("stops a session taken for another channel instead of binding it", async () => {
    const { live } = controller(ring);
    await live.acquire("c1", () => true);
    expect(live.takeAdopted("c2")).toBeNull();
    expect(mockStopped).toEqual(["t-ring"]);
  });

  it("hands a neighbour's resolve over when no session is hot", async () => {
    const warm = { Id: "c1", LiveStreamId: "ls-warm" };
    const { live } = controller(null, warm);
    expect(await live.acquire("c1", () => true)).toBe(warm);
  });

  it("closes what the app opened on a drop and asks for a growing wait", async () => {
    const { live, closed } = controller();
    await live.acquire("c1", () => true);
    live.opened({ Id: "c1", LiveStreamId: "ls-1" });
    live.bind("t1", "u1", {});
    expect(live.drop("live input lost: no data for 12s", false)).toEqual({ reopen: true, delayMs: 500 });
    expect(live.retryDelayMs).toBe(500);
    expect(closed).toEqual(["ls-1"]);
    expect(liveListeners.has("t1")).toBe(false);
    live.opened({ Id: "c1", LiveStreamId: "ls-2" });
    expect(live.drop("live input lost: no data for 12s", false)).toEqual({ reopen: true, delayMs: 1000 });
  });

  it("asks for nothing more on a failure no open fixes", async () => {
    const { live } = controller();
    await live.acquire("c1", () => true);
    expect(live.drop("channel is DRM protected (com.widevine)", false)).toEqual({ reopen: false });
    expect(live.drop("anything", true)).toEqual({ reopen: false });
    expect(live.retryDelayMs).toBeNull();
  });

  it("hands a channel that played to the ring with its session when the player leaves", async () => {
    const { live, closed, retained } = controller();
    await live.acquire("c1", () => true);
    live.opened({ Id: "c1", LiveStreamId: "ls-1" });
    live.bind("t1", "u1", {});
    expect(live.release(true)).toBe(true);
    expect(retained).toEqual(["t1"]);
    expect(closed).toEqual([]);
  });

  it("closes the channel when the player leaves one that never played", async () => {
    const { live, closed, retained } = controller();
    await live.acquire("c1", () => true);
    live.opened({ Id: "c1", LiveStreamId: "ls-1" });
    live.bind("t1", "u1", {});
    expect(live.release(false)).toBe(false);
    expect(retained).toEqual([]);
    expect(closed).toEqual(["ls-1"]);
  });
});

describe("LivePlayback open and play", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function player(hot: RingSession<Channel> | null = null) {
    const closed: string[] = [];
    const opened: string[] = [];
    const started: string[] = [];
    let opens = 0;
    const live = new LivePlayback<Channel>({
      closeChannel: (item) => closed.push(item.LiveStreamId),
      takeHot: async () => hot,
      takeWarm: () => null,
      openChannel: async (id) => {
        opens += 1;
        opened.push(id);
        return { Id: id, LiveStreamId: `ls-${opens}` };
      },
      startSession: async (item) => {
        started.push(item.LiveStreamId);
        return `http://127.0.0.1/t-${item.LiveStreamId}/master.m3u8`;
      },
    });
    return { live, closed, opened, started };
  }

  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  it("opens nothing for an attempt the viewer already left", async () => {
    const { live, opened } = player();
    expect(await live.open("c1", () => false)).toBeNull();
    expect(opened).toEqual([]);
  });

  it("closes an open that lands after the viewer left", async () => {
    const closed: string[] = [];
    let current = true;
    const live = new LivePlayback<Channel>({
      closeChannel: (item) => closed.push(item.LiveStreamId),
      takeHot: async () => null,
      takeWarm: () => null,
      openChannel: async (id) => {
        current = false;
        return { Id: id, LiveStreamId: "ls-1" };
      },
    });
    expect(await live.open("c1", () => current)).toBeNull();
    expect(closed).toEqual(["ls-1"]);
  });

  function buffering(read: () => number) {
    const live = new LivePlayback<Channel>({
      closeChannel: () => {},
      takeHot: async () => null,
      takeWarm: () => null,
      openChannel: async (id) => ({ Id: id, LiveStreamId: "ls-1" }),
      startSession: async () => "http://127.0.0.1/t-ls-1/master.m3u8",
      bufferedSeconds: async () => read(),
    });
    const urls: string[] = [];
    void live.play("c1", { onUrl: (url) => urls.push(url) });
    return urls;
  }

  it("hands the URL over only once the session holds 15 s", async () => {
    let buffered = 0;
    const urls = buffering(() => buffered);
    await flush();
    buffered = 14.9;
    jest.advanceTimersByTime(250);
    await flush();
    expect(urls).toEqual([]);
    buffered = 15;
    jest.advanceTimersByTime(250);
    await flush();
    expect(urls).toEqual(["http://127.0.0.1/t-ls-1/master.m3u8"]);
  });

  it("hands the URL over at the 35 s deadline when the session never holds 15 s", async () => {
    const urls = buffering(() => 8);
    await flush();
    for (let step = 0; step < 139; step++) {
      jest.advanceTimersByTime(250);
      await flush();
    }
    expect(urls).toEqual([]);
    jest.advanceTimersByTime(250);
    await flush();
    expect(urls).toEqual(["http://127.0.0.1/t-ls-1/master.m3u8"]);
  });

  it("keeps the next channel's ring session when the left channel's open lands late", async () => {
    const closed: string[] = [];
    const hotB: RingSession<Channel> = { channelId: "B", details: { Id: "B", LiveStreamId: "ls-ring-B" }, url: "http://127.0.0.1/t-B/master.m3u8", token: "t-B", ready: true };
    let landA: (item: Channel) => void = () => {};
    const live = new LivePlayback<Channel>({
      closeChannel: (item) => closed.push(item.LiveStreamId),
      takeHot: async (id) => (id === "B" ? hotB : null),
      takeWarm: () => null,
      openChannel: () =>
        new Promise<Channel>((resolve) => {
          landA = resolve;
        }),
    });
    let onA = true;
    const openingA = live.open("A", () => onA);
    await flush();
    onA = false;
    expect(await live.open("B", () => true)).toEqual(hotB.details);
    landA({ Id: "A", LiveStreamId: "ls-A" });
    expect(await openingA).toBeNull();
    expect(mockStopped).not.toContain("t-B");
    expect(live.takeAdopted("B")).toEqual({ url: hotB.url, token: "t-B", ready: true });
    expect(closed).toEqual(["ls-A"]);
  });

  it("plays a channel: opens it, starts its session and hands the URL over", async () => {
    const { live, started } = player();
    const urls: string[] = [];
    const states: string[] = [];
    await live.play("c1", { onUrl: (url) => urls.push(url), onState: (state) => states.push(state) });
    expect(started).toEqual(["ls-1"]);
    expect(urls).toEqual(["http://127.0.0.1/t-ls-1/master.m3u8"]);
    live.notePlaying();
    expect(states).toEqual(["opening", "buffering", "playing"]);
    expect(failureListeners.has("t-ls-1")).toBe(true);
  });

  it("binds a ring session for the channel without starting one", async () => {
    const ring: RingSession<Channel> = { channelId: "c1", details: { Id: "c1", LiveStreamId: "ls-ring" }, url: "http://127.0.0.1/t-ring/master.m3u8", token: "t-ring", ready: true };
    const { live, started, opened } = player(ring);
    const urls: string[] = [];
    await live.play("c1", { onUrl: (url) => urls.push(url) });
    expect(opened).toEqual([]);
    expect(started).toEqual([]);
    expect(urls).toEqual([ring.url]);
  });

  it("opens the channel again after the growing wait when its session ends, and hands the new URL over", async () => {
    const { live, closed } = player();
    const urls: string[] = [];
    const states: string[] = [];
    await live.play("c1", { onUrl: (url) => urls.push(url), onState: (state) => states.push(state) });
    failureListeners.get("t-ls-1")!({ token: "t-ls-1", message: "live input lost: the origin ended the stream" });
    expect(closed).toEqual(["ls-1"]);
    expect(mockStopped).toEqual(["t-ls-1"]);
    expect(live.state).toBe("reopening");
    jest.advanceTimersByTime(499);
    await flush();
    expect(urls).toHaveLength(1);
    jest.advanceTimersByTime(1);
    await flush();
    expect(urls).toEqual(["http://127.0.0.1/t-ls-1/master.m3u8", "http://127.0.0.1/t-ls-2/master.m3u8"]);
    live.fail("player error", false);
    expect(live.retryDelayMs).toBe(1000);
    expect(states).toEqual(["opening", "buffering", "reopening", "buffering", "reopening"]);
  });

  it("ends the play on a failure no open fixes", async () => {
    const { live } = player();
    const ended: string[] = [];
    await live.play("c1", { onUrl: () => undefined, onEnded: (message) => ended.push(message) });
    failureListeners.get("t-ls-1")!({ token: "t-ls-1", message: "channel is DRM protected (com.apple.streamingkeydelivery)" });
    expect(ended).toEqual(["channel is DRM protected (com.apple.streamingkeydelivery)"]);
    expect(live.state).toBe("failed");
    jest.runOnlyPendingTimers();
    await flush();
    expect(live.state).toBe("failed");
  });

  it("opens nothing more once stopped during the wait", async () => {
    const { live, opened } = player();
    const urls: string[] = [];
    await live.play("c1", { onUrl: (url) => urls.push(url) });
    live.fail("player error", false);
    live.stop();
    jest.runOnlyPendingTimers();
    await flush();
    expect(opened).toEqual(["c1"]);
    expect(urls).toHaveLength(1);
    expect(live.state).toBe("idle");
  });

  it("plays a channel the app already opened without opening it again, and reports each reopen's channel", async () => {
    const { live, opened } = player();
    const reopened: string[] = [];
    await live.play("c1", { onUrl: () => undefined, onOpened: (item) => reopened.push(item.LiveStreamId) }, { opened: { Id: "c1", LiveStreamId: "ls-app" } });
    expect(opened).toEqual([]);
    expect(failureListeners.has("t-ls-app")).toBe(true);
    failureListeners.get("t-ls-app")!({ token: "t-ls-app", message: "live input lost: the origin ended the stream" });
    jest.advanceTimersByTime(500);
    await flush();
    expect(opened).toEqual(["c1"]);
    expect(reopened).toEqual(["ls-1"]);
  });

  it("runs the app's step before binding a warming ring session, and binds a ready one without it", async () => {
    const warming: RingSession<Channel> = { channelId: "c1", details: { Id: "c1", LiveStreamId: "ls-ring" }, url: "http://127.0.0.1/t-ring/master.m3u8", token: "t-ring", ready: false };
    const { live } = player(warming);
    const prepared: { token: string; ready: boolean }[] = [];
    await live.play("c1", { onUrl: () => undefined, prepare: async ({ token, ready }) => void prepared.push({ token, ready }) });
    expect(prepared).toEqual([{ token: "t-ring", ready: false }]);
  });

  it("takes a failure of the app's step as a drop and stops that session", async () => {
    const { live } = player();
    const urls: string[] = [];
    await live.play("c1", {
      onUrl: (url) => urls.push(url),
      prepare: async () => {
        throw new Error("engine produced no segment within 20s");
      },
    });
    expect(urls).toEqual([]);
    expect(mockStopped).toEqual(["t-ls-1"]);
    expect(live.state).toBe("reopening");
  });

  it("ends the play on a failure the app calls final, such as a full provider", async () => {
    const closed: string[] = [];
    const live = new LivePlayback<Channel>({
      closeChannel: (item) => closed.push(item.LiveStreamId),
      takeHot: async () => null,
      takeWarm: () => null,
      openChannel: async (id) => ({ Id: id, LiveStreamId: "ls-1" }),
      startSession: async () => {
        throw new Error("provider full");
      },
      isPermanent: (error) => error instanceof Error && error.message === "provider full",
    });
    const ended: string[] = [];
    await live.play("c1", { onUrl: () => undefined, onEnded: (message) => ended.push(message) });
    expect(ended).toEqual(["provider full"]);
    expect(live.state).toBe("failed");
    expect(closed).toEqual(["ls-1"]);
  });

  it("tells the app of each drop with what failed and the wait, and of the end with the error behind it", async () => {
    const { live } = player();
    const drops: unknown[] = [];
    const ends: unknown[] = [];
    const states: string[] = [];
    await live.play("c1", {
      onUrl: () => undefined,
      onState: (state) => states.push(state),
      onDrop: (message, cause, decision) => drops.push({ message, cause, decision }),
      onEnded: (message, cause) => ends.push({ message, cause }),
    });
    const playerError = { code: -11819 };
    live.fail("player error", false, undefined, playerError);
    expect(drops).toEqual([{ message: "player error", cause: playerError, decision: { reopen: true, delayMs: 500 } }]);
    jest.advanceTimersByTime(500);
    await flush();
    live.fail("channel is DRM protected (com.widevine)", false, undefined, playerError);
    expect(ends).toEqual([{ message: "channel is DRM protected (com.widevine)", cause: playerError }]);
    expect(states[states.length - 1]).toBe("failed");
  });

  it("ignores a player error that lands while a reopen is still opening, and a second one during the wait", async () => {
    let release: (() => void) | null = null;
    const closed: string[] = [];
    let opens = 0;
    const live = new LivePlayback<Channel>({
      closeChannel: (item) => closed.push(item.LiveStreamId),
      takeHot: async () => null,
      takeWarm: () => null,
      openChannel: async (id) => {
        opens += 1;
        if (opens === 2) await new Promise<void>((resolve) => (release = resolve));
        return { Id: id, LiveStreamId: `ls-${opens}` };
      },
      startSession: async (item) => `http://127.0.0.1/t-${item.LiveStreamId}/master.m3u8`,
    });
    const urls: string[] = [];
    await live.play("c1", { onUrl: (url) => urls.push(url) });
    live.fail("player error", false);
    live.fail("the same error again", false);
    jest.advanceTimersByTime(500);
    await flush();
    expect(opens).toBe(2);
    live.fail("the stopped session's late error", false);
    jest.runOnlyPendingTimers();
    await flush();
    release!();
    await flush();
    expect(opens).toBe(2);
    expect(urls).toEqual(["http://127.0.0.1/t-ls-1/master.m3u8", "http://127.0.0.1/t-ls-2/master.m3u8"]);
    expect(closed).toEqual(["ls-1"]);
  });

  it("hands a playing channel to the ring when the player leaves, and opens nothing more", async () => {
    const retained: string[] = [];
    const live = new LivePlayback<Channel>({
      closeChannel: () => undefined,
      takeHot: async () => null,
      takeWarm: () => null,
      openChannel: async (id) => ({ Id: id, LiveStreamId: "ls-1" }),
      startSession: async (item) => `http://127.0.0.1/t-${item.LiveStreamId}/master.m3u8`,
      retain: (channel) => {
        retained.push(channel.token);
        return true;
      },
    });
    await live.play("c1", { onUrl: () => undefined });
    expect(live.release(true)).toBe(true);
    expect(retained).toEqual(["t-ls-1"]);
    expect(live.state).toBe("idle");
    expect(failureListeners.has("t-ls-1")).toBe(false);
  });

  it("keeps ignoring player errors during a new play's attempt when the replaced play's open fails late", async () => {
    let failFirst: ((error: Error) => void) | null = null;
    let releaseSecond: (() => void) | null = null;
    let opens = 0;
    const closed: string[] = [];
    const live = new LivePlayback<Channel>({
      closeChannel: (item) => closed.push(item.LiveStreamId),
      takeHot: async () => null,
      takeWarm: () => null,
      openChannel: async (id) => {
        opens += 1;
        if (opens === 1) await new Promise<void>((_, reject) => (failFirst = reject));
        if (opens === 2) await new Promise<void>((resolve) => (releaseSecond = resolve));
        return { Id: id, LiveStreamId: `ls-${opens}` };
      },
      startSession: async (item) => `http://127.0.0.1/t-${item.LiveStreamId}/master.m3u8`,
    });
    const urls: string[] = [];
    void live.play("c1", { onUrl: (url) => urls.push(url) });
    await flush();
    const second = live.play("c1", { onUrl: (url) => urls.push(url) });
    await flush();
    failFirst!(new Error("the first open failed"));
    await flush();
    live.fail("player error", false);
    releaseSecond!();
    await second;
    jest.runOnlyPendingTimers();
    await flush();
    expect(opens).toBe(2);
    expect(urls).toEqual(["http://127.0.0.1/t-ls-2/master.m3u8"]);
    expect(closed).toEqual([]);
    expect(live.state).toBe("buffering");
  });

  it("reports opening for a new play that replaces one in its wait", async () => {
    const { live } = player();
    await live.play("c1", { onUrl: () => undefined });
    live.fail("player error", false);
    expect(live.state).toBe("reopening");
    const states: string[] = [];
    await live.play("c1", { onUrl: () => undefined, onState: (state) => states.push(state) });
    expect(states).toEqual(["opening", "buffering"]);
  });

  it("ends the play with no bind when the app's step returns false", async () => {
    const { live, closed } = player();
    const urls: string[] = [];
    await live.play("c1", { onUrl: (url) => urls.push(url), prepare: async () => false });
    jest.runOnlyPendingTimers();
    await flush();
    expect(urls).toEqual([]);
    expect(closed).toEqual(["ls-1"]);
    expect(failureListeners.has("t-ls-1")).toBe(false);
    expect(live.state).toBe("idle");
  });

  it("stops the session and closes the channel when stopped while playing", async () => {
    const { live, closed } = player();
    await live.play("c1", { onUrl: () => undefined });
    live.stop();
    expect(closed).toEqual(["ls-1"]);
    expect(mockStopped).toEqual(["t-ls-1"]);
    expect(failureListeners.has("t-ls-1")).toBe(false);
  });
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
  drops.notePlaying();
  now += LIVE_RECOVERY_RESET_MS;
  expect(drops.drop()).toBe(0);
});

it("keeps counting a drop a minute after the last when the channel played only seconds in between", () => {
  let now = 1_000_000;
  const drops = new LiveDropCounter(() => now);
  expect(drops.drop()).toBe(0);
  now += 56_000;
  drops.notePlaying();
  now += 5_000;
  expect(drops.drop()).toBe(1);
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
