/** A channel whose open failed or timed out is left out of the ring and the sampler for this long: a dead origin can hang the server's probe. */
const OPEN_FAILURE_TTL_MS = 10 * 60_000;
const openFailedAt = new Map<string, number>();

export function noteOpenFailed(channelId: string): void {
  openFailedAt.set(channelId, Date.now());
}

export function openRecentlyFailed(channelId: string): boolean {
  const at = openFailedAt.get(channelId);
  if (at === undefined) return false;
  if (Date.now() - at < OPEN_FAILURE_TTL_MS) return true;
  openFailedAt.delete(channelId);
  return false;
}

/** A successful open clears the channel's failure. */
export function clearOpenFailure(channelId: string): void {
  openFailedAt.delete(channelId);
}
