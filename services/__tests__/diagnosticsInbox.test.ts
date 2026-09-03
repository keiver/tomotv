/** The inbox: the sends in memory, who they are announced to, and which have already been shown. */
const mockRead = jest.fn();
jest.mock("@/services/diagnosticsOutbox", () => ({ readSentSessions: () => mockRead() }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { checkInbox, clearSends, getSends, markSeen, readSeen, refreshSends, subscribeSends } from "@/services/diagnosticsInbox";
import * as SecureStore from "expo-secure-store";

const store = SecureStore as jest.Mocked<typeof SecureStore>;
const sent = (sender: string, sentAt: number) => ({ v: 1, sender, device: "Apple TV", sentAt, session: { itemId: "i" } });

beforeEach(() => {
  jest.clearAllMocks();
  clearSends();
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
