/**
 * audioQueuePlayer.ts
 *
 * Thin typed wrapper for the native audio queue player
 * (native/ios/AudioQueuePlayer). The module owns an AVQueuePlayer plus a
 * presented AVPlayerViewController: gapless track advance, background audio,
 * lock-screen queue controls, per-item metadata. Order, shuffle, loop policy
 * and all Jellyfin reporting stay in JS (services/audioPlayerManager.ts).
 */

import { NativeEventEmitter, NativeModules, Platform } from "react-native";

const { AudioQueuePlayer } = NativeModules;

export interface AudioQueueTrack {
  id: string;
  url: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
  durationSeconds: number;
}

export interface AudioQueueConfig {
  tracks: AudioQueueTrack[];
  startIndex: number;
  startPositionSeconds: number;
  loop: boolean;
}

export interface AudioTrackChangedEvent {
  index: number;
  trackId: string;
  previousIndex: number; // -1 on the first track of a queue
  previousTrackId: string | null;
  previousPosition: number; // seconds; full duration on natural track end
  natural: boolean; // true when the previous track played to its end
}

export interface AudioProgressEvent {
  index: number;
  position: number;
  duration: number;
  playing: boolean;
}

export interface AudioQueueEndedEvent {
  natural: boolean;
}

export interface AudioErrorEvent {
  index: number;
  message: string;
}

export interface AudioPipChangedEvent {
  active: boolean;
  /** Only on active false: true = returned to the full player, false = PiP window closed with ✕. */
  restored?: boolean;
}

export interface AudioPlayerState {
  active: boolean;
  index: number;
  position: number;
  playing: boolean;
}

export function isAudioQueuePlayerAvailable(): boolean {
  return Platform.OS === "ios" && !!AudioQueuePlayer?.loadQueue;
}

export async function loadQueue(config: AudioQueueConfig): Promise<void> {
  await AudioQueuePlayer.loadQueue(config);
}

export async function play(): Promise<void> {
  await AudioQueuePlayer.play();
}

export async function pause(): Promise<void> {
  await AudioQueuePlayer.pause();
}

export async function next(): Promise<void> {
  await AudioQueuePlayer.next();
}

export async function previous(): Promise<void> {
  await AudioQueuePlayer.previous();
}

export async function seekTo(seconds: number): Promise<void> {
  await AudioQueuePlayer.seekTo(seconds);
}

export async function skipToIndex(index: number): Promise<void> {
  await AudioQueuePlayer.skipToIndex(index);
}

/** Re-present the player UI for a queue still playing in the background. */
export async function present(): Promise<void> {
  await AudioQueuePlayer.present();
}

export async function stop(): Promise<void> {
  await AudioQueuePlayer.stop();
}

export async function getState(): Promise<AudioPlayerState> {
  return AudioQueuePlayer.getState();
}

export interface AudioQueueEventHandlers {
  onTrackChanged: (event: AudioTrackChangedEvent) => void;
  onProgress: (event: AudioProgressEvent) => void;
  onQueueEnded: (event: AudioQueueEndedEvent) => void;
  onDismiss: () => void;
  onError: (event: AudioErrorEvent) => void;
  onPipChanged: (event: AudioPipChangedEvent) => void;
}

/**
 * Subscribe to every native event in one call. Returns an unsubscribe
 * function. The emitter is created lazily so importing this module on
 * platforms without the native side stays inert.
 */
export function subscribeToEvents(handlers: AudioQueueEventHandlers): () => void {
  if (!isAudioQueuePlayerAvailable()) {
    return () => {};
  }
  const emitter = new NativeEventEmitter(AudioQueuePlayer);
  const subscriptions = [
    emitter.addListener("onTrackChanged", handlers.onTrackChanged),
    emitter.addListener("onProgress", handlers.onProgress),
    emitter.addListener("onQueueEnded", handlers.onQueueEnded),
    emitter.addListener("onDismiss", handlers.onDismiss),
    emitter.addListener("onError", handlers.onError),
    emitter.addListener("onPipChanged", handlers.onPipChanged),
  ];
  return () => subscriptions.forEach((subscription) => subscription.remove());
}
