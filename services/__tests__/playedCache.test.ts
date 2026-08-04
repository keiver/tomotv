import { clearPlayedCache, getPlayedOverrides, markPlayed } from "@/services/playedCache";

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
});
