import { showsFavoriteHeart } from "@/components/card-badge";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

describe("showsFavoriteHeart", () => {
  it("holds for a favorite movie, episode, track or folder", () => {
    expect(showsFavoriteHeart({ Type: "Movie", UserData: { IsFavorite: true } })).toBe(true);
    expect(showsFavoriteHeart({ Type: "Episode", UserData: { IsFavorite: true } })).toBe(true);
    expect(showsFavoriteHeart({ Type: "Audio", UserData: { IsFavorite: true } })).toBe(true);
    expect(showsFavoriteHeart({ Type: "Folder", UserData: { IsFavorite: true } })).toBe(true);
  });

  it("does not hold for an item that is not a favorite, or that carries no user data", () => {
    expect(showsFavoriteHeart({ Type: "Movie", UserData: { IsFavorite: false } })).toBe(false);
    expect(showsFavoriteHeart({ Type: "Folder", UserData: null })).toBe(false);
    expect(showsFavoriteHeart({})).toBe(false);
  });

  it("leaves channels and programmes to their own marks", () => {
    expect(showsFavoriteHeart({ Type: "TvChannel", UserData: { IsFavorite: true } })).toBe(false);
    expect(showsFavoriteHeart({ Type: "Program", UserData: { IsFavorite: true } })).toBe(false);
  });
});
