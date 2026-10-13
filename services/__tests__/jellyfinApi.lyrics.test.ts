/**
 * Tests for the lyrics client: request shape, ticks to seconds, synced read off the lines, cue
 * validation, and the everything-degrades-to-null contract (a song without lyrics is a 404).
 */
import { fetchLyrics, parseLyrics, refreshConfig, JELLYFIN_TIME } from "../jellyfinApi";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/libraryManager", () => ({
  libraryManager: {
    clearCache: jest.fn(),
  },
}));

const TICKS = JELLYFIN_TIME.TICKS_PER_SECOND;

describe("parseLyrics", () => {
  it("maps synced lines to seconds in time order", () => {
    expect(
      parseLyrics({
        Lyrics: [
          { Text: "second line", Start: 12 * TICKS },
          { Text: "first line", Start: 4.5 * TICKS },
        ],
      }),
    ).toEqual({
      synced: true,
      lines: [
        { text: "first line", start: 4.5, cues: [] },
        { text: "second line", start: 12, cues: [] },
      ],
    });
  });

  it("keeps plain text in file order with no start", () => {
    expect(parseLyrics({ Lyrics: [{ Text: "one" }, { Text: "" }, { Text: "two", Start: null }] })).toEqual({
      synced: false,
      lines: [
        { text: "one", start: null, cues: [] },
        { text: "", start: null, cues: [] },
        { text: "two", start: null, cues: [] },
      ],
    });
  });

  it("drops an untimed line from a synced file", () => {
    const lyrics = parseLyrics({ Lyrics: [{ Text: "header" }, { Text: "sung", Start: 2 * TICKS }] });
    expect(lyrics?.lines).toEqual([{ text: "sung", start: 2, cues: [] }]);
  });

  it("maps word cues and drops one outside the text", () => {
    const lyrics = parseLyrics({
      Lyrics: [
        {
          Text: "one two",
          Start: 1 * TICKS,
          Cues: [
            { Position: 4, EndPosition: 7, Start: 2 * TICKS, End: null },
            { Position: 0, EndPosition: 3, Start: 1 * TICKS, End: 2 * TICKS },
            { Position: 4, EndPosition: 40, Start: 3 * TICKS, End: null },
            { Position: 3, EndPosition: 3, Start: 3 * TICKS },
          ],
        },
      ],
    });
    expect(lyrics?.lines[0].cues).toEqual([
      { position: 0, endPosition: 3, start: 1, end: 2 },
      { position: 4, endPosition: 7, start: 2, end: null },
    ]);
  });

  it("is null for no lines, blank lines only, or a malformed body", () => {
    expect(parseLyrics({ Lyrics: [] })).toBeNull();
    expect(parseLyrics({ Lyrics: [{ Text: "  ", Start: TICKS }] })).toBeNull();
    expect(parseLyrics({})).toBeNull();
    expect(parseLyrics(null)).toBeNull();
  });
});

describe("fetchLyrics", () => {
  const mockSecureStore = require("expo-secure-store");

  beforeEach(async () => {
    global.fetch = jest.fn();

    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const mockConfig: Record<string, string> = {
        jellyfin_server_url: "http://192.168.1.100:8096",
        jellyfin_api_key: "test-api-key",
        jellyfin_user_id: "test-user-id",
        jellyfin_device_id: "test-device-id",
      };
      return Promise.resolve(mockConfig[key] || null);
    });

    await refreshConfig();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("requests the item's lyrics with auth", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Lyrics: [{ Text: "line", Start: 3 * TICKS }] }) });

    expect(await fetchLyrics("song-1")).toEqual({ synced: true, source: "server", lines: [{ text: "line", start: 3, cues: [] }] });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("http://192.168.1.100:8096/Audio/song-1/Lyrics");
    expect((init.headers as Record<string, string>).Authorization).toContain("test-api-key");
  });

  it("is null on 404 (no lyrics, or a pre-10.9 server)", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 404 });

    expect(await fetchLyrics("song-1")).toBeNull();
  });

  it("is null when the request throws", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("offline"));

    expect(await fetchLyrics("song-1")).toBeNull();
  });
});
