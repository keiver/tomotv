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
