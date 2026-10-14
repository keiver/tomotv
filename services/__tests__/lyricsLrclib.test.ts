/**
 * The LRCLIB client: who it asks for, the order it asks in, which answers it accepts as the same
 * cut of the song, and how it behaves when the service is busy. Songs are synthetic.
 */
import { findOnLrclib, lookupCandidates, parseLrc } from "@/services/lyrics/lrclib";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/constants/app", () => ({ APP_VERSION: "9.9.9" }));

const TICKS = 10_000_000;
const song = (name: string, artists: string[] = [], seconds = 200) => ({ Name: name, Artists: artists, RunTimeTicks: seconds * TICKS });
const answer = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => ({
  status,
  json: async () => body,
  headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
});
const SYNCED = "[00:01.50] first line\n[00:04.00] second line";

describe("lookupCandidates", () => {
  it("asks for the tags as they are", () => {
    expect(lookupCandidates(song("Night Drive", ["The Fixtures"]))).toEqual([{ artist: "The Fixtures", title: "Night Drive" }]);
  });

  it("reads artist and title out of a filename-style name, and strips the upload noise", () => {
    expect(lookupCandidates(song("The Fixtures - Night Drive (Official Audio)"))).toEqual([{ artist: "The Fixtures", title: "Night Drive" }]);
    expect(lookupCandidates(song(`The Fixtures ${String.fromCharCode(0x2014)} Night Drive [HD]`))).toEqual([{ artist: "The Fixtures", title: "Night Drive" }]);
  });

  it("tries the first of several artists on their own", () => {
    expect(lookupCandidates(song("Ana & Bo - Two Voices"))).toEqual([
      { artist: "Ana & Bo", title: "Two Voices" },
      { artist: "Ana", title: "Two Voices" },
    ]);
  });

  it("keeps the tag first and never more than three", () => {
    const candidates = lookupCandidates(song("Ana, Bo - Two Voices", ["Uploader"]));
    expect(candidates[0]).toEqual({ artist: "Uploader", title: "Ana, Bo - Two Voices" });
    expect(candidates).toHaveLength(3);
  });

  it("has nobody to ask for with no artist anywhere", () => {
    expect(lookupCandidates(song("Untitled"))).toEqual([]);
  });
});

describe("parseLrc", () => {
  it("reads stamped lines in time order and skips the rest", () => {
    expect(parseLrc("[ar: someone]\n[00:04.00] second\n[00:01.50] first\n[01:02.25]")).toEqual([
      { text: "first", start: 1.5, cues: [] },
      { text: "second", start: 4, cues: [] },
      { text: "", start: 62.25, cues: [] },
    ]);
  });
});

describe("findOnLrclib", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("names itself, asks with the file's length, and returns synced lyrics", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(answer(200, { duration: 200, syncedLyrics: SYNCED, plainLyrics: "first line\nsecond line" }));

    const found = await findOnLrclib(song("Night Drive", ["The Fixtures"]));

    expect(found).toEqual({
      status: "found",
      match: {
        sameCut: true,
        lyrics: {
          synced: true,
          source: "lrclib",
          lines: [
            { text: "first line", start: 1.5, cues: [] },
            { text: "second line", start: 4, cues: [] },
          ],
        },
      },
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://lrclib.net/api/get?artist_name=The+Fixtures&track_name=Night+Drive&duration=200");
    expect(init.headers["User-Agent"]).toBe("TomoTV/9.9.9 (https://github.com/keiver/tomotv)");
  });

  it("walks the candidates, then searches once", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(answer(404))
      .mockResolvedValueOnce(answer(404))
      .mockResolvedValueOnce(answer(200, [{ duration: 201, syncedLyrics: SYNCED }]));

    const found = await findOnLrclib(song("Ana & Bo - Two Voices"));

    expect(found.status).toBe("found");
    const urls = (global.fetch as jest.Mock).mock.calls.map(([url]) => url as string);
    expect(urls).toHaveLength(3);
    expect(urls[2]).toBe("https://lrclib.net/api/search?track_name=Two+Voices&artist_name=Ana");
  });

  it("takes a search result as the same cut only within three seconds, synced first", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(answer(404)).mockResolvedValueOnce(
      answer(200, [
        { duration: 202, plainLyrics: "plain only" },
        { duration: 203, syncedLyrics: SYNCED },
        { duration: 260, syncedLyrics: "[00:09.00] other cut" },
      ]),
    );

    const found = await findOnLrclib(song("Night Drive", ["The Fixtures"]));

    expect(found).toMatchObject({ status: "found", match: { sameCut: true, lyrics: { synced: true } } });
  });

  it("keeps another cut's words as untimed text for the device to confirm", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(answer(404)).mockResolvedValueOnce(answer(200, [{ duration: 260, syncedLyrics: SYNCED }]));

    const found = await findOnLrclib(song("Night Drive", ["The Fixtures"]));

    expect(found).toEqual({
      status: "found",
      match: {
        sameCut: false,
        lyrics: {
          synced: false,
          source: "lrclib",
          lines: [
            { text: "first line", start: null, cues: [] },
            { text: "second line", start: null, cues: [] },
          ],
        },
      },
    });
  });

  it("is a definite miss when nothing matches, and for an instrumental", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(answer(404)).mockResolvedValueOnce(answer(200, []));
    expect(await findOnLrclib(song("Night Drive", ["The Fixtures"]))).toEqual({ status: "none" });

    (global.fetch as jest.Mock).mockResolvedValueOnce(answer(200, { duration: 200, instrumental: true })).mockResolvedValueOnce(answer(200, [{ duration: 200, instrumental: true, plainLyrics: "x" }]));
    expect(await findOnLrclib(song("Night Drive", ["The Fixtures"]))).toEqual({ status: "none" });
  });

  it("asks nothing for a song with no artist or no length", async () => {
    expect(await findOnLrclib(song("Untitled"))).toEqual({ status: "none" });
    expect(await findOnLrclib(song("Night Drive", ["The Fixtures"], 0))).toEqual({ status: "none" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("waits out a busy service and retries, then gives up as unreachable rather than a miss", async () => {
    jest.useFakeTimers();
    try {
      (global.fetch as jest.Mock).mockResolvedValue(answer(503, {}, { "retry-after": "1" }));
      const pending = findOnLrclib(song("Night Drive", ["The Fixtures"]));
      await jest.advanceTimersByTimeAsync(5000);

      expect(await pending).toEqual({ status: "unreachable" });
      expect(global.fetch).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it("is unreachable when the request throws", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("offline"));

    expect(await findOnLrclib(song("Night Drive", ["The Fixtures"]))).toEqual({ status: "unreachable" });
  });

  it("is unreachable when an answer is not JSON, such as a Wi-Fi sign-in page", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ...answer(200), json: async () => JSON.parse("<html>Sign in</html>") });

    expect(await findOnLrclib(song("Night Drive", ["The Fixtures"]))).toEqual({ status: "unreachable" });
  });

  it("treats lyrics of the wrong type as none, and a search answer that is not a list as a miss", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(answer(200, { duration: 200, syncedLyrics: 42, plainLyrics: { line: "x" } })).mockResolvedValueOnce(answer(200, { error: "not a list" }));

    expect(await findOnLrclib(song("Night Drive", ["The Fixtures"]))).toEqual({ status: "none" });
  });

  it("ignores a record longer than 50,000 characters", async () => {
    const huge = Array.from({ length: 3000 }, (_, i) => `[00:${String(i % 60).padStart(2, "0")}.00] line number ${i}`).join("\n");
    (global.fetch as jest.Mock).mockResolvedValueOnce(answer(200, { duration: 200, syncedLyrics: huge })).mockResolvedValueOnce(answer(200, [{ duration: 200, plainLyrics: huge }]));

    expect(huge.length).toBeGreaterThan(50_000);
    expect(await findOnLrclib(song("Night Drive", ["The Fixtures"]))).toEqual({ status: "none" });
  });
});
