/**
 * The diagnostics outbox: what a send writes, and what a read accepts as a session.
 */
const mockGet = jest.fn();
const mockUpdate = jest.fn();
jest.mock("@/services/jellyfinApi", () => ({ getDisplayPreferences: (...args: unknown[]) => mockGet(...args), updateDisplayPreferences: (...args: unknown[]) => mockUpdate(...args) }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { OUTBOX_CLIENT, OUTBOX_ID, OUTBOX_KEY, parseSentSession, readSentSession, sendSession } from "@/services/diagnosticsOutbox";
import type { PlaybackSession } from "@/services/playbackProbe";

const session: PlaybackSession = {
  itemId: "i",
  app: "Tomo TV 2.2.2 (3)",
  os: "tvOS 26.5",
  startedAt: 1000,
  outcome: "ended",
  events: [{ t: 1000, event: "mode", mode: "direct" }],
  progress: [{ t: 2000, position: 42 }],
};

beforeEach(() => jest.clearAllMocks());

describe("sendSession", () => {
  it("writes one versioned, stamped payload under the outbox key", async () => {
    mockUpdate.mockResolvedValue(undefined);
    await sendSession(session, "Apple TV", 5000);
    expect(mockUpdate).toHaveBeenCalledWith(OUTBOX_ID, OUTBOX_CLIENT, { [OUTBOX_KEY]: JSON.stringify({ v: 1, device: "Apple TV", sentAt: 5000, session }) });
  });

  it("lets a failed write reach the caller", async () => {
    mockUpdate.mockRejectedValue(new Error("Failed to write display preferences: 500"));
    await expect(sendSession(session, "Apple TV")).rejects.toThrow("500");
  });
});

describe("parseSentSession", () => {
  const good = JSON.stringify({ v: 1, device: "Apple TV", sentAt: 5000, session });

  it("accepts the shape a send writes", () => {
    expect(parseSentSession(good)).toEqual({ v: 1, device: "Apple TV", sentAt: 5000, session });
  });

  it("rejects nothing, garbage, another version, an unknown device, and a session missing its stamp", () => {
    expect(parseSentSession(null)).toBeNull();
    expect(parseSentSession("")).toBeNull();
    expect(parseSentSession("{not json")).toBeNull();
    expect(parseSentSession(JSON.stringify({ v: 2, device: "Apple TV", sentAt: 1, session }))).toBeNull();
    expect(parseSentSession(JSON.stringify({ v: 1, device: "Toaster", sentAt: 1, session }))).toBeNull();
    const { app: _app, ...unstamped } = session;
    expect(parseSentSession(JSON.stringify({ v: 1, device: "Apple TV", sentAt: 1, session: unstamped }))).toBeNull();
    expect(parseSentSession(JSON.stringify({ v: 1, device: "Apple TV", sentAt: 1, session: { ...session, events: "no" } }))).toBeNull();
  });
});

describe("readSentSession", () => {
  it("reads the slot back", async () => {
    mockGet.mockResolvedValue({ CustomPrefs: { [OUTBOX_KEY]: JSON.stringify({ v: 1, device: "Apple TV", sentAt: 5000, session }) } });
    expect(await readSentSession()).toMatchObject({ device: "Apple TV", session: { itemId: "i" } });
    expect(mockGet).toHaveBeenCalledWith(OUTBOX_ID, OUTBOX_CLIENT);
  });

  it("is null when the slot is empty, absent, or the server cannot be reached", async () => {
    mockGet.mockResolvedValueOnce({ CustomPrefs: {} });
    expect(await readSentSession()).toBeNull();
    mockGet.mockResolvedValueOnce({ CustomPrefs: null });
    expect(await readSentSession()).toBeNull();
    mockGet.mockRejectedValueOnce(new Error("Network request failed"));
    expect(await readSentSession()).toBeNull();
  });
});
