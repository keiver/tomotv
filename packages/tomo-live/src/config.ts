import type { ChannelOrigin } from "./channelOrigin";

/** How an app's channels reach the live services: resolution, opening, and the engine session it starts for an item. */
export interface LiveChannels<Item = unknown> {
  /** A playable item for the channel, opening it on the source when it must. */
  resolve(channelId: string, options: { quiet: true }): Promise<Item>;
  /** A playable item when the channel needs no open; null otherwise. */
  resolveWithoutOpen(channelId: string): Promise<Item | null>;
  /** The origin a frame grab reads; "untuned" when the source carries no tuner for it. */
  resolveOrigin(channelId: string): Promise<ChannelOrigin | "untuned" | null>;
  open(channelId: string, options: { quiet: true }): Promise<Item>;
  /** Releases whatever the source holds open for the item. */
  close(item: Item): Promise<void>;
  /** Whether the item holds an open on the source that `close` releases. */
  holdsOpen(item: Item): boolean;
  streamUrl(item: Item): string | undefined;
  name(item: Item): string;
  canPlayOnDevice(item: Item): Promise<boolean>;
  /** Starts an engine session for the item; resolves to its master playlist URL. */
  startSession(item: Item, options: { prewarm: true; liveWindowSeconds: number; livePriority?: "preview" }): Promise<string>;
  /** Fires when the channel list on screen changes, so grabs for the old list stop. */
  subscribeListChange(listener: () => void): () => void;
}

let channels: LiveChannels | null = null;

export function configureLive<Item>(next: { channels: LiveChannels<Item> }): void {
  channels = next.channels as unknown as LiveChannels;
}

export function liveChannels(): LiveChannels {
  if (!channels) throw new Error("configureLive has not been called.");
  return channels;
}
