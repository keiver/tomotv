import { autoPick, nameSimilarity, rankHits } from "@/services/subtitles/rank";
import type { SubtitleHit, SubtitleQuery } from "@/services/subtitles/types";

const query: SubtitleQuery = { kind: "movie", keywords: "Some Film", year: 2020, fileName: "Some.Film.2020.1080p.BluRay.x264-GRP" };

function hit(over: Partial<SubtitleHit>): SubtitleHit {
  return {
    id: "1",
    source: "podnapisi",
    name: "",
    language: "en",
    format: "",
    hashMatch: false,
    forced: false,
    hearingImpaired: false,
    machineTranslated: false,
    rating: null,
    downloads: null,
    author: "",
    ...over,
  };
}

describe("rankHits", () => {
  it("puts a hash match first whatever its name", () => {
    const ranked = rankHits([hit({ id: "a", name: "Some.Film.2020.1080p.BluRay.x264-GRP" }), hit({ id: "b", name: "other", hashMatch: true })], query);
    expect(ranked.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("prefers the release that reads like the file, then rating and downloads", () => {
    const ranked = rankHits(
      [
        hit({ id: "web", name: "Some.Film.2020.WEB-DL", downloads: 10 }),
        hit({ id: "bluray", name: "Some.Film.2020.1080p.BluRay.x264-GRP", downloads: 1 }),
        hit({ id: "popular", name: "Some.Film.2020.WEB-DL", downloads: 100000, rating: 9 }),
      ],
      query,
    );
    expect(ranked.map((entry) => entry.id)).toEqual(["bluray", "popular", "web"]);
  });

  it("sinks machine translations and forced tracks", () => {
    const ranked = rankHits(
      [
        hit({ id: "mt", name: "Some.Film.2020.1080p.BluRay.x264-GRP", machineTranslated: true }),
        hit({ id: "forced", name: "Some.Film.2020.1080p.BluRay.x264-GRP", forced: true }),
        hit({ id: "plain", name: "Some.Film" }),
      ],
      query,
    );
    expect(ranked.map((entry) => entry.id)).toEqual(["plain", "forced", "mt"]);
  });

  it("keeps the source's order between equals", () => {
    const ranked = rankHits([hit({ id: "first" }), hit({ id: "second" })], query);
    expect(ranked.map((entry) => entry.id)).toEqual(["first", "second"]);
  });
});

describe("nameSimilarity", () => {
  it("is the share of the file name's words the release carries", () => {
    expect(nameSimilarity("Some.Film.2020.1080p", "Some Film 2020 720p")).toBeCloseTo(0.75);
    expect(nameSimilarity("", "anything")).toBe(0);
  });
});

describe("autoPick", () => {
  it("takes a hash match", () => {
    expect(autoPick([hit({ id: "a" }), hit({ id: "b", hashMatch: true })])?.id).toBe("b");
  });

  it("takes a lone usable hit and nothing from several", () => {
    expect(autoPick([hit({ id: "only" })])?.id).toBe("only");
    expect(autoPick([hit({ id: "a" }), hit({ id: "b" })])).toBeNull();
    expect(autoPick([hit({ id: "only" }), hit({ id: "mt", machineTranslated: true })])?.id).toBe("only");
  });

  it("takes nothing from an empty list or a machine translation alone", () => {
    expect(autoPick([])).toBeNull();
    expect(autoPick([hit({ id: "mt", machineTranslated: true })])).toBeNull();
  });
});
