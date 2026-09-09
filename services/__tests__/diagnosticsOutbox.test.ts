/**
 * The diagnostics outbox: what a send writes, under which key, and what a read accepts as a session.
 */
const mockGet = jest.fn();
const mockEdit = jest.fn();
const mockConfig = jest.fn(async () => ({ server: "http://jf", apiKey: "t", userId: "u", deviceId: "tv-1" }));
jest.mock("@/services/jellyfinApi", () => ({
  getConfig: () => mockConfig(),
  getDisplayPreferences: (...args: unknown[]) => mockGet(...args),
  editDisplayPreferences: (...args: unknown[]) => mockEdit(...args),
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { OUTBOX_CLIENT, OUTBOX_ID, OUTBOX_KEY_PREFIX, OUTBOX_TTL_MS, parseSentSession, readSentSessions, sendSession } from "@/services/diagnosticsOutbox";
import type { PlaybackSession } from "@/services/diagnosticsSchema";

const session: PlaybackSession = {
  schemaVersion: 2,
  app: { name: "Tomo TV", version: "2.2.2", build: "3" },
  os: { name: "tvOS", version: "26.5" },
  device: {
    family: "Apple TV",
    model: "AppleTV6,2",
    marketingName: "Apple TV 4K",
    cores: 4,
    memoryBytes: 3221225472,
    decode: { hevc: true, hevcMain10: true, av1: false, h264MaxHeight: null, hevcMaxHeight: null },
  },
  playback: {
    itemId: "i",
    startedAt: 1000,
    outcome: "ended",
    events: [{ t: 1000, event: "mode", mode: "direct" }],
    progress: [{ t: 2000, position: 42 }],
  },
};
const payload = (sender: string, sentAt: number) => JSON.stringify({ v: 2, sender, sentAt, session });
/** What a build before the document shape wrote: the device on the wrapper, two head strings inside. */
const v1 = { itemId: "i", app: "Tomo TV 2.2.2 (3)", os: "tvOS 26.5", startedAt: 1000, outcome: "ended", events: [{ t: 1000, event: "mode", mode: "direct" }], progress: [{ t: 2000, position: 42 }] };
const payloadV1 = (sender: string, sentAt: number, device = "Apple TV") => JSON.stringify({ v: 1, sender, device, sentAt, session: v1 });

beforeEach(() => jest.clearAllMocks());

const editedBy = (current: Record<string, string | null>): Record<string, string | null> => {
  const edit = mockEdit.mock.calls[0]?.[2] as (current: Record<string, string | null>) => Record<string, string | null>;
  return edit(current);
};

describe("sendSession", () => {
  it("writes one versioned payload under the sender's own key", async () => {
    mockEdit.mockResolvedValue(undefined);
    await sendSession(session, 5000);
    expect(mockEdit).toHaveBeenCalledWith(OUTBOX_ID, OUTBOX_CLIENT, expect.any(Function));
    expect(editedBy({})).toEqual({ [`${OUTBOX_KEY_PREFIX}tv-1`]: payload("tv-1", 5000) });
  });

  it("drops its own expired slots, version 1 included, and keeps everything else, ours or not", async () => {
    mockEdit.mockResolvedValue(undefined);
    const now = OUTBOX_TTL_MS + 10_000;
    await sendSession(session, now);
    expect(
      editedBy({
        [`${OUTBOX_KEY_PREFIX}tv-old`]: payload("tv-old", 1000),
        [`${OUTBOX_KEY_PREFIX}tv-older`]: payloadV1("tv-older", 1000),
        [`${OUTBOX_KEY_PREFIX}tv-recent`]: payload("tv-recent", now - 1000),
        [`${OUTBOX_KEY_PREFIX}tv-future`]: JSON.stringify({ v: 3, whatever: true }),
        someOtherClientKey: "keep me",
      }),
    ).toEqual({
      [`${OUTBOX_KEY_PREFIX}tv-recent`]: payload("tv-recent", now - 1000),
      [`${OUTBOX_KEY_PREFIX}tv-future`]: JSON.stringify({ v: 3, whatever: true }),
      someOtherClientKey: "keep me",
      [`${OUTBOX_KEY_PREFIX}tv-1`]: payload("tv-1", now),
    });
  });

  it("lets a failed write reach the caller, and refuses without a device id", async () => {
    mockEdit.mockRejectedValueOnce(new Error("Failed to write display preferences: 500"));
    await expect(sendSession(session)).rejects.toThrow("500");
    mockConfig.mockResolvedValueOnce({ server: "", apiKey: "", userId: "", deviceId: "" });
    await expect(sendSession(session)).rejects.toThrow("not configured");
  });
});

describe("parseSentSession", () => {
  it("accepts the shape a send writes", () => {
    expect(parseSentSession(payload("tv-1", 5000))).toEqual({ v: 2, sender: "tv-1", sentAt: 5000, session });
  });

  it("lifts a version 1 slot, naming the sender's device from the wrapper", () => {
    const sent = parseSentSession(payloadV1("tv-1", 5000, "iPad"));
    expect(sent).toMatchObject({ v: 2, sender: "tv-1", sentAt: 5000 });
    expect(sent?.session).toEqual({
      schemaVersion: 2,
      app: { name: "Tomo TV", version: "2.2.2", build: "3" },
      os: { name: "tvOS", version: "26.5" },
      device: { family: "iPad", model: null, marketingName: null, cores: null, memoryBytes: null, decode: null },
      playback: { itemId: "i", startedAt: 1000, outcome: "ended", events: v1.events, progress: v1.progress },
    });
  });

  it("rejects nothing, garbage, another version, no sender, an unknown device, and a session missing its head", () => {
    expect(parseSentSession(null)).toBeNull();
    expect(parseSentSession("")).toBeNull();
    expect(parseSentSession("{not json")).toBeNull();
    expect(parseSentSession(JSON.stringify({ v: 3, sender: "tv-1", sentAt: 1, session }))).toBeNull();
    expect(parseSentSession(JSON.stringify({ v: 2, sentAt: 1, session }))).toBeNull();
    expect(parseSentSession(JSON.stringify({ v: 1, sender: "tv-1", device: "Toaster", sentAt: 1, session: v1 }))).toBeNull();
    const { app: _app, ...unstamped } = v1;
    expect(parseSentSession(JSON.stringify({ v: 1, sender: "tv-1", device: "Apple TV", sentAt: 1, session: unstamped }))).toBeNull();
    const { device: _device, ...headless } = session;
    expect(parseSentSession(JSON.stringify({ v: 2, sender: "tv-1", sentAt: 1, session: headless }))).toBeNull();
    expect(parseSentSession(JSON.stringify({ v: 2, sender: "tv-1", sentAt: 1, session: { ...session, playback: { ...session.playback, events: "no" } } }))).toBeNull();
  });
});

describe("readSentSessions", () => {
  it("reads every sender's slot, newest first, skipping keys that are not slots and slots that do not parse", async () => {
    mockGet.mockResolvedValue({
      CustomPrefs: { [`${OUTBOX_KEY_PREFIX}tv-1`]: payload("tv-1", 5000), [`${OUTBOX_KEY_PREFIX}tv-2`]: payloadV1("tv-2", 9000), [`${OUTBOX_KEY_PREFIX}tv-3`]: "{broken", other: "x" },
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
