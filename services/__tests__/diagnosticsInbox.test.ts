/** The inbox: the sends in memory, who they are announced to, and which have already been shown. */
const mockRead = jest.fn();
const mockRemove = jest.fn();
jest.mock("@/services/diagnosticsOutbox", () => ({ readSentSessions: () => mockRead(), OUTBOX_ID: "tomotv-diagnostics", OUTBOX_CLIENT: "Tomo TV", OUTBOX_KEY_PREFIX: "playbackSession:" }));
jest.mock("@/services/jellyfinApi", () => ({ removeDisplayPreference: (...args: unknown[]) => mockRemove(...args) }));
const mockHeld = jest.fn(() => false);
jest.mock("@/services/playbackHold", () => ({ isPlaybackHeld: () => mockHeld() }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { checkInbox, clearSends, getSends, markSeen, pokeInbox, POKE_GAP_MS, readSeen, refreshSends, removeSend, setInboxOffer, subscribeSends } from "@/services/diagnosticsInbox";
import * as SecureStore from "expo-secure-store";

const store = SecureStore as jest.Mocked<typeof SecureStore>;
const sent = (sender: string, sentAt: number) => ({ v: 1, sender, device: "Apple TV", sentAt, session: { itemId: "i" } });

beforeEach(() => {
  jest.clearAllMocks();
  clearSends();
  setInboxOffer(null);
  mockHeld.mockReturnValue(false);
});

describe("pokeInbox", () => {
  it("does nothing disarmed, and nothing while playback holds the link", async () => {
    await pokeInbox(true);
    expect(mockRead).not.toHaveBeenCalled();
    setInboxOffer(jest.fn());
    mockHeld.mockReturnValue(true);
    await pokeInbox(true);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("reads the slots, marks a new send seen and offers it once", async () => {
    const offer = jest.fn();
    setInboxOffer(offer);
    store.getItemAsync.mockResolvedValue(null);
    mockRead.mockResolvedValue([sent("tv-1", 5000)]);
    await pokeInbox(true);
    expect(offer).toHaveBeenCalledWith(expect.objectContaining({ sender: "tv-1" }));
    expect(store.setItemAsync).toHaveBeenCalledWith("app_diagnostics_seen", JSON.stringify({ "tv-1": 5000 }));
    store.getItemAsync.mockResolvedValue(JSON.stringify({ "tv-1": 5000 }));
    await pokeInbox(true);
    expect(offer).toHaveBeenCalledTimes(1);
    expect(getSends()).toHaveLength(1);
  });

  it("folds pokes inside the gap into one read, and force skips the gap", async () => {
    setInboxOffer(jest.fn());
    store.getItemAsync.mockResolvedValue(null);
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
    setInboxOffer(jest.fn());
    store.getItemAsync.mockResolvedValue(null);
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

describe("readSeen and markSeen", () => {
  it("reads an empty map when nothing was marked or the value is not one", async () => {
    store.getItemAsync.mockResolvedValueOnce(null);
    expect(await readSeen()).toEqual({});
    store.getItemAsync.mockResolvedValueOnce("garbage");
    expect(await readSeen()).toEqual({});
    store.getItemAsync.mockResolvedValueOnce("[1]");
    expect(await readSeen()).toEqual({});
  });

  it("keeps one send time per sender under its own key", async () => {
    store.getItemAsync.mockResolvedValueOnce(JSON.stringify({ "tv-1": 4000 }));
    await markSeen("tv-2", 5000);
    expect(store.setItemAsync).toHaveBeenCalledWith("app_diagnostics_seen", JSON.stringify({ "tv-1": 4000, "tv-2": 5000 }));
  });

  it("swallows a store that fails", async () => {
    store.getItemAsync.mockRejectedValueOnce(new Error("keychain"));
    expect(await readSeen()).toEqual({});
    store.getItemAsync.mockResolvedValueOnce(null);
    store.setItemAsync.mockRejectedValueOnce(new Error("keychain"));
    await expect(markSeen("tv-1", 1)).resolves.toBeUndefined();
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

describe("checkInbox", () => {
  it("offers the newest send not yet shown, per sender", async () => {
    mockRead.mockResolvedValueOnce([sent("tv-2", 9000), sent("tv-1", 5000)]);
    await refreshSends();
    store.getItemAsync.mockResolvedValue(JSON.stringify({ "tv-2": 9000 }));
    expect(await checkInbox()).toMatchObject({ sender: "tv-1", sentAt: 5000 });
    store.getItemAsync.mockResolvedValue(JSON.stringify({ "tv-2": 9000, "tv-1": 5000 }));
    expect(await checkInbox()).toBeNull();
  });

  it("is null with nothing in memory", async () => {
    store.getItemAsync.mockResolvedValue(null);
    expect(await checkInbox()).toBeNull();
  });
});
