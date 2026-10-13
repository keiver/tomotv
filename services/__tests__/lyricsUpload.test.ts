/**
 * Saving lyrics to the Jellyfin server: the file each kind of lyrics becomes, the account
 * permission, and what is never sent.
 */
import { canManageLyrics, lyricsFile, uploadLyrics } from "@/services/lyrics/upload";
import { fetchWithTimeout } from "@/services/jellyfin/http";
import { getConfig } from "@/services/jellyfin/session";
import type { ItemLyrics } from "@/services/jellyfin/lyrics";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/jellyfin/http", () => ({ fetchWithTimeout: jest.fn() }));
jest.mock("@/services/jellyfin/constants", () => ({ API_TIMEOUTS: { QUICK: 10000, NORMAL: 15000 } }));
jest.mock("@/services/jellyfin/session", () => ({
  getConfig: jest.fn(),
  getAuthHeader: jest.fn(() => "auth-header"),
}));

const mockFetch = fetchWithTimeout as jest.Mock;
const account = (userId: string) => (getConfig as jest.Mock).mockResolvedValue({ server: "http://server", apiKey: "key", userId, deviceId: "device" });

const WORDED: ItemLyrics = {
  synced: true,
  source: "lrclib",
  lines: [
    {
      text: "one two",
      start: 61.5,
      cues: [
        { position: 0, endPosition: 3, start: 61.5, end: null },
        { position: 4, endPosition: 7, start: 62.25, end: null },
      ],
    },
    { text: "three", start: 70, cues: [] },
  ],
};

describe("lyricsFile", () => {
  it("writes word tags inside each line as .elrc", () => {
    expect(lyricsFile(WORDED)).toEqual({ fileName: "lyrics.elrc", body: "[01:01.50] <01:01.50> one <01:02.25> two\n[01:10.00] three" });
  });

  it("writes line stamps alone as .lrc", () => {
    const lined: ItemLyrics = { synced: true, lines: [{ text: "one two", start: 5, cues: [] }] };
    expect(lyricsFile(lined)).toEqual({ fileName: "lyrics.lrc", body: "[00:05.00] one two" });
  });

  it("writes untimed text as .txt", () => {
    const plain: ItemLyrics = {
      synced: false,
      lines: [
        { text: "one", start: null, cues: [] },
        { text: "", start: null, cues: [] },
        { text: "two", start: null, cues: [] },
      ],
    };
    expect(lyricsFile(plain)).toEqual({ fileName: "lyrics.txt", body: "one\n\ntwo" });
  });
});

describe("canManageLyrics", () => {
  beforeEach(() => mockFetch.mockReset());

  it("follows the account's lyric permission and asks once per account", async () => {
    account("user-1");
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ Policy: { EnableLyricManagement: true } }) });

    expect(await canManageLyrics()).toBe(true);
    expect(await canManageLyrics()).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    account("user-2");
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ Policy: { EnableLyricManagement: false } }) });
    expect(await canManageLyrics()).toBe(false);
  });

  it("is no when the read fails or nobody is signed in", async () => {
    account("user-3");
    mockFetch.mockRejectedValue(new Error("offline"));
    expect(await canManageLyrics()).toBe(false);

    (getConfig as jest.Mock).mockResolvedValue({ server: "", apiKey: "" });
    expect(await canManageLyrics()).toBe(false);
  });
});

describe("uploadLyrics", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    account("user-1");
  });

  it("posts the file to the song as plain text", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    expect(await uploadLyrics("song-1", WORDED)).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://server/Audio/song-1/Lyrics?fileName=lyrics.elrc");
    expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "text/plain", Authorization: "auth-header" }, body: "[01:01.50] <01:01.50> one <01:02.25> two\n[01:10.00] three" });
  });

  it("never sends generated lyrics or the server's own", async () => {
    expect(await uploadLyrics("song-1", { ...WORDED, source: "generated" })).toBe(false);
    expect(await uploadLyrics("song-1", { ...WORDED, source: "server" })).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("is false when the server refuses or cannot be reached", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    expect(await uploadLyrics("song-1", WORDED)).toBe(false);
    mockFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await uploadLyrics("song-1", WORDED)).toBe(false);
  });
});
