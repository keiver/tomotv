import { clearPlayedCache, getPlayedOverrides, markPlayed, playedOverride } from "@/services/playedCache";

describe("playedCache", () => {
  beforeEach(() => {
    clearPlayedCache();
  });

  it("starts empty", () => {
    expect(getPlayedOverrides().size).toBe(0);
  });

  it("markPlayed records both directions of a toggle", () => {
    markPlayed("x", true);
    expect(getPlayedOverrides().get("x")).toBe(true);
    markPlayed("x", false);
    expect(getPlayedOverrides().get("x")).toBe(false);
  });

  it("holds only explicitly changed items (delta map, no seeding)", () => {
    markPlayed("a", true);
    expect(getPlayedOverrides().has("b")).toBe(false);
    expect(getPlayedOverrides().size).toBe(1);
  });

  it("clearPlayedCache empties the map", () => {
    markPlayed("a", true);
    clearPlayedCache();
    expect(getPlayedOverrides().size).toBe(0);
  });

  describe("playedOverride", () => {
    const episode = { Id: "e1", SeasonId: "season-1", SeriesId: "series-1" };

    it("is undefined for an item with no mark on it, its season or its series", () => {
      markPlayed("other", true);
      expect(playedOverride(episode)).toBeUndefined();
    });

    it("an episode marked watched reads unwatched after its season is marked unwatched", () => {
      markPlayed("e1", true);
      markPlayed("season-1", false);
      expect(playedOverride(episode)).toBe(false);
    });

    it("an episode marked unwatched reads watched after its series is marked watched", () => {
      markPlayed("e1", false);
      markPlayed("series-1", true);
      expect(playedOverride(episode)).toBe(true);
    });

    it("an episode's own mark wins when it comes after its series mark", () => {
      markPlayed("series-1", true);
      markPlayed("e1", false);
      expect(playedOverride(episode)).toBe(false);
    });

    it("a season's mark wins over an earlier series mark for its episodes", () => {
      markPlayed("series-1", true);
      markPlayed("season-1", false);
      expect(playedOverride(episode)).toBe(false);
    });

    it("a season card follows a later series mark", () => {
      markPlayed("season-1", true);
      markPlayed("series-1", false);
      expect(playedOverride({ Id: "season-1", SeriesId: "series-1" })).toBe(false);
    });

    it("marking the same id again makes it the latest write", () => {
      markPlayed("e1", true);
      markPlayed("season-1", false);
      markPlayed("e1", true);
      expect(playedOverride(episode)).toBe(true);
    });

    it("clearPlayedCache forgets the write order too", () => {
      markPlayed("e1", true);
      clearPlayedCache();
      markPlayed("season-1", false);
      markPlayed("e1", true);
      expect(playedOverride(episode)).toBe(true);
    });
  });
});
