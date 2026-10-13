import { channelFavoriteIcon, showsFavoriteHeart } from "@/components/card-badge";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

describe("channelFavoriteIcon", () => {
  it("is the heart for a channel on the device's favorites list", () => {
    expect(channelFavoriteIcon({ Type: "TvChannel" }, true)).toBe("heart");
  });

  it("is the heart for a channel the server marks favorite", () => {
    expect(channelFavoriteIcon({ Type: "TvChannel", UserData: { IsFavorite: true } }, false)).toBe("heart");
  });

  it("is nothing for a channel that is neither, and for any other kind", () => {
    expect(channelFavoriteIcon({ Type: "TvChannel", UserData: { IsFavorite: false } }, false)).toBeUndefined();
    expect(channelFavoriteIcon({ Type: "Movie", UserData: { IsFavorite: true } }, true)).toBeUndefined();
  });
});

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
