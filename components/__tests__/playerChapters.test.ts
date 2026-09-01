import { playerChapters } from "@/components/player-host";
import { getChapterImageUrl } from "@/services/jellyfinApi";
import type { JellyfinChapter, JellyfinVideoItem } from "@/types/jellyfin";

jest.mock("@/services/jellyfinApi", () => ({
  ...jest.requireActual("@/services/jellyfinApi"),
  getChapterImageUrl: jest.fn((itemId: string, index: number, tag: string) => `chapter://${itemId}/${index}/${tag}`),
}));

const TICKS_PER_SECOND = 10_000_000;

/** An item carrying nothing but the fields the mapping reads. */
function item(runtimeSeconds: number, chapters?: JellyfinChapter[]): JellyfinVideoItem {
  return {
    Name: "Film",
    Id: "item-1",
    RunTimeTicks: runtimeSeconds * TICKS_PER_SECOND,
    Type: "Movie",
    Path: "/media/film.mkv",
    ...(chapters ? { Chapters: chapters } : {}),
  } as JellyfinVideoItem;
}

const at = (seconds: number, name?: string, imageTag?: string): JellyfinChapter => ({
  StartPositionTicks: seconds * TICKS_PER_SECOND,
  ...(name === undefined ? {} : { Name: name }),
  ...(imageTag === undefined ? {} : { ImageTag: imageTag }),
});

/**
 * Jellyfin gives a chapter a start and nothing else, so every end in the list is
 * inferred. Getting that wrong is what puts a marker in the wrong place, and the
 * last chapter is the one with no neighbour to derive from.
 */
describe("playerChapters", () => {
  it("ends each chapter where the next one starts", () => {
    const result = playerChapters(item(600, [at(0, "Open"), at(120, "Middle"), at(300, "Close")]));
    expect(result).toEqual([
      { title: "Open", startTime: 0, endTime: 120 },
      { title: "Middle", startTime: 120, endTime: 300 },
      { title: "Close", startTime: 300, endTime: 600 },
    ]);
  });

  it("ends the last chapter at the runtime, not at its own start", () => {
    const result = playerChapters(item(3600, [at(0), at(1800)]));
    expect(result?.[1]).toEqual({ title: "Chapter 2", startTime: 1800, endTime: 3600 });
  });

  it("names untitled chapters by position, since most files carry no chapter titles", () => {
    const result = playerChapters(item(300, [at(0), at(100, "   "), at(200, "Real Title")]));
    expect(result?.map((chapter) => chapter.title)).toEqual(["Chapter 1", "Chapter 2", "Real Title"]);
  });

  it("returns undefined when the server sent no chapters", () => {
    expect(playerChapters(item(600))).toBeUndefined();
    expect(playerChapters(item(600, []))).toBeUndefined();
    expect(playerChapters(null)).toBeUndefined();
  });

  it("returns undefined for a single whole-film chapter, which is what an unchaptered file reports", () => {
    expect(playerChapters(item(600, [at(0)]))).toBeUndefined();
  });

  it("drops a trailing marker at or past the runtime rather than emitting a zero-length chapter", () => {
    const result = playerChapters(item(600, [at(0, "One"), at(300, "Two"), at(600, "Stray")]));
    expect(result).toEqual([
      { title: "One", startTime: 0, endTime: 300 },
      { title: "Two", startTime: 300, endTime: 600 },
    ]);
  });

  it("never lets a dropped marker end the chapter before it", () => {
    const result = playerChapters(item(600, [at(0, "One"), at(300, "Two"), at(700, "Stray")]));
    expect(result).toEqual([
      { title: "One", startTime: 0, endTime: 300 },
      { title: "Two", startTime: 300, endTime: 600 },
    ]);
  });

  it("carries the server's keyframe for the chapters that have one, indexed by list position", () => {
    const result = playerChapters(item(300, [at(0, "One", "tag-a"), at(100, "Two"), at(200, "Three", "tag-c")]));
    expect(result?.map((chapter) => chapter.uri)).toEqual(["chapter://item-1/0/tag-a", undefined, "chapter://item-1/2/tag-c"]);
    expect(result?.[1]).not.toHaveProperty("uri");
  });

  it("sends no uri while the session is cold and the URL builder returns nothing", () => {
    jest.mocked(getChapterImageUrl).mockReturnValueOnce("");
    const result = playerChapters(item(300, [at(0, "One", "tag-a"), at(100, "Two")]));
    expect(result?.[0]).not.toHaveProperty("uri");
  });

  it("keeps the last chapter when the server reports no runtime", () => {
    const chapters = playerChapters({
      RunTimeTicks: 0,
      Chapters: [{ StartPositionTicks: 0 }, { StartPositionTicks: 600_000_000 }, { StartPositionTicks: 1_200_000_000 }],
    } as unknown as JellyfinVideoItem);

    expect(chapters).toHaveLength(3);
    expect(chapters![2].endTime).toBeGreaterThan(chapters![2].startTime);
  });

  it("keeps a two chapter list when the server reports no runtime", () => {
    const chapters = playerChapters({
      RunTimeTicks: 0,
      Chapters: [{ StartPositionTicks: 0 }, { StartPositionTicks: 600_000_000 }],
    } as unknown as JellyfinVideoItem);

    expect(chapters).toHaveLength(2);
  });
});
