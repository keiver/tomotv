import { nowPlayingVideoRoute } from "@/hooks/useNowPlaying";

jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: jest.fn() }));
jest.mock("@/services/audioPlayerManager", () => ({ audioPlayerManager: {} }));
jest.mock("expo-router", () => ({ useRouter: jest.fn() }));

describe("nowPlayingVideoRoute", () => {
  it("reopens a playing channel as a live channel", () => {
    expect(nowPlayingVideoRoute({ Id: "ch1", Name: "News", Type: "TvChannel" })).toEqual({
      pathname: "/player",
      params: { videoId: "ch1", videoName: "News", adopt: "1", live: "1" },
    });
  });

  it("reopens a playing movie without the live flag", () => {
    expect(nowPlayingVideoRoute({ Id: "m1", Name: "Movie", Type: "Movie" })).toEqual({
      pathname: "/player",
      params: { videoId: "m1", videoName: "Movie", adopt: "1" },
    });
  });
});
