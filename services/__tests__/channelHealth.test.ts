/**
 * Channel health, sampler-fed: only an origin's HTTP error words or an empty origin strike, two strikes make
 * down, a burst redeems any verdict, a clear drops all.
 */
jest.mock("@/utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { clearChannelHealth, healthFor, noteChannelAlive, noteChannelEmpty, noteChannelGone, noteChannelOpenFailure, subscribeChannelHealth } from "../channelHealth";

beforeEach(() => clearChannelHealth());

describe("channelHealth", () => {
  it("needs two definitive refusals before a down verdict", () => {
    noteChannelOpenFailure("a", "open: Server returned 404 Not Found");
    expect(healthFor("a")).toBe("unknown");
    noteChannelOpenFailure("a", "open: Server returned 404 Not Found");
    expect(healthFor("a")).toBe("down");
  });

  it("a provider's connection cap or a busy server never counts as death", () => {
    for (const refusal of [
      "open: Server returned 429 Too Many Requests",
      "open: Server returned 403 Forbidden (access denied)",
      "open: Server returned 401 Unauthorized",
      "open: Server returned 5XX Server Error reply",
      "open: Server returned 503 Service Unavailable",
    ]) {
      noteChannelOpenFailure("a", refusal);
      noteChannelOpenFailure("a", refusal);
    }
    expect(healthFor("a")).toBe("unknown");
  });

  it("needs two empty sources before a down verdict", () => {
    noteChannelEmpty("a");
    expect(healthFor("a")).toBe("unknown");
    noteChannelEmpty("a");
    expect(healthFor("a")).toBe("down");
  });

  it("does not count the engine's own words for an empty source as an HTTP refusal", () => {
    noteChannelOpenFailure("a", "no streams in the source");
    noteChannelOpenFailure("a", "no decodable video stream");
    expect(healthFor("a")).toBe("unknown");
  });

  it("ignores refusals without an HTTP error status", () => {
    noteChannelOpenFailure("a", "open: Input/output error");
    noteChannelOpenFailure("a", "open: Connection timed out");
    noteChannelOpenFailure("a", undefined);
    expect(healthFor("a")).toBe("unknown");
  });

  it("an origin ending an open it admitted counts, whatever its words, twice for a down verdict", () => {
    noteChannelOpenFailure("a", "open: End of file", true);
    expect(healthFor("a")).toBe("unknown");
    noteChannelOpenFailure("a", undefined, true);
    expect(healthFor("a")).toBe("down");
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
