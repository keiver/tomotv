import { channelMarks, indexBadgeSegments } from "@/components/video-grid-item";
import { COLORS } from "@/constants/colors";
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

  it("marks an audiobook the server holds finished", () => {
    expect(indexBadgeSegments(item({ Type: "AudioBook", UserData: { Played: true } }))).toEqual([{ icon: "eye" }]);
    expect(indexBadgeSegments(item({ Type: "AudioBook", UserData: { Played: false } }))).toBeNull();
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

describe("channelMarks", () => {
  const channel = (ChannelNumber?: string) => item({ Type: "TvChannel", Name: "Caminandes", ChannelNumber });

  it("gives the tuner's number to the gold pill and the favorite heart to the marks", () => {
    expect(channelMarks(channel(" 3 "), "heart")).toEqual({ number: "3", trailing: [{ icon: "heart", color: COLORS.ACCENT }] });
  });

  it("shows only what the channel has: no number and no favorite means no marks", () => {
    expect(channelMarks(channel())).toEqual({ number: undefined, trailing: [] });
    expect(channelMarks(channel("  "), "heart")).toEqual({ number: undefined, trailing: [{ icon: "heart", color: COLORS.ACCENT }] });
  });

  it("marks nothing but a channel", () => {
    expect(channelMarks(item({ Type: "Movie", ChannelNumber: "2" }), "heart")).toEqual({ trailing: [] });
  });
});
