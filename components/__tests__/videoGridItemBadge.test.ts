import { indexBadgeSegments } from "@/components/video-grid-item";
import type { JellyfinVideoItem } from "@/types/jellyfin";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));

const item = (overrides: Partial<JellyfinVideoItem>): JellyfinVideoItem => ({ Id: "v1", Name: "Item", Type: "Movie", ...overrides }) as JellyfinVideoItem;

describe("indexBadgeSegments", () => {
  it("marks a played movie with the eye alone", () => {
    expect(indexBadgeSegments(item({ UserData: { Played: true } }))).toEqual([{ icon: "eye" }]);
    expect(indexBadgeSegments(item({}))).toBeNull();
  });

  it("keeps the index tag first on a played episode", () => {
    const episode = item({ Type: "Episode", ParentIndexNumber: 1, IndexNumber: 5, UserData: { Played: true } });
    expect(indexBadgeSegments(episode)).toEqual([{ label: "S01E05" }, { icon: "eye" }]);
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

  it("marks a searched programme live only while it airs", () => {
    const now = Date.UTC(2026, 8, 29, 20, 0);
    const program = (startMin: number, endMin: number) => item({ Type: "Program", StartDate: new Date(now + startMin * 60_000).toISOString(), EndDate: new Date(now + endMin * 60_000).toISOString() });
    expect(indexBadgeSegments(program(-30, 30), now)).toEqual([{ label: "LIVE" }]);
    expect(indexBadgeSegments(program(-60, -1), now)).toBeNull();
    expect(indexBadgeSegments(program(30, 90), now)?.[0].label).not.toBe("LIVE");
  });
});
