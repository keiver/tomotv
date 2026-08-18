/**
 * slipstreamEligible — the JS gate deciding whether a session gets a
 * Slipstream tier (SDR video with audio; HDR keeps Layer 4, video-only
 * variants need the audio group).
 */

jest.mock("@/services/jellyfinApi", () => ({
  generatePlaySessionId: jest.fn(() => "test"),
  getVideoStreamUrl: jest.fn(() => ""),
  getSubtitleUrl: jest.fn(() => ""),
  isImageBasedSubtitleCodec: jest.fn(() => false),
  JELLYFIN_TIME: { TICKS_PER_SECOND: 10_000_000 },
}));
jest.mock("@/services/jellyfin/streamUrls", () => ({ getTierPlaylistUrl: jest.fn(() => "") }));

import { slipstreamEligible } from "../localRemux";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const item = (streams: { Type: string; VideoRangeType?: string }[]): JellyfinVideoItem => ({ Id: "x", Name: "x", MediaStreams: streams }) as unknown as JellyfinVideoItem;

describe("slipstreamEligible", () => {
  it("accepts SDR video with audio when enabled", () => {
    expect(slipstreamEligible(item([{ Type: "Video", VideoRangeType: "SDR" }, { Type: "Audio" }]), true)).toBe(true);
  });

  it("rejects when disabled", () => {
    // Explicit false: the module default is a dev flag that flips during
    // bring-up, so the test pins the parameter, not the ship-state.
    expect(slipstreamEligible(item([{ Type: "Video", VideoRangeType: "SDR" }, { Type: "Audio" }]), false)).toBe(false);
  });

  it("rejects every HDR range (VIDEO-RANGE must not mix across variants)", () => {
    for (const range of ["HDR10", "HDR10+", "DOVI", "PQ", "HLG"]) {
      expect(slipstreamEligible(item([{ Type: "Video", VideoRangeType: range }, { Type: "Audio" }]), true)).toBe(false);
    }
  });

  it("rejects audio-less and video-less items", () => {
    expect(slipstreamEligible(item([{ Type: "Video", VideoRangeType: "SDR" }]), true)).toBe(false);
    expect(slipstreamEligible(item([{ Type: "Audio" }]), true)).toBe(false);
  });

  it("treats a missing range as SDR", () => {
    expect(slipstreamEligible(item([{ Type: "Video" }, { Type: "Audio" }]), true)).toBe(true);
  });
});
