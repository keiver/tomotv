import { channelNumber, indexBadgeSegments, isWatched, joinTitle, programCardTitle } from "@/components/video-grid-item";
import type { JellyfinVideoItem } from "@/types/jellyfin";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));

const item = (overrides: Partial<JellyfinVideoItem>): JellyfinVideoItem => ({ Id: "v1", Name: "Item", Type: "Movie", ...overrides }) as JellyfinVideoItem;

describe("indexBadgeSegments", () => {
  it("holds no watched mark: a played movie wears no badge", () => {
    expect(indexBadgeSegments(item({ UserData: { Played: true } }))).toBeNull();
    expect(indexBadgeSegments(item({}))).toBeNull();
  });

  it("keeps the index tag alone on a played episode", () => {
    const episode = item({ Type: "Episode", ParentIndexNumber: 1, IndexNumber: 5, UserData: { Played: true } });
    expect(indexBadgeSegments(episode)).toEqual([{ label: "S01E05" }]);
  });

  it("leaves an unplayed episode's tag unchanged", () => {
    expect(indexBadgeSegments(item({ Type: "Episode", ParentIndexNumber: 1, IndexNumber: 5 }))).toEqual([{ label: "S01E05" }]);
  });

  it("never marks music tracks or live cards", () => {
    const track = item({ Type: "Audio", IndexNumber: 5, UserData: { Played: true } });
    expect(indexBadgeSegments(track)).toEqual([{ icon: "musical-note", label: 5 }]);
    const channel = item({ Type: "TvChannel", UserData: { Played: true } });
    expect(indexBadgeSegments(channel)).toBeNull();
  });

  it("gives a channel no pill: its mark is the freshness badge", () => {
    const channel = item({ Type: "TvChannel", CurrentProgram: { Name: "On Air" } as JellyfinVideoItem["CurrentProgram"] });
    expect(indexBadgeSegments(channel)).toBeNull();
    expect(indexBadgeSegments(item({ Type: "TvChannel" }))).toBeNull();
  });

  it("marks a searched programme live only while it airs", () => {
    const now = Date.UTC(2026, 8, 29, 20, 0);
    const program = (startMin: number, endMin: number) => item({ Type: "Program", StartDate: new Date(now + startMin * 60_000).toISOString(), EndDate: new Date(now + endMin * 60_000).toISOString() });
    expect(indexBadgeSegments(program(-30, 30), now)).toEqual([{ label: "LIVE" }]);
    expect(indexBadgeSegments(program(-60, -1), now)).toBeNull();
    expect(indexBadgeSegments(program(30, 90), now)?.[0].label).not.toBe("LIVE");
  });

  it("a recording programme wears REC while it airs and the camera before its start", () => {
    const now = Date.UTC(2026, 8, 29, 20, 0);
    const program = (startMin: number, endMin: number) => item({ Type: "Program", StartDate: new Date(now + startMin * 60_000).toISOString(), EndDate: new Date(now + endMin * 60_000).toISOString() });
    expect(indexBadgeSegments(program(-30, 30), now, true)).toEqual([{ label: "REC" }]);
    const scheduled = indexBadgeSegments(program(30, 90), now, true);
    expect(scheduled).toEqual([{ icon: "videocam", label: indexBadgeSegments(program(30, 90), now)?.[0].label }]);
  });
});

describe("isWatched", () => {
  it("holds for played movies, episodes and finished audiobooks", () => {
    expect(isWatched(item({ UserData: { Played: true } }))).toBe(true);
    expect(isWatched(item({ Type: "Episode", UserData: { Played: true } }))).toBe(true);
    expect(isWatched(item({ Type: "AudioBook", UserData: { Played: true } }))).toBe(true);
    expect(isWatched(item({ Type: "AudioBook", UserData: { Played: false } }))).toBe(false);
    expect(isWatched(item({}))).toBe(false);
  });

  it("never holds for music tracks or live cards", () => {
    expect(isWatched(item({ Type: "Audio", UserData: { Played: true } }))).toBe(false);
    expect(isWatched(item({ Type: "TvChannel", UserData: { Played: true } }))).toBe(false);
    expect(isWatched(item({ Type: "Program", UserData: { Played: true } }))).toBe(false);
  });
});

describe("channelNumber", () => {
  const channel = (ChannelNumber?: string) => item({ Type: "TvChannel", Name: "Caminandes", ChannelNumber });

  it("labels the tuner's number as a channel", () => {
    expect(channelNumber(channel(" 3 "))).toBe("CH 3");
  });

  it("gives no pill without a number", () => {
    expect(channelNumber(channel())).toBeUndefined();
    expect(channelNumber(channel("  "))).toBeUndefined();
  });

  it("marks nothing but a channel", () => {
    expect(channelNumber(item({ Type: "Movie", ChannelNumber: "2" }))).toBeUndefined();
  });
});

describe("programCardTitle", () => {
  it("names the episode after the show", () => {
    expect(programCardTitle(item({ Type: "Program", Name: "Show", EpisodeTitle: "Pilot", ChannelName: "Show" }))).toBe("Show - Pilot");
  });

  it("falls back to the channel without an episode title", () => {
    expect(programCardTitle(item({ Type: "Program", Name: "Show", ChannelName: "Channel 4" }))).toBe("Show - Channel 4");
  });

  it("never repeats the show name", () => {
    expect(programCardTitle(item({ Type: "Program", Name: "Show", ChannelName: "Show" }))).toBe("Show");
  });
});

describe("joinTitle", () => {
  it("names a channel once when its airing programme shares its name", () => {
    expect(joinTitle("Show", "Show")).toBe("Show");
    expect(joinTitle("News at Nine", "Channel 4")).toBe("News at Nine - Channel 4");
  });
});
