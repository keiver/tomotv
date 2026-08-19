/**
 * slipstreamEligible — the JS gate deciding whether a session gets a
 * Slipstream tier (SDR video with audio; HDR keeps Layer 4, video-only
 * variants need the audio group).
 */

import { slipstreamEligible } from "../localRemux";
import type { JellyfinVideoItem } from "@/types/jellyfin";

jest.mock("@/services/jellyfinApi", () => ({
  generatePlaySessionId: jest.fn(() => "test"),
  getVideoStreamUrl: jest.fn(() => ""),
  getSubtitleUrl: jest.fn(() => ""),
  isImageBasedSubtitleCodec: jest.fn(() => false),
  JELLYFIN_TIME: { TICKS_PER_SECOND: 10_000_000 },
}));
jest.mock("@/services/jellyfin/streamUrls", () => ({ getTierPlaylistUrl: jest.fn(() => "") }));

const item = (streams: { Type: string; VideoRangeType?: string }[]): JellyfinVideoItem => ({ Id: "x", Name: "x", MediaStreams: streams }) as unknown as JellyfinVideoItem;

describe("slipstreamEligible", () => {
  it("accepts SDR video with audio", () => {
    expect(slipstreamEligible(item([{ Type: "Video", VideoRangeType: "SDR" }, { Type: "Audio" }]))).toBe(true);
  });

  it("rejects every HDR range (VIDEO-RANGE must not mix across variants)", () => {
    for (const range of ["HDR10", "HDR10+", "DOVI", "PQ", "HLG"]) {
      expect(slipstreamEligible(item([{ Type: "Video", VideoRangeType: range }, { Type: "Audio" }]))).toBe(false);
    }
  });

  it("rejects audio-less and video-less items", () => {
    expect(slipstreamEligible(item([{ Type: "Video", VideoRangeType: "SDR" }]))).toBe(false);
    expect(slipstreamEligible(item([{ Type: "Audio" }]))).toBe(false);
  });

  it("treats a missing range as SDR", () => {
    expect(slipstreamEligible(item([{ Type: "Video" }, { Type: "Audio" }]))).toBe(true);
  });
});
