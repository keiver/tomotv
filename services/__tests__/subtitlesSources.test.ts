jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/constants/app", () => ({ APP_VERSION: "1.0.0" }));
const mockFetch = jest.fn();
jest.mock("@/services/jellyfin/http", () => ({ fetchWithTimeout: (...args: unknown[]) => mockFetch(...args) }));
const mockSearchRemote = jest.fn();
const mockFetchRemoteFile = jest.fn();
jest.mock("@/services/jellyfinApi", () => ({
  searchRemoteSubtitles: (...args: unknown[]) => mockSearchRemote(...args),
  fetchRemoteSubtitleFile: (...args: unknown[]) => mockFetchRemoteFile(...args),
}));

import { zipSync, strToU8 } from "fflate";
import { unpackSubtitle } from "@/services/subtitles/sources/http";
import { openSubtitlesParams, openSubtitlesSource, resetOpenSubtitlesTokens } from "@/services/subtitles/sources/opensubtitles";
import { serverSource } from "@/services/subtitles/sources/server";
import { subsourceSearchParams, subsourceSource } from "@/services/subtitles/sources/subsource";
import { SourceRefusal, type SearchContext, type SubtitleHit, type SubtitleQuery } from "@/services/subtitles/types";

const movie: SubtitleQuery = { kind: "movie", keywords: "Some Film", year: 2020, fileName: "Some.Film.2020" };
const episode: SubtitleQuery = { kind: "episode", keywords: "Some Show", season: 1, episode: 3, fileName: "Some.Show.S01E03" };
const context: SearchContext = {
  itemId: "item1",
  serverAllowed: true,
  findSubtitles: true,
  keys: { opensubtitles: { apiKey: "key", username: "me", password: "pw" }, subsource: "ssk" },
};

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
}

function bytes(data: Uint8Array, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
    text: async () => "",
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  } as unknown as Response;
}

const SRT = "1\n00:00:01,000 --> 00:00:02,000\nHi\n";

beforeEach(() => {
  mockFetch.mockReset();
  mockSearchRemote.mockReset();
  mockFetchRemoteFile.mockReset();
  resetOpenSubtitlesTokens();
});

describe("unpackSubtitle", () => {
  it("reads a plain file and the one subtitle inside a zip", () => {
    expect(unpackSubtitle(strToU8(SRT), "a.srt")).toEqual({ text: SRT, format: "srt" });
    const zipped = zipSync({ "readme.txt": strToU8("x"), "Some.Film.srt": strToU8(SRT), "notes.nfo": strToU8("y") });
    expect(unpackSubtitle(zipped, "")).toEqual({ text: SRT, format: "srt" });
  });

  it("answers null for a zip holding no subtitle", () => {
    expect(unpackSubtitle(zipSync({ "readme.nfo": strToU8("x") }), "")).toBeNull();
  });
});

describe("server source", () => {
  it("takes movies and episodes for an allowed account only", () => {
    expect(serverSource.accepts(movie, context)).toBe(true);
    expect(serverSource.accepts({ ...movie, kind: "video" }, context)).toBe(false);
    expect(serverSource.accepts(movie, { ...context, serverAllowed: false })).toBe(false);
  });

  it("asks the server in ISO 639-2 and maps the answer", async () => {
    mockSearchRemote.mockResolvedValue({
      status: 200,
      results: [
        { Id: "abc", Name: "Some.Film.2020-GRP", ThreeLetterISOLanguageName: "eng", Format: "srt", IsHashMatch: true, CommunityRating: 8.5, DownloadCount: 12, HearingImpaired: true, Author: "x" },
        { Name: "no id" },
      ],
    });
    const hits = await serverSource.search(movie, "en", context);
    expect(mockSearchRemote).toHaveBeenCalledWith("item1", "eng");
    expect(hits).toEqual([
      {
        id: "abc",
        source: "server",
        name: "Some.Film.2020-GRP",
        language: "en",
        format: "srt",
        hashMatch: true,
        forced: false,
        hearingImpaired: true,
        machineTranslated: false,
        rating: 8.5,
        downloads: 12,
        author: "x",
      },
    ]);
  });

  it("turns a 403, 429 or 500 into a refusal", async () => {
    mockSearchRemote.mockResolvedValue({ status: 500, results: [] });
    await expect(serverSource.search(movie, "en", context)).rejects.toBeInstanceOf(SourceRefusal);
  });

  it("reads a provider's file through the server", async () => {
    mockFetchRemoteFile.mockResolvedValue({ status: 200, text: SRT });
    const hit = { id: "abc", format: "srt" } as SubtitleHit;
    expect(await serverSource.fetch(hit, context)).toEqual({ text: SRT, format: "srt" });
  });
});

describe("opensubtitles source", () => {
  it("is skipped without an account", () => {
    expect(openSubtitlesSource.accepts(movie, { ...context, keys: { ...context.keys, opensubtitles: null } })).toBe(false);
  });

  it("builds the search by ids when the item has them, by title otherwise", () => {
    expect(openSubtitlesParams({ ...movie, imdbId: "tt0012345" }, "en").get("imdb_id")).toBe("0012345");
    expect(openSubtitlesParams({ ...episode, imdbId: "tt0012345" }, "en").get("parent_imdb_id")).toBe("0012345");
    const params = openSubtitlesParams(episode, "fr");
    expect(params.get("query")).toBe("Some Show");
    expect(params.get("languages")).toBe("fr");
    expect(params.get("season_number")).toBe("1");
    expect(params.get("episode_number")).toBe("3");
    expect(params.get("type")).toBe("episode");
  });

  it("searches with the key and maps each file, named by its file name", async () => {
    mockFetch.mockResolvedValue(
      json({
        data: [
          {
            id: "77",
            attributes: {
              language: "en",
              release: "Some.Film.2020.1080p",
              download_count: 900,
              ratings: 7.5,
              moviehash_match: true,
              files: [{ file_id: 123, file_name: "Some.Film.srt" }],
              uploader: { name: "up" },
            },
          },
          { id: "78", attributes: { files: [] } },
        ],
      }),
    );
    const hits = await openSubtitlesSource.search(movie, "en", context);
    expect((mockFetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "Api-Key": "key", "User-Agent": "TomoTV v1.0.0" });
    expect(hits).toEqual([expect.objectContaining({ id: "123", source: "opensubtitles", name: "Some.Film.srt", hashMatch: true, rating: 7.5, downloads: 900, author: "up" })]);
  });

  it("logs in once, asks for a link, and reads the file from it", async () => {
    mockFetch
      .mockResolvedValueOnce(json({ token: "tok", user: { allowed_downloads: 20, remaining_downloads: 19 } }))
      .mockResolvedValueOnce(json({ link: "https://dl.example/x.srt", file_name: "x.srt", remaining: 18 }))
      .mockResolvedValueOnce(bytes(strToU8(SRT)))
      .mockResolvedValueOnce(json({ link: "https://dl.example/y.srt", file_name: "y.srt", remaining: 17 }))
      .mockResolvedValueOnce(bytes(strToU8(SRT)));
    const hit = { id: "123", name: "x", source: "opensubtitles" } as SubtitleHit;
    expect(await openSubtitlesSource.fetch(hit, context)).toEqual({ text: SRT, format: "srt" });
    await openSubtitlesSource.fetch(hit, context);
    const urls = mockFetch.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([
      "https://api.opensubtitles.com/api/v1/login",
      "https://api.opensubtitles.com/api/v1/download",
      "https://dl.example/x.srt",
      "https://api.opensubtitles.com/api/v1/download",
      "https://dl.example/y.srt",
    ]);
    expect((mockFetch.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string)).toEqual({ file_id: 123, sub_format: "srt" });
  });

  it("a 406 on download is a refusal", async () => {
    mockFetch.mockResolvedValueOnce(json({ token: "tok" })).mockResolvedValueOnce(json({ message: "quota" }, 406));
    await expect(openSubtitlesSource.fetch({ id: "1" } as SubtitleHit, context)).rejects.toMatchObject({ source: "opensubtitles", status: 406 });
  });
});

describe("subsource source", () => {
  it("searches titles by IMDb id when known, by text otherwise", () => {
    expect(subsourceSearchParams({ ...movie, imdbId: "tt1" }).toString()).toBe("searchType=imdb&imdb=tt1&type=movie&year=2020");
    expect(subsourceSearchParams(episode).toString()).toBe("searchType=text&q=Some+Show&type=series&season=1");
  });

  it("lists the title's subtitles in the language's English name, keeps the episode's releases and names each by the one for the episode", async () => {
    mockFetch
      .mockResolvedValueOnce(
        json({
          data: [
            { movieId: 5, title: "Some Show", type: "series", season: 2 },
            { movieId: 7, title: "Some Show", type: "series", season: 1 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: [
            { subtitleId: 1, releaseInfo: ["Some.Show.S01.Season.Pack", "Some.Show.S01E03.720p"], hearingImpaired: false, downloads: 40, rating: { good: 8, bad: 2, total: 10 } },
            { subtitleId: 2, releaseInfo: ["Some.Show.S01E04.720p"] },
          ],
        }),
      );
    const hits = await subsourceSource.search(episode, "en", context);
    expect(mockFetch.mock.calls[1][0]).toBe("https://api.subsource.net/api/v1/subtitles?movieId=7&language=english&limit=50");
    expect((mockFetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "X-API-Key": "ssk" });
    expect(hits).toEqual([expect.objectContaining({ id: "1", source: "subsource", name: "Some.Show.S01E03.720p", rating: 8, downloads: 40 })]);
  });
});
