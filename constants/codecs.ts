/**
 * Codec registry shared by jellyfinApi (isCodecSupported) and the on-device remux
 * engine (services/localRemux). The engine package owns the lists; this re-export keeps
 * both importers off a services-level require cycle.
 */
export { REMUXABLE_CODECS, type VideoDecodeSupport } from "@keiver/tomo-engine";
