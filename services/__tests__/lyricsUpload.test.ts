/**
 * Saving lyrics to the Jellyfin server: the file each kind of lyrics becomes, the account
 * permission, and which sources are sent.
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
jest.mock("@/utils/hostEnvironment", () => ({ THIS_DEVICE: "iPad" }));

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
  it("writes word tags inside each line as .elrc, under the source line from 0:00 to 3 s", () => {
    expect(lyricsFile(WORDED)).toEqual({ fileName: "lyrics.elrc", body: "[00:00.00] Lyrics: lrclib.net\n[00:03.00]\n[01:01.50] <01:01.50> one <01:02.25> two\n[01:10.00] three" });
  });

  it("names the device that wrote the lyrics, and ends the line at the first lyric when the singing starts before 3 s", () => {
    const early: ItemLyrics = { synced: true, source: "generated", lines: [{ text: "one", start: 1.5, cues: [] }] };
    expect(lyricsFile(early).body).toBe("[00:00.00] Lyrics: written by Tomo TV on iPad\n[00:01.50] one");
  });

  it("puts the source line first in untimed text", () => {
    const plain: ItemLyrics = { synced: false, source: "lrclib", lines: [{ text: "one", start: null, cues: [] }] };
    expect(lyricsFile(plain).body).toBe("Lyrics: lrclib.net\none");
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

  it("is yes for a signed-in account without asking the server", async () => {
    account("user-10");
    expect(await canManageLyrics()).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("is no for an account once the server refused it an upload with 403", async () => {
    account("user-11");
    mockFetch.mockResolvedValue({ ok: false, status: 403 });
    await uploadLyrics("song-1", WORDED);
    expect(await canManageLyrics()).toBe(false);

    account("user-12");
    expect(await canManageLyrics()).toBe(true);
  });

  it("stays yes after a 401, a server error or no answer", async () => {
    account("user-14");
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await uploadLyrics("song-1", WORDED);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await uploadLyrics("song-1", WORDED);
    mockFetch.mockRejectedValueOnce(new Error("offline"));
    await uploadLyrics("song-1", WORDED);
    expect(await canManageLyrics()).toBe(true);
  });

  it("is no when nobody is signed in", async () => {
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
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "text/plain", Authorization: "auth-header" },
      body: "[00:00.00] Lyrics: lrclib.net\n[00:03.00]\n[01:01.50] <01:01.50> one <01:02.25> two\n[01:10.00] three",
    });
  });

  it("sends generated lyrics like found ones", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    expect(await uploadLyrics("song-1", { ...WORDED, source: "generated" })).toBe(true);
    expect(mockFetch.mock.calls[0][0]).toBe("http://server/Audio/song-1/Lyrics?fileName=lyrics.elrc");
  });

  it("never sends untimed lyrics", async () => {
    const plain: ItemLyrics = { synced: false, source: "lrclib", lines: [{ text: "one", start: null, cues: [] }] };
    expect(await uploadLyrics("song-1", plain)).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("never sends the server's own lyrics or ones of no known source", async () => {
    expect(await uploadLyrics("song-1", { ...WORDED, source: "server" })).toBe(false);
    expect(await uploadLyrics("song-1", { ...WORDED, source: undefined })).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("is false when the server refuses or cannot be reached", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    expect(await uploadLyrics("song-1", WORDED)).toBe(false);
    mockFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await uploadLyrics("song-1", WORDED)).toBe(false);
  });
});
