/**
 * Which channel's column card holds TV focus, so the row's cell can wear the reel while the
 * viewer sits on the card. Tiny pub/sub, playbackHold-style; null between cards.
 */
let focusedId: string | null = null;
const listeners = new Set<() => void>();

export function setFocusedGuideChannel(channelId: string): void {
  if (focusedId === channelId) return;
  focusedId = channelId;
  for (const listener of listeners) listener();
}

/** Clears only if this channel still holds it, so a late blur never wipes the next card's focus. */
export function clearFocusedGuideChannel(channelId: string): void {
  if (focusedId !== channelId) return;
  focusedId = null;
  for (const listener of listeners) listener();
}

export function isGuideChannelFocused(channelId: string): boolean {
  return focusedId === channelId;
}

export function subscribeGuideChannelFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
