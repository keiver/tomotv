/**
 * The focused channel card playing live: one engine session read without a server open, shown through the shared
 * preview player (modules/live-clip), and adopted by the player when the card is played. A channel only a server
 * open reads keeps its recorded clip; nothing here ever opens a server stream.
 */
import { resolveChannelWithoutOpen } from "@/services/jellyfinApi";
import { canRemuxLocally, localRemuxToken, setLiveSessionPriority, setLiveWindow, startLocalRemux, stopLocalRemux, subscribeEngineFailure, subscribeEngineThroughput } from "@/services/localRemux";
import type { RingSession } from "@/services/liveRing";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";

/** The preview's window until a player adopts it; disk, not playback, is what it bounds. */
const PREVIEW_WINDOW_SECONDS = 20;
const PLAYING_WINDOW_SECONDS = 300;
/** A preview left for no other channel stays this long, so the player opening from it can take it over. */
const HANDOFF_GRACE_MS = 5_000;
const READY_SEGMENTS = 2;

interface Preview {
  channelId: string;
  details: JellyfinVideoItem;
  url: string;
  token: string;
  segmentsCut: number;
  /** What the card shows, made once so a store read returns the same object until it changes. */
  clip?: { uri: string; cacheKey: string };
  unsubscribe: () => void;
}

let wanted: string | null = null;
let current: Preview | null = null;
let generation = 0;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Map<string, Set<() => void>>();

function notify(channelId: string): void {
  for (const listener of listeners.get(channelId) ?? []) listener();
}

function end(preview: Preview, why: string): void {
  if (current === preview) current = null;
  preview.unsubscribe();
  void stopLocalRemux(preview.token);
  notify(preview.channelId);
  logger.debug("Live preview ended", { service: "LivePreview", channel: preview.details.Name, why });
}

function clearGrace(): void {
  if (graceTimer) clearTimeout(graceTimer);
  graceTimer = null;
}

async function start(channelId: string, mine: number): Promise<void> {
  let token: string | null = null;
  try {
    const details = await resolveChannelWithoutOpen(channelId);
    if (mine !== generation || !details?.liveStreamUrl || !(await canRemuxLocally(details, { record: false }))) return;
    const url = await startLocalRemux(details, undefined, undefined, { prewarm: true, liveWindowSeconds: PREVIEW_WINDOW_SECONDS, livePriority: "preview" });
    token = localRemuxToken(url);
    if (!token || mine !== generation) {
      void stopLocalRemux(token);
      return;
    }
    const held = token;
    const preview: Preview = { channelId, details, url, token: held, segmentsCut: 0, unsubscribe: () => {} };
    const stopThroughput = subscribeEngineThroughput(held, () => {
      preview.segmentsCut += 1;
      if (preview.segmentsCut === 1) {
        preview.clip = { uri: preview.url, cacheKey: `live-preview-${held}` };
        notify(channelId);
      }
    });
    const stopFailure = subscribeEngineFailure(held, (failure) => {
      if (current === preview) end(preview, failure.message);
    });
    preview.unsubscribe = () => {
      stopThroughput();
      stopFailure();
    };
    current = preview;
  } catch (error) {
    void stopLocalRemux(token);
    logger.debug("Live preview did not start", { service: "LivePreview", channelId, error: String(error) });
  }
}

/**
 * The card focused past its dwell names its channel; null when focus leaves the cards. Another channel ends the
 * running preview at once (it holds a provider connection); leaving the cards gives the player a moment to adopt it.
 */
export function showLivePreview(channelId: string | null): void {
  if (wanted === channelId) return;
  wanted = channelId;
  generation += 1;
  clearGrace();
  const running = current;
  if (running && running.channelId !== channelId) {
    if (channelId === null) {
      graceTimer = setTimeout(() => {
        graceTimer = null;
        if (current === running && wanted === null) end(running, "focus left");
      }, HANDOFF_GRACE_MS);
    } else {
      end(running, "focus moved");
    }
  }
  if (channelId && current?.channelId !== channelId) void start(channelId, generation);
}

/** The app going to the background lets every connection go now, no grace. */
export function stopLivePreview(): void {
  wanted = null;
  generation += 1;
  clearGrace();
  if (current) end(current, "stopped");
}

/** The live preview for a card once it has cut a segment, as the shared player takes it. */
export function livePreviewFor(channelId: string): { uri: string; cacheKey: string } | undefined {
  return current?.channelId === channelId ? current.clip : undefined;
}

export function subscribeLivePreview(channelId: string, listener: () => void): () => void {
  let set = listeners.get(channelId);
  if (!set) {
    set = new Set();
    listeners.set(channelId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(channelId);
  };
}

/** The player takes the card's preview session instead of opening the channel again; null when there is none. */
export function takeLivePreview(channelId: string): RingSession | null {
  const preview = current;
  if (!preview || preview.channelId !== channelId) return null;
  current = null;
  wanted = null;
  clearGrace();
  preview.unsubscribe();
  void setLiveWindow(preview.token, PLAYING_WINDOW_SECONDS);
  void setLiveSessionPriority(preview.token, "playback");
  notify(channelId);
  logger.info("Live preview adopted by the player", { service: "LivePreview", channel: preview.details.Name, segments: preview.segmentsCut });
  return { channelId, details: preview.details, url: preview.url, token: preview.token, ready: preview.segmentsCut >= READY_SEGMENTS };
}
