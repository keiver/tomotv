/**
 * The diagnostics outbox: what a send writes, under which key, and what a read accepts as a session.
 */
const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockConfig = jest.fn(async () => ({ server: "http://jf", apiKey: "t", userId: "u", deviceId: "tv-1" }));
jest.mock("@/services/jellyfinApi", () => ({
  getConfig: () => mockConfig(),
  getDisplayPreferences: (...args: unknown[]) => mockGet(...args),
  updateDisplayPreferences: (...args: unknown[]) => mockUpdate(...args),
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { OUTBOX_CLIENT, OUTBOX_ID, OUTBOX_KEY_PREFIX, parseSentSession, readSentSessions, sendSession } from "@/services/diagnosticsOutbox";
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
const payload = (sender: string, sentAt: number) => JSON.stringify({ v: 1, sender, device: "Apple TV", sentAt, session });

beforeEach(() => jest.clearAllMocks());

describe("sendSession", () => {
  it("writes one versioned, stamped payload under the sender's own key", async () => {
    mockUpdate.mockResolvedValue(undefined);
    await sendSession(session, "Apple TV", 5000);
    expect(mockUpdate).toHaveBeenCalledWith(OUTBOX_ID, OUTBOX_CLIENT, { [`${OUTBOX_KEY_PREFIX}tv-1`]: payload("tv-1", 5000) });
  });

  it("lets a failed write reach the caller, and refuses without a device id", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("Failed to write display preferences: 500"));
    await expect(sendSession(session, "Apple TV")).rejects.toThrow("500");
    mockConfig.mockResolvedValueOnce({ server: "", apiKey: "", userId: "", deviceId: "" });
    await expect(sendSession(session, "Apple TV")).rejects.toThrow("not configured");
  });
});

describe("parseSentSession", () => {
  it("accepts the shape a send writes", () => {
    expect(parseSentSession(payload("tv-1", 5000))).toEqual({ v: 1, sender: "tv-1", device: "Apple TV", sentAt: 5000, session });
  });

  it("rejects nothing, garbage, another version, no sender, an unknown device, and a session missing its stamp", () => {
    expect(parseSentSession(null)).toBeNull();
    expect(parseSentSession("")).toBeNull();
    expect(parseSentSession("{not json")).toBeNull();
    expect(parseSentSession(JSON.stringify({ v: 2, sender: "tv-1", device: "Apple TV", sentAt: 1, session }))).toBeNull();
    expect(parseSentSession(JSON.stringify({ v: 1, device: "Apple TV", sentAt: 1, session }))).toBeNull();
    expect(parseSentSession(JSON.stringify({ v: 1, sender: "tv-1", device: "Toaster", sentAt: 1, session }))).toBeNull();
    const { app: _app, ...unstamped } = session;
    expect(parseSentSession(JSON.stringify({ v: 1, sender: "tv-1", device: "Apple TV", sentAt: 1, session: unstamped }))).toBeNull();
    expect(parseSentSession(JSON.stringify({ v: 1, sender: "tv-1", device: "Apple TV", sentAt: 1, session: { ...session, events: "no" } }))).toBeNull();
  });
});

describe("readSentSessions", () => {
  it("reads every sender's slot, newest first, skipping keys that are not slots and slots that do not parse", async () => {
    mockGet.mockResolvedValue({
      CustomPrefs: { [`${OUTBOX_KEY_PREFIX}tv-1`]: payload("tv-1", 5000), [`${OUTBOX_KEY_PREFIX}tv-2`]: payload("tv-2", 9000), [`${OUTBOX_KEY_PREFIX}tv-3`]: "{broken", other: "x" },
    });
    const sends = await readSentSessions();
    expect(sends.map((sent) => sent.sender)).toEqual(["tv-2", "tv-1"]);
    expect(mockGet).toHaveBeenCalledWith(OUTBOX_ID, OUTBOX_CLIENT);
  });

  it("is empty when nothing was sent, the prefs carry none, or the server cannot be reached", async () => {
    mockGet.mockResolvedValueOnce({ CustomPrefs: {} });
    expect(await readSentSessions()).toEqual([]);
    mockGet.mockResolvedValueOnce({ CustomPrefs: null });
    expect(await readSentSessions()).toEqual([]);
    mockGet.mockRejectedValueOnce(new Error("Network request failed"));
    expect(await readSentSessions()).toEqual([]);
  });
});
