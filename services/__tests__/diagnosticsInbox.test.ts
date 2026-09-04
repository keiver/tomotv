/** The inbox: the sends in memory and the moments they are read. */
const mockRead = jest.fn();
const mockRemove = jest.fn();
jest.mock("@/services/diagnosticsOutbox", () => ({ readSentSessions: () => mockRead(), OUTBOX_ID: "tomotv-diagnostics", OUTBOX_CLIENT: "Tomo TV", OUTBOX_KEY_PREFIX: "playbackSession:" }));
jest.mock("@/services/jellyfinApi", () => ({ removeDisplayPreference: (...args: unknown[]) => mockRemove(...args) }));

const mockHeld = jest.fn(() => false);
jest.mock("@/services/playbackHold", () => ({ isPlaybackHeld: () => mockHeld() }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { armInbox, clearSends, getSends, pokeInbox, POKE_GAP_MS, refreshSends, removeSend, subscribeSends } from "@/services/diagnosticsInbox";

const sent = (sender: string, sentAt: number) => ({ v: 1, sender, device: "Apple TV", sentAt, session: { itemId: "i" } });

beforeEach(() => {
  jest.clearAllMocks();
  clearSends();
  armInbox(false);
  mockHeld.mockReturnValue(false);
});

describe("pokeInbox", () => {
  it("does nothing disarmed, and nothing while playback holds the link", async () => {
    await pokeInbox(true);
    expect(mockRead).not.toHaveBeenCalled();
    armInbox(true);
    mockHeld.mockReturnValue(true);
    await pokeInbox(true);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("reads the slots into memory", async () => {
    armInbox(true);
    mockRead.mockResolvedValue([sent("tv-1", 5000)]);
    await pokeInbox(true);
    expect(getSends()).toHaveLength(1);
  });

  it("folds pokes inside the gap into one read, and force skips the gap", async () => {
    armInbox(true);
    mockRead.mockResolvedValue([]);
    const now = jest.spyOn(Date, "now").mockReturnValue(100_000);
    await pokeInbox();
    await pokeInbox();
    expect(mockRead).toHaveBeenCalledTimes(1);
    now.mockReturnValue(100_000 + POKE_GAP_MS + 1);
    await pokeInbox();
    expect(mockRead).toHaveBeenCalledTimes(2);
    await pokeInbox(true);
    expect(mockRead).toHaveBeenCalledTimes(3);
    now.mockRestore();
  });

  it("shares one read between overlapping pokes", async () => {
    armInbox(true);
    let release: (value: unknown[]) => void = () => {};
    mockRead.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const first = pokeInbox(true);
    const second = pokeInbox(true);
    expect(second).toBe(first);
    release([]);
    await first;
    expect(mockRead).toHaveBeenCalledTimes(1);
  });
});

describe("refreshSends, subscribeSends and clearSends", () => {
  it("reads the server into memory and tells subscribers, then forgets on clear", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeSends(listener);
    mockRead.mockResolvedValueOnce([sent("tv-1", 5000)]);
    expect(await refreshSends()).toHaveLength(1);
    expect(getSends()[0].sender).toBe("tv-1");
    expect(listener).toHaveBeenCalledTimes(1);
    clearSends();
    expect(getSends()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    clearSends();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("writes nothing back when the account was left while the read was in flight", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeSends(listener);
    let settle: (value: unknown[]) => void = () => {};
    mockRead.mockImplementationOnce(() => new Promise((resolve) => (settle = resolve)));

    const reading = refreshSends();
    clearSends();
    settle([sent("tv-1", 5000)]);

    expect(await reading).toEqual([]);
    expect(getSends()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe("removeSend", () => {
  it("deletes the sender's slot on the server, drops it from memory, and tells subscribers", async () => {
    mockRead.mockResolvedValueOnce([sent("tv-2", 9000), sent("tv-1", 5000)]);
    await refreshSends();
    const listener = jest.fn();
    const unsubscribe = subscribeSends(listener);
    mockRemove.mockResolvedValueOnce(undefined);
    await removeSend("tv-2");
    expect(mockRemove).toHaveBeenCalledWith("tomotv-diagnostics", "Tomo TV", "playbackSession:tv-2");
    expect(getSends().map((s) => s.sender)).toEqual(["tv-1"]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("keeps the row when the server refuses, and lets the caller know", async () => {
    mockRead.mockResolvedValueOnce([sent("tv-1", 5000)]);
    await refreshSends();
    mockRemove.mockRejectedValueOnce(new Error("Failed to write display preferences: 500"));
    await expect(removeSend("tv-1")).rejects.toThrow("500");
    expect(getSends()).toHaveLength(1);
  });
});
