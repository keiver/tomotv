jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/jellyfinApi", () => ({}));
jest.mock("@/services/jellyfin/http", () => ({ fetchWithTimeout: jest.fn() }));
jest.mock("@/constants/app", () => ({ APP_VERSION: "1.0.0" }));

import { markSourceDown, resetSourceChain, runChain, sourcesFor } from "@/services/subtitles/chain";
import {
  NO_KEYS,
  SOURCE_ORDER,
  SourceRefusal,
  type SearchContext,
  type SearchSourceId,
  type SubtitleHit,
  type SubtitleQuery,
  type SubtitleSource,
  type SubtitleSourceId,
} from "@/services/subtitles/types";

const query: SubtitleQuery = { kind: "movie", keywords: "Film", fileName: "Film" };
const context: SearchContext = { itemId: "i", serverAllowed: true, findSubtitles: true, keys: { opensubtitles: { apiKey: "k", username: "u", password: "p" }, subsource: "x" } };

function hit(source: SubtitleSourceId): SubtitleHit {
  return { id: source, source, name: source, language: "en", format: "", hashMatch: false, forced: false, hearingImpaired: false, machineTranslated: false, rating: null, downloads: null, author: "" };
}

function fake(id: SubtitleSourceId, search: () => Promise<SubtitleHit[]>, accepts = true): SubtitleSource {
  return { id, accepts: () => accepts, search, fetch: async () => ({ text: "", format: "srt" }) };
}

function sources(overrides: Partial<Record<SearchSourceId, SubtitleSource>>): Record<SearchSourceId, SubtitleSource> {
  const all = {} as Record<SearchSourceId, SubtitleSource>;
  for (const id of SOURCE_ORDER) all[id] = overrides[id] ?? fake(id, async () => []);
  return all;
}

describe("runChain", () => {
  beforeEach(() => resetSourceChain());

  it("asks the sources in order and stops at the first that answers", async () => {
    const asked: SubtitleSourceId[] = [];
    const all = sources({
      server: fake("server", async () => (asked.push("server"), [])),
      opensubtitles: fake("opensubtitles", async () => (asked.push("opensubtitles"), [hit("opensubtitles")])),
      subsource: fake("subsource", async () => (asked.push("subsource"), [hit("subsource")])),
    });
    const answer = await runChain(query, "en", context, all);
    expect(asked).toEqual(["server", "opensubtitles"]);
    expect(answer.answeredBy).toBe("opensubtitles");
    expect(answer.hits).toHaveLength(1);
    expect(answer.refused).toEqual([]);
  });

  it("a refusal is remembered for the session and reported, and the chain goes on", async () => {
    const serverSearch = jest.fn(async () => {
      throw new SourceRefusal("server", 429, "quota");
    });
    const all = sources({ server: fake("server", serverSearch), subsource: fake("subsource", async () => [hit("subsource")]) });
    const first = await runChain(query, "en", context, all);
    expect(first.answeredBy).toBe("subsource");
    expect(first.refused).toEqual([{ source: "server", status: 429 }]);
    const second = await runChain(query, "en", context, all);
    expect(serverSearch).toHaveBeenCalledTimes(1);
    expect(second.refused).toEqual([{ source: "server", status: 429 }]);
  });

  it("a plain failure is skipped without being remembered", async () => {
    const failing = jest.fn(async () => {
      throw new Error("network");
    });
    const all = sources({ server: fake("server", failing), subsource: fake("subsource", async () => [hit("subsource")]) });
    await runChain(query, "en", context, all);
    await runChain(query, "en", context, all);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("leaves out sources that do not take the query or were marked down by a failed save", () => {
    markSourceDown("server", 500);
    const all = sources({ subsource: fake("subsource", async () => [], false) });
    expect(sourcesFor(query, context, all).map((source) => source.id)).toEqual(["opensubtitles"]);
  });

  it("answers empty when nothing is found anywhere", async () => {
    const answer = await runChain(query, "en", { ...context, keys: NO_KEYS }, sources({}));
    expect(answer).toEqual({ hits: [], answeredBy: null, refused: [] });
  });
});
