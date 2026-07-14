import { addFavoriteIds, clearFavoriteIdsCache, getFavoriteIds, isFavoritesLoaded, markFavorite } from "@/services/favoritesCache";

describe("favoritesCache", () => {
  beforeEach(() => {
    clearFavoriteIdsCache();
  });

  it("starts empty and unloaded", () => {
    expect(isFavoritesLoaded()).toBe(false);
    expect(getFavoriteIds().size).toBe(0);
  });

  it("addFavoriteIds seeds the set and marks it loaded", () => {
    addFavoriteIds(["a", "b"]);
    expect(isFavoritesLoaded()).toBe(true);
    expect(getFavoriteIds().has("a")).toBe(true);
    expect(getFavoriteIds().has("b")).toBe(true);
  });

  it("addFavoriteIds merges without dropping earlier ids", () => {
    addFavoriteIds(["a"]);
    addFavoriteIds(["b"]);
    expect([...getFavoriteIds()].sort()).toEqual(["a", "b"]);
  });

  it("marks it loaded even when seeded with an empty set (a user with no favorites)", () => {
    addFavoriteIds([]);
    expect(isFavoritesLoaded()).toBe(true);
  });

  it("markFavorite adds and removes a single id", () => {
    markFavorite("x", true);
    expect(getFavoriteIds().has("x")).toBe(true);
    markFavorite("x", false);
    expect(getFavoriteIds().has("x")).toBe(false);
  });

  it("clearFavoriteIdsCache empties the set and resets loaded", () => {
    addFavoriteIds(["a"]);
    clearFavoriteIdsCache();
    expect(isFavoritesLoaded()).toBe(false);
    expect(getFavoriteIds().size).toBe(0);
  });
});
