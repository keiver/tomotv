/**
 * Tests for the one picture rule: the server poster first, the engine's keyframe second,
 * nothing otherwise, with cache keys that survive a token change and follow the image tag.
 */
const mockCached = jest.fn((_id: string): string | null | undefined => undefined);

jest.mock("@/services/jellyfinApi", () => ({
  hasPoster: (item: { ImageTags?: { Primary?: string } }) => item.ImageTags?.Primary !== undefined,
  getPosterUrl: (id: string, height: number) => `https://jf/Items/${id}/Images/Primary?maxHeight=${height}`,
}));
jest.mock("@/services/localRemux", () => ({ posterFrameIfCached: (id: string) => mockCached(id) }));

import { posterSource, posterUri } from "../itemArtwork";

const item = (extra: Record<string, unknown> = {}) => ({ Id: "a", Type: "Movie", RunTimeTicks: 0, ...extra });

describe("posterSource", () => {
  beforeEach(() => mockCached.mockReturnValue(undefined));

  it("takes the server poster first, keyed by item, tag and size", () => {
    mockCached.mockReturnValue("file:///pool/a/poster.jpg");
    expect(posterSource(item({ ImageTags: { Primary: "tag1" } }), 300)).toEqual({ uri: "https://jf/Items/a/Images/Primary?maxHeight=300", cacheKey: "a-tag1-300" });
  });

  it("falls back to the keyframe the engine has settled", () => {
    mockCached.mockReturnValue("file:///pool/a/poster.jpg");
    expect(posterSource(item(), 300)).toEqual({ uri: "file:///pool/a/poster.jpg", cacheKey: "a-keyframe" });
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
