/**
 * Tests for the one picture rule: the server poster first, the engine's keyframe second,
 * nothing otherwise, with cache keys that survive a token change and follow the image tag.
 */
const mockCached = jest.fn((_id: string): string | null | undefined => undefined);
const mockGeneration = jest.fn(() => 0);
const mockRevision = jest.fn(() => 0);

const mockServer = jest.fn(() => "https://one.example");

jest.mock("@/services/jellyfinApi", () => ({
  hasPoster: (item: { ImageTags?: { Primary?: string } }) => item.ImageTags?.Primary !== undefined,
  getPosterUrl: (id: string, height: number) => `https://jf/Items/${id}/Images/Primary?maxHeight=${height}`,
  getCachedConfig: () => ({ server: mockServer(), apiKey: "", userId: "u", deviceId: "d" }),
}));
jest.mock("@/services/localRemux", () => ({ posterFrameIfCached: (id: string) => mockCached(id), posterFrameGeneration: () => mockGeneration(), posterFrameRevision: () => mockRevision() }));

import { folderPosterSource, posterSource, posterUri, wantsPosterFrame } from "../itemArtwork";

const item = (extra: Record<string, unknown> = {}) => ({ Id: "a", Type: "Movie", RunTimeTicks: 0, ...extra });

describe("posterSource", () => {
  beforeEach(() => {
    mockCached.mockReturnValue(undefined);
    mockGeneration.mockReturnValue(0);
    mockServer.mockReturnValue("https://one.example");
  });

  it("takes the server poster first, keyed by item, tag and size", () => {
    mockCached.mockReturnValue("file:///pool/a/poster.jpg");
    expect(posterSource(item({ ImageTags: { Primary: "tag1" } }), 300)).toEqual({
      uri: "https://jf/Items/a/Images/Primary?maxHeight=300",
      cacheKey: expect.stringMatching(/^[a-z0-9]+-a-tag1-300$/),
    });
  });

  it("falls back to the keyframe the engine has settled", () => {
    mockCached.mockReturnValue("file:///pool/a/poster.jpg");
    expect(posterSource(item(), 300)).toEqual({ uri: "file:///pool/a/poster.jpg", cacheKey: expect.stringMatching(/^[a-z0-9]+-a-keyframe-0\.0$/) });
  });

  it("keys a keyframe by the generation, so a cleared pool redraws instead of reusing the picture", () => {
    mockCached.mockReturnValue("file:///pool/a/poster.jpg");
    const before = posterSource(item(), 300)?.cacheKey;
    mockGeneration.mockReturnValue(1);
    expect(posterSource(item(), 300)?.cacheKey).not.toBe(before);
  });

  it("keys a picture by the server, so the same id on another server is another picture", () => {
    mockCached.mockReturnValue("file:///pool/a/poster.jpg");
    const onOne = posterSource(item(), 300)?.cacheKey;
    const serverPosterOnOne = posterSource(item({ ImageTags: { Primary: "tag1" } }), 300)?.cacheKey;
    mockServer.mockReturnValue("https://two.example");
    expect(posterSource(item(), 300)?.cacheKey).not.toBe(onOne);
    expect(posterSource(item({ ImageTags: { Primary: "tag1" } }), 300)?.cacheKey).not.toBe(serverPosterOnOne);
  });

  it("takes a keyframe the caller already holds over the settled one", () => {
    mockCached.mockReturnValue("file:///pool/a/old.jpg");
    expect(posterSource(item(), 300, "file:///pool/a/poster.jpg")?.uri).toBe("file:///pool/a/poster.jpg");
  });

  it("answers nothing when the server has no poster and the engine no frame", () => {
    expect(posterSource(item(), 300)).toBeUndefined();
    expect(posterUri(item(), 300)).toBeNull();
  });
});

describe("folderPosterSource", () => {
  it("takes the folder's own poster first", () => {
    expect(folderPosterSource({ Id: "s1", ImageTags: { Primary: "own" } }, 300)).toEqual({
      uri: "https://jf/Items/s1/Images/Primary?maxHeight=300",
      cacheKey: expect.stringMatching(/^[a-z0-9]+-s1-own-300$/),
    });
  });

  it("draws the series poster for a season without its own", () => {
    expect(folderPosterSource({ Id: "s1", SeriesId: "show", SeriesPrimaryImageTag: "series" }, 300)).toEqual({
      uri: "https://jf/Items/show/Images/Primary?maxHeight=300",
      cacheKey: expect.stringMatching(/^[a-z0-9]+-show-series-300$/),
    });
  });

  it("answers nothing when the server has no picture for the folder", () => {
    expect(folderPosterSource({ Id: "f1" }, 300)).toBeUndefined();
    expect(folderPosterSource({ Id: "f1", SeriesId: "show" }, 300)).toBeUndefined();
  });
});

describe("wantsPosterFrame", () => {
  const video = [{ Codec: "hevc", Type: "Video" }];
  const audio = [{ Codec: "flac", Type: "Audio" }];

  it("asks for a keyframe for a video the server left without a poster", () => {
    expect(wantsPosterFrame({ Type: "Movie", MediaStreams: video })).toBe(true);
    expect(wantsPosterFrame({ Type: "Episode", MediaStreams: video })).toBe(true);
    expect(wantsPosterFrame({ Type: "MusicVideo", MediaStreams: video })).toBe(true);
  });

  it("never asks when the server already has a poster", () => {
    expect(wantsPosterFrame({ Type: "Movie", ImageTags: { Primary: "tag" }, MediaStreams: video })).toBe(false);
  });

  it("never asks for a kind the engine does not open for a frame", () => {
    expect(wantsPosterFrame({ Type: "Audio", MediaStreams: audio })).toBe(false);
    expect(wantsPosterFrame({ Type: "Folder", MediaStreams: video })).toBe(false);
    expect(wantsPosterFrame({ Type: "Photo" })).toBe(false);
  });

  // A MusicVideo row that is really an audio file: opening it over HTTP only proves there is
  // no video stream, and the failure is retried POSTER_FRAME_ATTEMPTS times per launch.
  it("skips an item whose streams prove there is no video to grab", () => {
    expect(wantsPosterFrame({ Type: "MusicVideo", MediaStreams: audio })).toBe(false);
    expect(wantsPosterFrame({ Type: "Movie", MediaStreams: [...audio, { Codec: "subrip", Type: "Subtitle" }] })).toBe(false);
  });

  // Only positive proof excludes: a light fetch that carries no streams must keep asking,
  // or every surface that lists items without them loses its keyframes.
  it("still asks when the streams cannot answer", () => {
    expect(wantsPosterFrame({ Type: "Movie" })).toBe(true);
    expect(wantsPosterFrame({ Type: "Movie", MediaStreams: [] })).toBe(true);
  });
});
