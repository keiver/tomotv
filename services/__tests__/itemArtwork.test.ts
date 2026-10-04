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

import { folderPosterSource, heroArtFrame, posterSource, posterUri, wantsPosterFrame } from "../itemArtwork";
import { updateUiPreferences } from "@/services/uiPreferences";

const item = (extra: Record<string, unknown> = {}) => ({ Id: "a", Type: "Movie", RunTimeTicks: 0, ...extra });

beforeEach(() => updateUiPreferences({ devicePosters: true }));

describe("with device generated posters off", () => {
  beforeEach(() => updateUiPreferences({ devicePosters: false }));

  it("never asks for a keyframe and never shows a settled one", () => {
    mockCached.mockReturnValue("file:///pool/a/poster.jpg");
    expect(wantsPosterFrame({ Type: "Movie" })).toBe(false);
    expect(posterSource(item(), 300)).toBeUndefined();
    expect(posterSource(item(), 300, "file:///pool/a/poster.jpg")).toBeUndefined();
  });

  it("still takes the server poster", () => {
    expect(posterSource(item({ ImageTags: { Primary: "tag1" } }), 300)?.uri).toBe("https://jf/Items/a/Images/Primary?maxHeight=300");
  });
});

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

  it("draws a programme without art with its channel's picture, never a keyframe", () => {
    mockCached.mockReturnValue("file:///pool/p/poster.jpg");
    expect(posterSource(item({ Id: "p", Type: "Program", ChannelId: "ch1" }), 300)?.uri).toBe("https://jf/Items/ch1/Images/Primary?maxHeight=300");
    expect(wantsPosterFrame({ Type: "Program" })).toBe(false);
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

describe("heroArtFrame", () => {
  // The area is fixed by the hero's width, never by the picture, so a late picture moves nothing.
  it("fills the fixed area with a 16:9 backdrop", () => {
    const backdrop = heroArtFrame(1100, 618.75, 1920, 1080);
    expect(backdrop.width).toBe(1100);
    expect(backdrop.height).toBeCloseTo(618.75);
  });

  // The foot sits under the fade and the content, as a poster page does.
  it("draws a portrait or square picture full width, taller than the area", () => {
    expect(heroArtFrame(1100, 618.75, 400, 600)).toEqual({ width: 1100, height: 1650 });
    expect(heroArtFrame(1100, 618.75, 1000, 1000)).toEqual({ width: 1100, height: 1100 });
  });

  // Sintel's programme still is 640x272: drawn full width it leaves a band over its top.
  it("covers the area with a picture wider than 16:9, its sides cropped", () => {
    const still = heroArtFrame(1100, 618.75, 640, 272);
    expect(still.height).toBe(618.75);
    expect(still.width).toBeCloseTo(1455.88);
    expect(heroArtFrame(1100, 618.75, 4000, 1000)).toEqual({ width: 2475, height: 618.75 });
  });

  it("keeps a wide logo whole, full width and shorter than the area", () => {
    expect(heroArtFrame(1100, 618.75, 4000, 1000, true)).toEqual({ width: 1100, height: 275 });
    expect(heroArtFrame(1100, 618.75, 503, 125, true).width).toBe(1100);
  });

  // .black (576p)'s logo is 68x16: drawn full width it is a 16x blow-up.
  it("stops a tiny landscape picture at 3x its own size", () => {
    expect(heroArtFrame(1100, 618.75, 68, 16)).toEqual({ width: 204, height: 48 });
  });

  // A 940pt-wide backdrop on the TV card, a 533pt one on a landscape phone: full width, never boxed.
  it("draws a landscape picture a little narrower than the hero full width", () => {
    expect(heroArtFrame(1100, 618.75, 940, 627).width).toBe(1100);
    expect(heroArtFrame(852, 165, 533, 300).width).toBe(852);
  });
});

describe("wantsPosterFrame", () => {
  const video = [{ Codec: "hevc", Type: "Video" }];
  const audio = [{ Codec: "flac", Type: "Audio" }];

  it("asks for a keyframe for a video the server left without a poster", () => {
    expect(wantsPosterFrame({ Type: "Movie", MediaStreams: video })).toBe(true);
    expect(wantsPosterFrame({ Type: "Episode", MediaStreams: video })).toBe(true);
    expect(wantsPosterFrame({ Type: "MusicVideo", MediaStreams: video })).toBe(true);
    expect(wantsPosterFrame({ Type: "Recording" })).toBe(true);
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
