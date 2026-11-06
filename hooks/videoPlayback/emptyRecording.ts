/** A recording whose file holds a provider's refusal instead of video: the player names it at once, no lane can play it. */

/** The message the classifier reads as an empty recording. */
export const EMPTY_RECORDING_MESSAGE = "Recording has no video";

const TS_SYNC = 0x47;

/** An MPEG-TS source the server found no streams in: the only kind whose first bytes are worth reading. */
export function mayHoldNoVideo(details: { MediaSources?: { Container?: string | null; MediaStreams?: unknown[] | null }[] | null }): boolean {
  const source = details.MediaSources?.[0];
  return !!source && (source.Container ?? "").toLowerCase() === "ts" && (source.MediaStreams?.length ?? 0) === 0;
}

export function startsWithVideo(bytes: Uint8Array): boolean {
  return bytes[0] === TS_SYNC;
}

/** One MPEG-TS packet: a file smaller than this holds no video. */
const TS_PACKET_BYTES = 188;

/** From the file's first bytes, or from its size when they could not be read (no download permission). */
export function holdsNoVideo(details: { MediaSources?: { Size?: number | null }[] | null }, start: Uint8Array | null): boolean {
  if (start) return !startsWithVideo(start);
  const size = details.MediaSources?.[0]?.Size;
  return typeof size === "number" && size < TS_PACKET_BYTES;
}
