/**
 * Channel health, sampler-fed: only an origin's HTTP error words strike, two strikes make
 * down, a burst redeems any verdict, a clear drops all.
 */
jest.mock("@/utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { clearChannelHealth, healthFor, noteChannelAlive, noteChannelGone, noteChannelOpenFailure, subscribeChannelHealth } from "../channelHealth";

beforeEach(() => clearChannelHealth());

describe("channelHealth", () => {
  it("needs two definitive refusals before a down verdict", () => {
    noteChannelOpenFailure("a", "open: Server returned 403 Forbidden (access denied)");
    expect(healthFor("a")).toBe("unknown");
    noteChannelOpenFailure("a", "open: Server returned 403 Forbidden (access denied)");
    expect(healthFor("a")).toBe("down");
  });

  it("ignores refusals without an HTTP error status", () => {
    noteChannelOpenFailure("a", "open: Input/output error");
    noteChannelOpenFailure("a", "open: Connection timed out");
    noteChannelOpenFailure("a", undefined);
    expect(healthFor("a")).toBe("unknown");
  });

  it("a burst redeems a down channel and notifies", () => {
    noteChannelOpenFailure("a", "open: Server returned 404 Not Found");
    noteChannelOpenFailure("a", "open: Server returned 404 Not Found");
    expect(healthFor("a")).toBe("down");
    const listener = jest.fn();
    subscribeChannelHealth("a", listener);
    noteChannelAlive("a");
    expect(healthFor("a")).toBe("up");
    expect(listener).toHaveBeenCalled();
  });

  it("a channel no tuner carries is down at once, and a burst redeems it", () => {
    noteChannelGone("a");
    expect(healthFor("a")).toBe("down");
    noteChannelAlive("a");
    expect(healthFor("a")).toBe("up");
  });

  it("a clear drops every verdict", () => {
    noteChannelAlive("a");
    expect(healthFor("a")).toBe("up");
    clearChannelHealth();
    expect(healthFor("a")).toBe("unknown");
  });
});
