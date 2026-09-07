/**
 * Codec registry shared by jellyfinApi (isCodecSupported) and the on-device remux
 * engine (services/localRemux). Lives in constants/ so both can import it without
 * a services-level require cycle.
 */

/**
 * Video codecs AVPlayer decodes natively, so the remuxer can stream-copy them.
 * The single direct-play registry: jellyfinApi's isCodecSupported prefix-matches
 * against this list instead of keeping a second hand-written one.
 */
export const REMUXABLE_CODECS = ["h264", "avc", "hevc", "h265", "hvc1", "hev1"];

/**
 * What this device's VideoToolbox opens, measured by the engine (DeviceDecode.swift).
 * H.264 is not listed: every Apple device decodes it.
 */
export type VideoDecodeSupport = { hevc: boolean; hevcMain10: boolean; av1: boolean };
