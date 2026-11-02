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
import { openSubtitlesDownloadsLeft, openSubtitlesHit, openSubtitlesParams, openSubtitlesSource, resetOpenSubtitlesTokens } from "@/services/subtitles/sources/opensubtitles";
import { serverSource } from "@/services/subtitles/sources/server";
import { SourceRefusal, type SearchContext, type SubtitleHit, type SubtitleQuery } from "@/services/subtitles/types";

const movie: SubtitleQuery = { kind: "movie", keywords: "Some Film", year: 2020, fileName: "Some.Film.2020" };
const episode: SubtitleQuery = { kind: "episode", keywords: "Some Show", season: 1, episode: 3, fileName: "Some.Show.S01E03" };
const context: SearchContext = {
  itemId: "item1",
  serverAllowed: true,
  findSubtitles: true,
  keys: { opensubtitles: { username: "me", password: "pw" } },
};
const anonymous: SearchContext = { ...context, keys: { opensubtitles: null } };

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

afterAll(() => {
  delete process.env.EXPO_PUBLIC_OPENSUBTITLES_API_KEY;
});

beforeEach(() => {
  process.env.EXPO_PUBLIC_OPENSUBTITLES_API_KEY = "key";
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
  it("is asked without a viewer account, and skipped in a build without the app key or with the search off", () => {
    expect(openSubtitlesSource.accepts(movie, anonymous)).toBe(true);
    expect(openSubtitlesSource.accepts(movie, { ...context, findSubtitles: false })).toBe(false);
    delete process.env.EXPO_PUBLIC_OPENSUBTITLES_API_KEY;
    expect(openSubtitlesSource.accepts(movie, context)).toBe(false);
  });

  it("asks by the item's own id alone, without tt or leading zeroes, for a film or an episode", () => {
    expect(openSubtitlesParams({ ...movie, imdbId: "tt0012345" }, "en").toString()).toBe("imdb_id=12345&languages=en&order_by=download_count&order_direction=desc");
    expect(openSubtitlesParams({ ...episode, imdbId: "tt18246720" }, "en").toString()).toBe("imdb_id=18246720&languages=en&order_by=download_count&order_direction=desc");
    expect(openSubtitlesParams({ ...episode, tmdbId: "05051965" }, "en").toString()).toBe("languages=en&order_by=download_count&order_direction=desc&tmdb_id=5051965");
  });

  it("asks by the lowercased title in alphabetical parameter order when the item has no id", () => {
    const params = openSubtitlesParams(episode, "fr");
    expect(params.toString()).toBe("episode_number=3&languages=fr&order_by=download_count&order_direction=desc&query=some+show&season_number=1&type=episode");
    expect(params.get("query")).toBe("some show");
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
              votes: 4,
              moviehash_match: true,
              files: [{ file_id: 123, file_name: "Some.Film.srt" }],
              uploader: { name: "up" },
            },
          },
          { id: "78", attributes: { files: [] } },
        ],
      }),
    );
    const hits = await openSubtitlesSource.search(movie, "en", anonymous);
    expect((mockFetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "Api-Key": "key", "User-Agent": "TomoTV v1.0.0" });
    expect(hits).toEqual([expect.objectContaining({ id: "123", source: "opensubtitles", name: "Some.Film.srt", hashMatch: true, rating: 7.5, downloads: 900, author: "up" })]);
  });

  it("gives an unrated subtitle no rating instead of 0.0", () => {
    expect(openSubtitlesHit({ attributes: { ratings: 0, votes: 0, files: [{ file_id: 1 }] } }, "en")?.rating).toBeNull();
  });

  it("downloads with the app key alone when the viewer keeps no account", async () => {
    mockFetch.mockResolvedValueOnce(json({ link: "https://dl.example/x.srt", file_name: "x.srt", remaining: 4 })).mockResolvedValueOnce(bytes(strToU8(SRT)));
    const hit = { id: "123", name: "x", source: "opensubtitles" } as SubtitleHit;
    expect(openSubtitlesDownloadsLeft()).toBeNull();
    expect(await openSubtitlesSource.fetch(hit, anonymous)).toEqual({ text: SRT, format: "srt" });
    expect(openSubtitlesDownloadsLeft()).toBe(4);
    expect(mockFetch.mock.calls.map((call) => call[0])).toEqual(["https://api.opensubtitles.com/api/v1/download", "https://dl.example/x.srt"]);
    const sent = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(sent["Api-Key"]).toBe("key");
    expect(sent.Authorization).toBeUndefined();
  });

  it("logs in once with the viewer's account, asks for a link, and reads the file from it", async () => {
    mockFetch
      .mockResolvedValueOnce(json({ token: "tok", user: { allowed_downloads: 20, remaining_downloads: 19 } }))
      .mockResolvedValueOnce(json({ link: "https://dl.example/x.srt", file_name: "x.srt", remaining: 18 }))
      .mockResolvedValueOnce(bytes(strToU8(SRT)))
      .mockResolvedValueOnce(json({ link: "https://dl.example/y.srt", file_name: "y.srt", remaining: 17 }))
      .mockResolvedValueOnce(bytes(strToU8(SRT)));
    const hit = { id: "123", name: "x", source: "opensubtitles" } as SubtitleHit;
    expect(await openSubtitlesSource.fetch(hit, context)).toEqual({ text: SRT, format: "srt" });
    expect(openSubtitlesDownloadsLeft()).toBe(18);
    await openSubtitlesSource.fetch(hit, context);
    expect(openSubtitlesDownloadsLeft()).toBe(17);
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

  it("downloads with the app key alone when the kept sign-in is refused", async () => {
    mockFetch
      .mockResolvedValueOnce(json({ message: "bad password" }, 401))
      .mockResolvedValueOnce(json({ link: "https://dl.example/x.srt", file_name: "x.srt" }))
      .mockResolvedValueOnce(bytes(strToU8(SRT)));
    expect(await openSubtitlesSource.fetch({ id: "1", name: "x" } as SubtitleHit, context)).toEqual({ text: SRT, format: "srt" });
    expect(((mockFetch.mock.calls[1][1] as RequestInit).headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("signs in again once when the download answers 401 for an expired token", async () => {
    mockFetch
      .mockResolvedValueOnce(json({ token: "old" }))
      .mockResolvedValueOnce(json({ message: "invalid token" }, 401))
      .mockResolvedValueOnce(json({ token: "new" }))
      .mockResolvedValueOnce(json({ link: "https://dl.example/x.srt", file_name: "x.srt" }))
      .mockResolvedValueOnce(bytes(strToU8(SRT)));
    expect(await openSubtitlesSource.fetch({ id: "1", name: "x" } as SubtitleHit, context)).toEqual({ text: SRT, format: "srt" });
    expect(mockFetch.mock.calls.map((call) => call[0])).toEqual([
      "https://api.opensubtitles.com/api/v1/login",
      "https://api.opensubtitles.com/api/v1/download",
      "https://api.opensubtitles.com/api/v1/login",
      "https://api.opensubtitles.com/api/v1/download",
      "https://dl.example/x.srt",
    ]);
    expect((mockFetch.mock.calls[3][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer new" });
  });

  it("reads a 406 on download as the day's limit, the free one without a sign-in and the account's with one", async () => {
    mockFetch.mockResolvedValueOnce(json({ message: "quota" }, 406));
    await expect(openSubtitlesSource.fetch({ id: "1" } as SubtitleHit, anonymous)).rejects.toMatchObject({ name: "DownloadLimit", status: 406, signedIn: false });
    mockFetch.mockResolvedValueOnce(json({ token: "tok" })).mockResolvedValueOnce(json({ message: "quota" }, 406));
    await expect(openSubtitlesSource.fetch({ id: "1" } as SubtitleHit, context)).rejects.toMatchObject({ name: "DownloadLimit", status: 406, signedIn: true });
  });

  it("never sends a refused username and password again in the same session", async () => {
    mockFetch.mockResolvedValue(json({ message: "bad password" }, 401));
    await openSubtitlesSource.fetch({ id: "1" } as SubtitleHit, context).catch(() => undefined);
    await openSubtitlesSource.fetch({ id: "1" } as SubtitleHit, context).catch(() => undefined);
    expect(mockFetch.mock.calls.filter((call) => String(call[0]).endsWith("/login"))).toHaveLength(1);
  });

  it("downloads on the VIP host the login names", async () => {
    mockFetch
      .mockResolvedValueOnce(json({ token: "tok", base_url: "vip-api.opensubtitles.com" }))
      .mockResolvedValueOnce(json({ link: "https://dl.example/x.srt", file_name: "x.srt" }))
      .mockResolvedValueOnce(bytes(strToU8(SRT)));
    await openSubtitlesSource.fetch({ id: "1", name: "x" } as SubtitleHit, context);
    expect(mockFetch.mock.calls[1][0]).toBe("https://vip-api.opensubtitles.com/api/v1/download");
  });
});
