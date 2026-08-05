/**
 * Tests for next-up resolution behind the Continue Watching row.
 *
 * The row's own list only holds partially-watched items, so a finished episode takes its
 * whole container off the row. These cases pin the recovery: anchor on the most recently
 * finished item per container, offer the next unwatched sibling, and never duplicate or
 * outlive what the resume list already shows.
 */
import { clearPlayedCache, markPlayed } from "../playedCache";
import { clearNextUpDismissals, containerKey, dismissNextUpContainer, resolveNextUp } from "../nextUp";

jest.mock("../jellyfinApi", () => ({
  fetchRecentlyPlayed: jest.fn(),
  fetchRecursiveVideos: jest.fn(),
}));

const { fetchRecentlyPlayed, fetchRecursiveVideos } = require("../jellyfinApi") as {
  fetchRecentlyPlayed: jest.Mock;
  fetchRecursiveVideos: jest.Mock;
};

type ItemOverrides = {
  SeriesId?: string;
  ParentId?: string;
  Played?: boolean;
  PositionTicks?: number;
};

function item(id: string, { SeriesId, ParentId, Played, PositionTicks }: ItemOverrides = {}) {
  return {
    Id: id,
    Name: `Item ${id}`,
    Type: "Episode",
    Path: `/media/${id}.mkv`,
    RunTimeTicks: 10_000_000_000,
    ...(SeriesId ? { SeriesId } : {}),
    ...(ParentId ? { ParentId } : {}),
    UserData: { Played: !!Played, PlaybackPositionTicks: PositionTicks ?? 0 },
  } as any;
}

describe("next-up resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearNextUpDismissals();
    clearPlayedCache();
  });

  describe("containerKey", () => {
    it("prefers SeriesId so a queue spans the series, not just the season folder", () => {
      expect(containerKey(item("e1", { SeriesId: "series-1", ParentId: "season-1" }))).toBe("series-1");
    });

    it("falls back to ParentId — homevideos episodes arrive as Type Video with no SeriesId", () => {
      expect(containerKey(item("v1", { ParentId: "folder-1" }))).toBe("folder-1");
    });

    it("is undefined when the server gave no parent at all", () => {
      expect(containerKey(item("v1"))).toBeUndefined();
    });
  });

  it("returns nothing when the recently-played fetch fails", async () => {
    fetchRecentlyPlayed.mockResolvedValue(null);

    await expect(resolveNextUp([])).resolves.toEqual([]);
    expect(fetchRecursiveVideos).not.toHaveBeenCalled();
  });

  it("returns nothing when nothing has ever been finished", async () => {
    fetchRecentlyPlayed.mockResolvedValue([]);

    await expect(resolveNextUp([])).resolves.toEqual([]);
  });

  it("offers the next unwatched sibling after the finished item", async () => {
    fetchRecentlyPlayed.mockResolvedValue([item("e2", { SeriesId: "series-1", Played: true })]);
    fetchRecursiveVideos.mockResolvedValue([
      item("e1", { SeriesId: "series-1", Played: true }),
      item("e2", { SeriesId: "series-1", Played: true }),
      item("e3", { SeriesId: "series-1" }),
      item("e4", { SeriesId: "series-1" }),
    ]);

    const resolved = await resolveNextUp([]);

    expect(fetchRecursiveVideos).toHaveBeenCalledWith("series-1");
    expect(resolved.map((v) => v.Id)).toEqual(["e3"]);
  });

  it("works the same for a folder container with no SeriesId", async () => {
    fetchRecentlyPlayed.mockResolvedValue([item("v1", { ParentId: "folder-1", Played: true })]);
    fetchRecursiveVideos.mockResolvedValue([item("v1", { ParentId: "folder-1", Played: true }), item("v2", { ParentId: "folder-1" })]);

    const resolved = await resolveNextUp([]);

    expect(fetchRecursiveVideos).toHaveBeenCalledWith("folder-1");
    expect(resolved.map((v) => v.Id)).toEqual(["v2"]);
  });

  it("skips siblings that are already played or already resumable", async () => {
    fetchRecentlyPlayed.mockResolvedValue([item("e1", { SeriesId: "series-1", Played: true })]);
    fetchRecursiveVideos.mockResolvedValue([
      item("e1", { SeriesId: "series-1", Played: true }),
      item("e2", { SeriesId: "series-1", Played: true }),
      // Mid-watch: the resume list owns this card, a duplicate here would double it up
      item("e3", { SeriesId: "series-1", PositionTicks: 500 }),
      item("e4", { SeriesId: "series-1" }),
    ]);

    const resolved = await resolveNextUp([]);

    expect(resolved.map((v) => v.Id)).toEqual(["e4"]);
  });

  it("respects a played state set this session but not yet reflected in the cached list", async () => {
    fetchRecentlyPlayed.mockResolvedValue([item("e1", { SeriesId: "series-1", Played: true })]);
    fetchRecursiveVideos.mockResolvedValue([item("e1", { SeriesId: "series-1", Played: true }), item("e2", { SeriesId: "series-1" }), item("e3", { SeriesId: "series-1" })]);
    markPlayed("e2", true);

    const resolved = await resolveNextUp([]);

    expect(resolved.map((v) => v.Id)).toEqual(["e3"]);
  });

  it("offers nothing once the container is finished", async () => {
    fetchRecentlyPlayed.mockResolvedValue([item("e2", { SeriesId: "series-1", Played: true })]);
    fetchRecursiveVideos.mockResolvedValue([item("e1", { SeriesId: "series-1", Played: true }), item("e2", { SeriesId: "series-1", Played: true })]);

    await expect(resolveNextUp([])).resolves.toEqual([]);
  });

  it("offers nothing when the anchor is no longer in the container", async () => {
    fetchRecentlyPlayed.mockResolvedValue([item("gone", { SeriesId: "series-1", Played: true })]);
    fetchRecursiveVideos.mockResolvedValue([item("e1", { SeriesId: "series-1" })]);

    await expect(resolveNextUp([])).resolves.toEqual([]);
  });

  it("leaves a container alone when the resume list already shows one of its items", async () => {
    fetchRecentlyPlayed.mockResolvedValue([item("e1", { SeriesId: "series-1", Played: true })]);

    const resolved = await resolveNextUp([item("e2", { SeriesId: "series-1", PositionTicks: 900 })]);

    expect(resolved).toEqual([]);
    expect(fetchRecursiveVideos).not.toHaveBeenCalled();
  });

  it("anchors on the newest finished item per container and keeps server recency order", async () => {
    fetchRecentlyPlayed.mockResolvedValue([
      item("b2", { SeriesId: "series-b", Played: true }),
      item("a3", { SeriesId: "series-a", Played: true }),
      // Older anchor for a container already anchored above — must not resolve twice
      item("b1", { SeriesId: "series-b", Played: true }),
    ]);
    fetchRecursiveVideos.mockImplementation(async (containerId: string) =>
      containerId === "series-b"
        ? [item("b1", { SeriesId: "series-b", Played: true }), item("b2", { SeriesId: "series-b", Played: true }), item("b3", { SeriesId: "series-b" })]
        : [item("a3", { SeriesId: "series-a", Played: true }), item("a4", { SeriesId: "series-a" })],
    );

    const resolved = await resolveNextUp([]);

    expect(resolved.map((v) => v.Id)).toEqual(["b3", "a4"]);
    expect(fetchRecursiveVideos).toHaveBeenCalledTimes(2);
  });

  it("caps the containers it resolves so the row never fans out unbounded", async () => {
    fetchRecentlyPlayed.mockResolvedValue([1, 2, 3, 4, 5, 6].map((n) => item(`x${n}`, { SeriesId: `series-${n}`, Played: true })));
    fetchRecursiveVideos.mockImplementation(async (containerId: string) => {
      const n = containerId.split("-")[1];
      return [item(`x${n}`, { SeriesId: containerId, Played: true }), item(`y${n}`, { SeriesId: containerId })];
    });

    const resolved = await resolveNextUp([], 2);

    expect(resolved.map((v) => v.Id)).toEqual(["y1", "y2"]);
    expect(fetchRecursiveVideos).toHaveBeenCalledTimes(2);
  });

  it("keeps the other containers when one of them fails to load", async () => {
    fetchRecentlyPlayed.mockResolvedValue([item("a1", { SeriesId: "series-a", Played: true }), item("b1", { SeriesId: "series-b", Played: true })]);
    fetchRecursiveVideos.mockImplementation(async (containerId: string) => {
      if (containerId === "series-a") throw new Error("Request timed out fetching recursive videos.");
      return [item("b1", { SeriesId: "series-b", Played: true }), item("b2", { SeriesId: "series-b" })];
    });

    const resolved = await resolveNextUp([]);

    expect(resolved.map((v) => v.Id)).toEqual(["b2"]);
  });

  describe("dismissal", () => {
    beforeEach(() => {
      fetchRecentlyPlayed.mockResolvedValue([item("e1", { SeriesId: "series-1", Played: true })]);
      fetchRecursiveVideos.mockResolvedValue([item("e1", { SeriesId: "series-1", Played: true }), item("e2", { SeriesId: "series-1" })]);
    });

    it("suppresses a dismissed container for the rest of the session", async () => {
      await expect(resolveNextUp([])).resolves.toHaveLength(1);

      dismissNextUpContainer("series-1");

      await expect(resolveNextUp([])).resolves.toEqual([]);
    });

    it("brings it back once the dismissals are cleared", async () => {
      dismissNextUpContainer("series-1");
      clearNextUpDismissals();

      await expect(resolveNextUp([])).resolves.toHaveLength(1);
    });
  });
});
