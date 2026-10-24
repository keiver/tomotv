import type { DimensionValue } from "react-native";

/** Crop-to-fill may cut this share off each side: EBU R95's action-safe margin, which broadcasters keep clear. */
export const LIVE_CROP_PER_SIDE = 0.035;

export interface PictureBox {
  position: "absolute";
  left: DimensionValue;
  top: DimensionValue;
  width: DimensionValue;
  height: DimensionValue;
}

/** Where a live picture sits in its card: null fills the card, a box shows it whole and centred. */
export function liveFrameBox(pictureAspect: number | undefined, slotAspect: number): PictureBox | null {
  if (!pictureAspect || !(pictureAspect > 0)) return null;
  const kept = Math.min(pictureAspect, slotAspect) / Math.max(pictureAspect, slotAspect);
  if ((1 - kept) / 2 <= LIVE_CROP_PER_SIDE) return null;
  const width = pictureAspect < slotAspect ? kept * 100 : 100;
  const height = pictureAspect < slotAspect ? 100 : kept * 100;
  return { position: "absolute", left: `${(100 - width) / 2}%`, top: `${(100 - height) / 2}%`, width: `${width}%`, height: `${height}%` };
}

const aspects = new Map<string, number>();

/** The shape a channel's last live picture loaded at, width over height. */
export function livePictureAspect(channelId: string): number | undefined {
  return aspects.get(channelId);
}

export function rememberLivePictureAspect(channelId: string, aspect: number): void {
  aspects.set(channelId, aspect);
}
