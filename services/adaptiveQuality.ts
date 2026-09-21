import { QUALITY_PRESETS, QualityMode } from "./jellyfin/constants";

/**
 * Live variant cap for a gateway (Slipstream) session, applied through RNV's
 * `maxBitRate` → AVPlayerItem.preferredPeakBitRate (verified live-applied,
 * RCTVideo.swift:1288). A pinned preset caps which variant AVPlayer may pick,
 * making pins seamless; Auto leaves the ladder free.
 */
export function gatewayMaxBitRate(quality: { mode: QualityMode; bitrate: number }): number | undefined {
  return quality.mode === "fixed" ? quality.bitrate : undefined;
}

export const FLOOR_INDEX = 0;
export const ORIGINAL_INDEX = QUALITY_PRESETS.length - 1;

export const BW_UP_TRUST = 0.7;

/**
 * Entry preset for a session. Original (stream copy, "no server work") is kept
 * whenever the measured link carries the SOURCE bitrate at 70% trust — its
 * preset bitrate is a 120Mbps sentinel no real file reaches, so the source's
 * own rate is the honest requirement. Otherwise the highest capped preset the
 * measurement supports.
 */
export function pickStartupIndex(measuredBps: number | null, ceilingIndex: number, sourceBitrateBps: number | null): number {
  const ceiling = Math.min(Math.max(ceilingIndex, FLOOR_INDEX), ORIGINAL_INDEX);
  if (measuredBps == null) return FLOOR_INDEX;
  const usable = measuredBps * BW_UP_TRUST;
  if (ceiling === ORIGINAL_INDEX && sourceBitrateBps != null && usable >= sourceBitrateBps) return ORIGINAL_INDEX;
  let best = FLOOR_INDEX;
  for (let presetIndex = Math.min(ceiling, ORIGINAL_INDEX - 1); presetIndex >= FLOOR_INDEX; presetIndex--) {
    if (QUALITY_PRESETS[presetIndex].bitrate <= usable) {
      best = presetIndex;
      break;
    }
  }
  return best;
}

/**
 * Whether the measured link carries a preset at up-switch trust. The settings
 * menu's capacity marks share the player's own rule, so they cannot disagree.
 */
export function linkCarriesPreset(measuredBps: number | null, presetIndex: number): boolean {
  return measuredBps != null && QUALITY_PRESETS[presetIndex].bitrate <= measuredBps * BW_UP_TRUST;
}

/**
 * How many transcodable rungs the link clears, so the meter's lit count and the
 * Auto row's ceiling read one derivation. 0 means it carries none of them; the
 * Original sentinel is not a rung.
 */
export function carriedRungs(measuredBps: number | null): number {
  let count = 0;
  for (let presetIndex = 0; presetIndex < ORIGINAL_INDEX; presetIndex++) if (linkCarriesPreset(measuredBps, presetIndex)) count = presetIndex + 1;
  return count;
}

/**
 * Whole Mbps a preset needs before linkCarriesPreset clears it, for the settings
 * rows to state. Rounded up, so the figure shown never sits under the gate.
 */
export function presetNeedsMbps(presetIndex: number): number {
  return Math.ceil(QUALITY_PRESETS[presetIndex].bitrate / BW_UP_TRUST / 1_000_000);
}
