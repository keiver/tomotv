/**
 * Where the engine reads a raw MPEG-TS channel with no server open: its own origin, when the server allows
 * direct play and this device reaches the host. Anything else is opened on the server (liveTv.ts openChannel).
 */
import { isOriginLaneAvailable, mergeOriginHeaders, originKeyOf, originReach, resetOriginReach, splitPipeHeaders } from "@keiver/tomo-live";
import type { JellyfinMediaSource } from "@/types/jellyfin";

export type { OriginReach } from "@keiver/tomo-engine";
export { isOriginLaneAvailable, originKeyOf, splitPipeHeaders };

export interface RawLiveInput {
  url: string;
  headers?: Record<string, string>;
  /** The provider whose connections the read counts against; the engine learns each provider's limit from its refusals. */
  originKey: string;
}

/**
 * The input for a raw TS channel, or null when the server must open it: a manifest, a non-HTTP tuner (HDHomeRun
 * answers Udp), a tuner whose stream limit or looping turns direct play off (M3UTunerHost.cs `supportsDirectPlay`),
 * or an origin this device does not reach.
 */
export async function rawLiveInput(source: JellyfinMediaSource): Promise<RawLiveInput | null> {
  if (!isOriginLaneAvailable() || !source.Path || !/^https?$/i.test(source.Protocol ?? "") || source.SupportsDirectPlay !== true) return null;
  const { url, headers: own } = splitPipeHeaders(source.Path);
  if (!/^https?:\/\//i.test(url) || /\.(?:m3u8?|mpd)(?:$|\?)/i.test(url)) return null;
  if ((await originReach(url)) !== "reachable") return null;
  return { url, headers: mergeOriginHeaders(source.RequiredHttpHeaders, own), originKey: originKeyOf(url) };
}

/** Channel hosts repeat across servers and networks: a switch forgets every reach. */
export function resetLiveInput(): void {
  resetOriginReach();
}
