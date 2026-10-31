import { fileStem, queryLabel, subtitleQuery, titleFromFileName } from "@/services/subtitles/query";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const base = { Id: "i", MediaStreams: [] } as unknown as JellyfinVideoItem;

describe("subtitleQuery", () => {
  it("asks for an episode by series, season and episode", () => {
    const query = subtitleQuery({ ...base, Name: "Pilot", Type: "Episode", Path: "/tv/Show/S01E01.mkv", SeriesName: "Some Show", ParentIndexNumber: 1, IndexNumber: 1 });
    expect(query).toMatchObject({ kind: "episode", keywords: "Some Show", season: 1, episode: 1, fileName: "S01E01" });
    expect(queryLabel(query)).toBe("S01 E01");
  });

  it("asks for a film by title and year, with its provider ids", () => {
    const item = { ...base, Name: "A Film", Type: "Movie", Path: "/movies/A.Film.2019.1080p.mkv", ProductionYear: 2019, ProviderIds: { Imdb: "tt0000001", Tmdb: "42" } };
    const query = subtitleQuery(item);
    expect(query).toMatchObject({ kind: "movie", keywords: "A Film", year: 2019, imdbId: "tt0000001", tmdbId: "42", fileName: "A.Film.2019.1080p" });
    expect(queryLabel(query)).toBe("2019");
  });

  it("reads a plain video's title and year out of its file name", () => {
    const query = subtitleQuery({ ...base, Name: "Some.Title.2021.2160p.WEB-DL.x265-GRP", Type: "Video", Path: "/videos/Some.Title.2021.2160p.WEB-DL.x265-GRP.mp4" });
    expect(query).toMatchObject({ kind: "video", keywords: "Some Title", year: 2021 });
    expect(queryLabel(query)).toBe("2021");
  });

  it("reads episode numbers out of a plain video's file name", () => {
    const query = subtitleQuery({ ...base, Name: "Show.Name.S02E05.720p.HDTV", Type: "Video", Path: "/videos/Show.Name.S02E05.720p.HDTV.mkv" });
    expect(query).toMatchObject({ kind: "episode", keywords: "Show Name", season: 2, episode: 5 });
  });

  it("keeps a plain name with no tags as it is", () => {
    const query = subtitleQuery({ ...base, Name: "Holiday clip", Type: "Video", Path: "/videos/clip.mov" });
    expect(query).toMatchObject({ kind: "video", keywords: "Holiday clip", fileName: "clip" });
    expect(queryLabel(query)).toBe("");
  });

  it("takes an episode item missing its numbers as a plain video", () => {
    const query = subtitleQuery({ ...base, Name: "Special", Type: "Episode", Path: "/tv/Show/Special.mkv", SeriesName: "Show" });
    expect(query.kind).toBe("video");
  });
});

describe("file names", () => {
  it("strips folders and the extension", () => {
    expect(fileStem("/a/b/Some.File.mkv")).toBe("Some.File");
    expect(fileStem("C:\\media\\Some File.mp4")).toBe("Some File");
    expect(fileStem(undefined)).toBe("");
  });

  it("turns a release name into a title", () => {
    expect(titleFromFileName("Some_Title.1999.REMUX.1080p")).toBe("Some Title");
    expect(titleFromFileName("Another.Title.720p.BluRay.x264-GRP")).toBe("Another Title");
  });
});
