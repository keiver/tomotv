/**
 * The lyrics pipeline: the order sources are asked in, the upgrade when the device has listened,
 * what is remembered and for how long, and what is saved to the server. Songs are synthetic.
 */
jest.mock("expo-file-system", () => require("./fakeFileSystem"));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/downloads/localSource", () => ({ localLyrics: jest.fn(async () => null) }));
// The server answers through fetchLyrics unless a test says it could not be asked.
jest.mock("@/services/jellyfin/lyrics", () => {
  const fetchLyrics = jest.fn(async (_itemId: string) => null);
  return { fetchLyrics, askLyrics: jest.fn(async (itemId: string) => ({ lyrics: await fetchLyrics(itemId), answered: true })) };
});
jest.mock("@/services/jellyfin/session", () => ({ getConfig: jest.fn(async () => ({ server: "http://server-a" })) }));
jest.mock("@/services/lyrics/listener", () => ({ listen: jest.fn(async () => null), listenable: jest.fn(() => true), listenerAvailable: jest.fn(async () => true) }));
jest.mock("@/services/lyrics/lrclib", () => ({ findOnLrclib: jest.fn(async () => ({ status: "none" })) }));
jest.mock("@/services/lyrics/upload", () => ({
  canManageLyrics: jest.fn(async () => true),
  uploadLyrics: jest.fn(async () => true),
  savable: (lyrics: { source?: string } | null) => lyrics?.source === "lrclib" || lyrics?.source === "generated",
}));

import { localLyrics } from "@/services/downloads/localSource";
import { askLyrics, fetchLyrics, type ItemLyrics } from "@/services/jellyfin/lyrics";
import { getConfig } from "@/services/jellyfin/session";
import { listen, listenable, listenerAvailable } from "@/services/lyrics/listener";
import { findOnLrclib } from "@/services/lyrics/lrclib";
import { networkLyrics, resolveLyrics } from "@/services/lyrics/pipeline";
import { lyricsKey, MISS_TTL_MS, readLyricsEntry, writeLyricsEntry } from "@/services/lyrics/store";
import { canManageLyrics, uploadLyrics } from "@/services/lyrics/upload";
import { DEFAULT_UI_PREFERENCES, updateUiPreferences } from "@/services/uiPreferences";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { fakeFs } from "./fakeFileSystem";

const TICKS = 10_000_000;
const SONG = { Id: "song-1", Name: "Night Drive", Type: "Audio", RunTimeTicks: 60 * TICKS, MediaSources: [{ Id: "source-1" }] } as JellyfinVideoItem;
const KEY = "http://server-a:song-1:source-1";

const lines = (synced: boolean): ItemLyrics["lines"] => [
  { text: "alpha bravo charlie", start: synced ? 10 : null, cues: [] },
  { text: "delta echo foxtrot", start: synced ? 20 : null, cues: [] },
];
const SERVER: ItemLyrics = { synced: true, source: "server", lines: lines(true) };
const LRCLIB: ItemLyrics = { synced: true, source: "lrclib", lines: lines(true) };
const PLAIN: ItemLyrics = { synced: false, source: "lrclib", lines: lines(false) };
const HEARD = [
  [10.1, "alpha"],
  [11, "bravo"],
  [12, "charlie"],
  [20.1, "delta"],
  [21, "echo"],
  [22, "foxtrot"],
].map(([start, text]) => ({ start: start as number, end: (start as number) + 0.3, text: text as string }));
const SPOKEN = Array.from({ length: 100 }, (_, i) => ({ start: i * 0.5, end: i * 0.5 + 0.3, text: `word${i}` }));

const found = (lyrics: ItemLyrics, sameCut = true) => ({ status: "found" as const, match: { lyrics, sameCut } });
const resolve = async (item: JellyfinVideoItem = SONG) => {
  const updates: (ItemLyrics | null)[] = [];
  await resolveLyrics(item, (lyrics) => updates.push(lyrics));
  return updates;
};

beforeEach(() => {
  fakeFs.clear();
  jest.clearAllMocks();
  updateUiPreferences(DEFAULT_UI_PREFERENCES);
  (localLyrics as jest.Mock).mockResolvedValue(null);
  (fetchLyrics as jest.Mock).mockResolvedValue(null);
  (getConfig as jest.Mock).mockResolvedValue({ server: "http://server-a" });
  (listen as jest.Mock).mockResolvedValue(null);
  (listenable as jest.Mock).mockReturnValue(true);
  (listenerAvailable as jest.Mock).mockResolvedValue(true);
  (findOnLrclib as jest.Mock).mockResolvedValue({ status: "none" });
  (canManageLyrics as jest.Mock).mockResolvedValue(true);
  (uploadLyrics as jest.Mock).mockResolvedValue(true);
});

describe("source order", () => {
  it("takes the server's lyrics and asks LRCLIB nothing", async () => {
    (fetchLyrics as jest.Mock).mockResolvedValue(SERVER);

    expect(await resolve()).toEqual([SERVER]);
    expect(findOnLrclib).not.toHaveBeenCalled();
    expect(uploadLyrics).not.toHaveBeenCalled();
  });

  it("takes a download's lyrics before the server's", async () => {
    (localLyrics as jest.Mock).mockResolvedValue(LRCLIB);

    expect((await resolve())[0]).toBe(LRCLIB);
    expect(fetchLyrics).not.toHaveBeenCalled();
  });

  it("asks LRCLIB when the server has none", async () => {
    (findOnLrclib as jest.Mock).mockResolvedValue(found(LRCLIB));

    expect((await resolve())[0]).toBe(LRCLIB);
  });

  it("reports null once, when nobody has any and nothing is heard", async () => {
    expect(await resolve()).toEqual([null]);
  });

  it("leaves LRCLIB alone when finding is off", async () => {
    updateUiPreferences({ findLyrics: false });

    expect(await resolve()).toEqual([null]);
    expect(findOnLrclib).not.toHaveBeenCalled();
  });
});

describe("a server that could not be asked", () => {
  const UNASKED = { lyrics: null, answered: false };

  afterEach(() => {
    jest.useRealTimers();
  });

  it("is asked again, and its lyrics shown when it answers", async () => {
    jest.useFakeTimers();
    (askLyrics as jest.Mock).mockResolvedValueOnce(UNASKED).mockResolvedValueOnce({ lyrics: SERVER, answered: true });

    const pending = resolve();
    await jest.advanceTimersByTimeAsync(1000);

    expect(await pending).toEqual([SERVER]);
    expect(askLyrics).toHaveBeenCalledTimes(2);
    expect(findOnLrclib).not.toHaveBeenCalled();
  });

  it("is not a miss to remember, and nothing is saved over it", async () => {
    jest.useFakeTimers();
    (askLyrics as jest.Mock).mockResolvedValueOnce(UNASKED).mockResolvedValueOnce(UNASKED).mockResolvedValueOnce(UNASKED);

    const missed = resolve();
    await jest.advanceTimersByTimeAsync(4000);

    expect(await missed).toEqual([null]);
    expect(askLyrics).toHaveBeenCalledTimes(3);
    expect(await readLyricsEntry(KEY)).toBeNull();

    (askLyrics as jest.Mock).mockResolvedValueOnce(UNASKED).mockResolvedValueOnce(UNASKED).mockResolvedValueOnce(UNASKED);
    (findOnLrclib as jest.Mock).mockResolvedValue(found(LRCLIB));
    const later = resolve();
    await jest.advanceTimersByTimeAsync(4000);

    expect(await later).toEqual([LRCLIB]);
    expect(uploadLyrics).not.toHaveBeenCalled();
  });
});

describe("listening", () => {
  it("reports the lyrics at once and again with word timing", async () => {
    (findOnLrclib as jest.Mock).mockResolvedValue(found(LRCLIB));
    (listen as jest.Mock).mockResolvedValue(HEARD);

    const updates = await resolve();

    expect(updates).toHaveLength(2);
    expect(updates[0]).toBe(LRCLIB);
    expect(updates[1]?.lines[0].cues.map((cue) => cue.start)).toEqual([10, 11, 12]);
    expect(listen).toHaveBeenCalledWith(SONG, "alpha bravo charlie\ndelta echo foxtrot");
  });

  it("gives the server's own lyrics word timing too, and saves nothing back", async () => {
    (fetchLyrics as jest.Mock).mockResolvedValue(SERVER);
    (listen as jest.Mock).mockResolvedValue(HEARD);

    const updates = await resolve();

    expect(updates[1]?.lines[1].cues).toHaveLength(3);
    expect(uploadLyrics).not.toHaveBeenCalled();
  });

  it("times plain text when it was heard well, and keeps it plain when it was not", async () => {
    (findOnLrclib as jest.Mock).mockResolvedValue(found(PLAIN));
    (listen as jest.Mock).mockResolvedValue(HEARD);
    expect((await resolve())[1]?.synced).toBe(true);

    fakeFs.clear();
    (listen as jest.Mock).mockResolvedValue(HEARD.slice(0, 2));
    expect(await resolve()).toEqual([PLAIN]);
  });

  it("shows another cut's words only once the device hears them fit", async () => {
    (findOnLrclib as jest.Mock).mockResolvedValue(found(PLAIN, false));
    (listen as jest.Mock).mockResolvedValue(HEARD);
    const confirmed = await resolve();
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.synced).toBe(true);

    fakeFs.clear();
    (listen as jest.Mock).mockResolvedValue(HEARD.slice(0, 2));
    expect(await resolve()).toEqual([null]);

    fakeFs.clear();
    (listen as jest.Mock).mockResolvedValue(null);
    expect(await resolve()).toEqual([null]);
  });

  it("writes lyrics from the hearing for a song with none, captioned", async () => {
    (listen as jest.Mock).mockResolvedValue(SPOKEN);

    const updates = await resolve();

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ source: "generated", caption: "Generated on this device", synced: true });
    expect(listen).toHaveBeenCalledWith(SONG, null);
  });

  it("does not listen when it is off, the device cannot, or the song is not one to listen to", async () => {
    (findOnLrclib as jest.Mock).mockResolvedValue(found(LRCLIB));
    updateUiPreferences({ listenForLyrics: false });
    await resolve();
    updateUiPreferences({ listenForLyrics: true });
    fakeFs.clear();
    (listenerAvailable as jest.Mock).mockResolvedValue(false);
    await resolve();
    fakeFs.clear();
    (listenerAvailable as jest.Mock).mockResolvedValue(true);
    (listenable as jest.Mock).mockReturnValue(false);
    await resolve();

    expect(listen).not.toHaveBeenCalled();
  });
});

describe("what is remembered", () => {
  it("asks nobody twice for a song it has finished with", async () => {
    (findOnLrclib as jest.Mock).mockResolvedValue(found(LRCLIB));
    (listen as jest.Mock).mockResolvedValue(HEARD);
    const first = await resolve();

    const second = await resolve();

    expect(second).toEqual([first[1]]);
    expect(findOnLrclib).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("listens later for lyrics found on a device that could not", async () => {
    (findOnLrclib as jest.Mock).mockResolvedValue(found(LRCLIB));
    (listenerAvailable as jest.Mock).mockResolvedValue(false);
    await resolve();

    (listenerAvailable as jest.Mock).mockResolvedValue(true);
    (listen as jest.Mock).mockResolvedValue(HEARD);
    const later = await resolve();

    expect(findOnLrclib).toHaveBeenCalledTimes(1);
    expect(later[1]?.lines[0].cues).toHaveLength(3);
  });

  it("listens later for a song with no lyrics that an earlier play could not listen to", async () => {
    (listenable as jest.Mock).mockReturnValue(false);
    expect(await resolve()).toEqual([null]);

    (listenable as jest.Mock).mockReturnValue(true);
    (listen as jest.Mock).mockResolvedValue(SPOKEN);
    const later = await resolve();

    expect(findOnLrclib).toHaveBeenCalledTimes(1);
    expect(later[0]?.source).toBe("generated");
  });

  it("drops a version 1 answer, which could say listened for a song the device never heard", async () => {
    writeLyricsEntry(KEY, { lyrics: null, listened: true, uploaded: false });
    const [uri, node] = [...fakeFs].find(([path]) => path.includes("/lyrics/")) ?? [];
    if (!uri || !node) throw new Error("no saved answer");
    fakeFs.set(uri, { ...node, content: JSON.stringify({ ...JSON.parse(node.content), version: 1 }) });
    (listen as jest.Mock).mockResolvedValue(SPOKEN);

    expect((await resolve())[0]?.source).toBe("generated");
  });

  it("does not listen again to a song with no lyrics it already listened to", async () => {
    (listen as jest.Mock).mockResolvedValue(null);
    await resolve();
    await resolve();

    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("remembers a miss, and not one from an unreachable LRCLIB", async () => {
    await resolve();
    await resolve();
    expect(findOnLrclib).toHaveBeenCalledTimes(1);

    fakeFs.clear();
    (findOnLrclib as jest.Mock).mockResolvedValue({ status: "unreachable" });
    await resolve();
    await resolve();
    expect(findOnLrclib).toHaveBeenCalledTimes(3);
  });

  it("reuses a remembered word fill of the server's lyrics only while the text is the same", async () => {
    (fetchLyrics as jest.Mock).mockResolvedValue(SERVER);
    (listen as jest.Mock).mockResolvedValue(HEARD);
    await resolve();

    expect((await resolve())[0]?.lines[0].cues).toHaveLength(3);
    expect(listen).toHaveBeenCalledTimes(1);

    const edited: ItemLyrics = { ...SERVER, lines: [{ text: "golf hotel", start: 5, cues: [] }] };
    (fetchLyrics as jest.Mock).mockResolvedValue(edited);
    expect((await resolve())[0]).toBe(edited);
  });

  it("keys by server, so the same id on another server starts over", async () => {
    (findOnLrclib as jest.Mock).mockResolvedValue(found(LRCLIB));
    await resolve();
    (getConfig as jest.Mock).mockResolvedValue({ server: "http://server-b" });
    await resolve();

    expect(findOnLrclib).toHaveBeenCalledTimes(2);
    expect(lyricsKey("http://server-a", SONG)).toBe(KEY);
  });

  it("forgets a miss after fourteen days and keeps found lyrics", async () => {
    const then = 1_000_000;
    writeLyricsEntry(KEY, { lyrics: null, listened: false, uploaded: false }, then);
    expect(await readLyricsEntry(KEY, then + MISS_TTL_MS - 1)).not.toBeNull();
    expect(await readLyricsEntry(KEY, then + MISS_TTL_MS + 1)).toBeNull();

    writeLyricsEntry(KEY, { lyrics: LRCLIB, listened: true, uploaded: false }, then);
    expect((await readLyricsEntry(KEY, then + MISS_TTL_MS * 10))?.lyrics).toEqual(LRCLIB);
  });
});

describe("saving to the server", () => {
  it("uploads LRCLIB lyrics once, at their best", async () => {
    (findOnLrclib as jest.Mock).mockResolvedValue(found(LRCLIB));
    (listen as jest.Mock).mockResolvedValue(HEARD);

    await resolve();
    await resolve();

    expect(uploadLyrics).toHaveBeenCalledTimes(1);
    expect((uploadLyrics as jest.Mock).mock.calls[0][1].lines[0].cues).toHaveLength(3);
  });

  it("uploads generated lyrics once, and keeps their caption when the server hands them back", async () => {
    (listen as jest.Mock).mockResolvedValue(SPOKEN);
    const [generated] = await resolve();
    expect(uploadLyrics).toHaveBeenCalledTimes(1);
    expect((uploadLyrics as jest.Mock).mock.calls[0][1]).toBe(generated);

    (fetchLyrics as jest.Mock).mockResolvedValue({ synced: true, source: "server", lines: generated?.lines ?? [] });
    expect(await resolve()).toEqual([generated]);
    expect(uploadLyrics).toHaveBeenCalledTimes(1);
  });

  it("keeps its own copy and caption when the server hands the upload back under its source line", async () => {
    (listen as jest.Mock).mockResolvedValue(SPOKEN);
    const [generated] = await resolve();

    const sourceLine = { text: "Lyrics: written by Tomo TV", start: 0, cues: [] };
    const blank = { text: "", start: 3, cues: [] };
    (fetchLyrics as jest.Mock).mockResolvedValue({ synced: true, source: "server", lines: [sourceLine, blank, ...(generated?.lines ?? [])] });
    expect(await resolve()).toEqual([generated]);
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("uploads nothing when saving is off or the account may not", async () => {
    (findOnLrclib as jest.Mock).mockResolvedValue(found(LRCLIB));
    updateUiPreferences({ saveLyrics: false });
    await resolve();
    updateUiPreferences({ saveLyrics: true });
    fakeFs.clear();
    (canManageLyrics as jest.Mock).mockResolvedValue(false);
    await resolve();

    expect(uploadLyrics).not.toHaveBeenCalled();
  });

  it("tries again on a later play when the server refused", async () => {
    (findOnLrclib as jest.Mock).mockResolvedValue(found(LRCLIB));
    (uploadLyrics as jest.Mock).mockResolvedValueOnce(false);
    await resolve();
    await resolve();

    expect(uploadLyrics).toHaveBeenCalledTimes(2);
  });
});

describe("shared runs", () => {
  it("gives two callers for one song a single run, and a late caller the answer so far", async () => {
    let answer: (value: unknown) => void = () => {};
    (findOnLrclib as jest.Mock).mockImplementation(() => new Promise((done) => (answer = done)));
    const early: (ItemLyrics | null)[] = [];
    const late: (ItemLyrics | null)[] = [];

    const first = resolveLyrics(SONG, (lyrics) => early.push(lyrics));
    const second = resolveLyrics(SONG, (lyrics) => late.push(lyrics));
    await new Promise((tick) => setTimeout(tick, 0));
    answer(found(LRCLIB));
    await Promise.all([first, second]);

    expect(findOnLrclib).toHaveBeenCalledTimes(1);
    expect(early).toEqual([LRCLIB]);
    expect(late).toEqual([LRCLIB]);
  });

  it("answers null when a source throws", async () => {
    (fetchLyrics as jest.Mock).mockRejectedValue(new Error("boom"));

    expect(await resolve()).toEqual([null]);
  });
});

describe("networkLyrics", () => {
  it("is the server's, else LRCLIB's same cut, and never another cut's", async () => {
    (fetchLyrics as jest.Mock).mockResolvedValue(SERVER);
    expect(await networkLyrics(SONG)).toBe(SERVER);

    (fetchLyrics as jest.Mock).mockResolvedValue(null);
    (findOnLrclib as jest.Mock).mockResolvedValue(found(LRCLIB));
    expect(await networkLyrics(SONG)).toBe(LRCLIB);

    (findOnLrclib as jest.Mock).mockResolvedValue(found(PLAIN, false));
    expect(await networkLyrics(SONG)).toBeNull();
  });
});
