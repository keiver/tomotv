/**
 * audioPlayerManager.ts
 *
 * Singleton lifecycle for native audio queue playback. Background music
 * outlives the player screen, so everything with a lifetime — the native
 * queue, per-track Jellyfin reporting, UI-visibility state — lives here, not
 * in a hook. Screens subscribe for display state only.
 *
 * Reporting mirrors usePlaybackReporter's contract per track: one session
 * snapshot per track (new PlaySessionId each), serialized server writes,
 * close-exactly-once, Stopped at full duration on natural end (server
 * auto-marks Played), gate-free UserData persist for mid-track exits inside
 * the resume window.
 */

import { Platform } from "react-native";
import {
  generatePlaySessionId,
  getPosterUrl,
  getVideoStreamUrl,
  hasPoster,
  JELLYFIN_TIME,
  markItemPlayed,
  PlaybackReportBody,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  updateUserItemData,
} from "@/services/jellyfinApi";
import * as audioQueuePlayer from "@/services/audioQueuePlayer";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";

// Same resume policy as usePlaybackReporter: under 2s isn't worth resuming,
// past 95% the track counts as finished.
const MIN_PERSIST_POSITION_SECONDS = 2;
const COMPLETION_THRESHOLD = 0.95;
// Report Progress after this much positional advancement (the video path's
// 8s poll cadence, driven here by the native 1 Hz progress events).
const PROGRESS_REPORT_DELTA_SECONDS = 8;

interface TrackSession {
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  playedAtStart: boolean;
  durationSeconds: number;
  closed: boolean;
}

export interface AudioPlayerUIState {
  active: boolean;
  /** False once the user dismissed the native UI; the screen pops on this. */
  uiVisible: boolean;
  index: number;
  queueLength: number;
  track: JellyfinVideoItem | null;
  playing: boolean;
  position: number;
}

interface StartOptions {
  loop?: boolean;
  startPositionSeconds?: number;
  /** Queue identity (folder/playlist id) for background re-entry detection. */
  sourceId?: string;
}

type Listener = (state: AudioPlayerUIState) => void;

class AudioPlayerManager {
  private items: JellyfinVideoItem[] = [];
  private currentIndex = 0;
  private active = false;
  private uiVisible = false;
  private playing = false;
  private position = 0;
  private sourceId: string | null = null;

  private session: TrackSession | null = null;
  private lastReportedPosition = 0;
  private pendingStartPosition = 0;
  private unsubscribeNative: (() => void) | null = null;
  private listeners = new Set<Listener>();

  // Serialized server-write chain (same rationale as usePlaybackReporter):
  // a stale mid-track persist must never land after the track-closing Stopped.
  private writeChain: Promise<void> | null = null;

  // MARK: - Public API

  isAvailable(): boolean {
    return audioQueuePlayer.isAudioQueuePlayerAvailable();
  }

  /**
   * Start playback of an ordered audio queue, or re-attach to one already
   * playing in the background: same source + same start track re-presents the
   * native UI instead of restarting the stream.
   */
  async startQueue(items: JellyfinVideoItem[], startId: string, options: StartOptions = {}): Promise<void> {
    const startIndex = Math.max(
      0,
      items.findIndex((item) => item.Id === startId),
    );

    if (this.active && this.sourceId !== null && this.sourceId === options.sourceId) {
      const currentTrack = this.items[this.currentIndex];
      if (currentTrack?.Id === startId) {
        await audioQueuePlayer.present();
        this.uiVisible = true;
        this.notify();
        return;
      }
      const targetIndex = this.items.findIndex((item) => item.Id === startId);
      if (targetIndex >= 0) {
        await audioQueuePlayer.present();
        this.uiVisible = true;
        await audioQueuePlayer.skipToIndex(targetIndex);
        this.notify();
        return;
      }
    }

    await this.stop();

    this.items = items;
    this.currentIndex = startIndex;
    this.sourceId = options.sourceId ?? null;
    this.pendingStartPosition = options.startPositionSeconds ?? 0;
    this.active = true;
    this.uiVisible = true;
    this.playing = true;
    this.position = this.pendingStartPosition;
    this.lastReportedPosition = 0;

    this.unsubscribeNative = audioQueuePlayer.subscribeToEvents({
      onTrackChanged: (event) => this.handleTrackChanged(event),
      onProgress: (event) => this.handleProgress(event),
      onQueueEnded: (event) => this.handleQueueEnded(event),
      onDismiss: () => this.handleDismiss(),
      onError: (event) => logger.warn("Audio track failed, skipping", { service: "AudioPlayer", index: event.index, message: event.message }),
    });

    logger.info("Audio queue starting", { service: "AudioPlayer", count: items.length, startIndex });
    try {
      await audioQueuePlayer.loadQueue({
        tracks: items.map((item) => this.toTrack(item)),
        startIndex,
        startPositionSeconds: this.pendingStartPosition,
        loop: options.loop ?? false,
      });
    } catch (error) {
      logger.error("Audio queue failed to start", error, { service: "AudioPlayer" });
      this.teardownLocalState();
      this.notify();
      throw error;
    }
    this.notify();
  }

  /** Re-present the native UI for a queue playing in the background. */
  async present(): Promise<void> {
    if (!this.active) return;
    await audioQueuePlayer.present();
    this.uiVisible = true;
    this.notify();
  }

  /**
   * Stop playback and tear everything down. Safe to call when idle — every
   * external "audio must not be playing anymore" path (video start, sign-out,
   * queue end) funnels through here.
   */
  async stop(): Promise<void> {
    if (!this.active) return;
    this.closeSession(this.position);
    this.teardownLocalState();
    try {
      await audioQueuePlayer.stop();
    } catch (error) {
      logger.warn("Native audio stop failed", error, { service: "AudioPlayer" });
    }
    this.notify();
  }

  getUIState(): AudioPlayerUIState {
    return {
      active: this.active,
      uiVisible: this.uiVisible,
      index: this.currentIndex,
      queueLength: this.items.length,
      track: this.items[this.currentIndex] ?? null,
      playing: this.playing,
      position: this.position,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getUIState());
    return () => this.listeners.delete(listener);
  }

  // MARK: - Native events

  private handleTrackChanged(event: audioQueuePlayer.AudioTrackChangedEvent): void {
    // Close the finished/skipped track first: natural end reports Stopped at
    // full duration (server auto-marks Played), a skip reports the position it
    // left off.
    if (event.previousIndex >= 0 && this.session) {
      const finalPosition = event.natural ? this.session.durationSeconds : event.previousPosition;
      this.closeSession(finalPosition);
    }

    const item = this.items[event.index];
    if (!item) return;
    this.currentIndex = event.index;
    this.position = event.previousIndex >= 0 ? 0 : this.pendingStartPosition;
    this.lastReportedPosition = this.position;
    this.openSession(item, this.position);
    this.notify();
  }

  private handleProgress(event: audioQueuePlayer.AudioProgressEvent): void {
    const pauseFlipped = this.playing !== event.playing;
    this.position = event.position;
    this.playing = event.playing;

    const session = this.session;
    if (session && !session.closed) {
      if (pauseFlipped) {
        // Immediate report on play/pause so the server dashboard tracks state.
        this.enqueueWrite(async () => {
          await reportPlaybackProgress(this.buildBody(session, event.position, !event.playing));
        });
        this.persistResume(session, event.position);
      } else if (event.playing && Math.abs(event.position - this.lastReportedPosition) >= PROGRESS_REPORT_DELTA_SECONDS) {
        this.lastReportedPosition = event.position;
        this.enqueueWrite(async () => {
          await reportPlaybackProgress(this.buildBody(session, event.position, false));
        });
        this.persistResume(session, event.position);
      }
    }

    this.notify();
  }

  private handleQueueEnded(event: audioQueuePlayer.AudioQueueEndedEvent): void {
    logger.info("Audio queue ended", { service: "AudioPlayer", natural: event.natural });
    const finalPosition = event.natural && this.session ? this.session.durationSeconds : this.position;
    this.closeSession(finalPosition);
    this.teardownLocalState();
    void audioQueuePlayer.stop().catch(() => {});
    this.notify();
  }

  private handleDismiss(): void {
    this.uiVisible = false;
    if (Platform.isTV) {
      // Menu on the audio player is a deliberate exit: stop entirely.
      void this.stop();
      return;
    }
    // iPhone: swiping the player away keeps the music playing (Music-app
    // behavior); the screen pops on uiVisible and lock-screen controls take
    // over.
    this.notify();
  }

  // MARK: - Reporting

  private openSession(item: JellyfinVideoItem, positionSeconds: number): void {
    const session: TrackSession = {
      itemId: item.Id,
      mediaSourceId: item.MediaSources?.[0]?.Id ?? item.Id,
      playSessionId: generatePlaySessionId(),
      playedAtStart: item.UserData?.Played ?? false,
      durationSeconds: item.RunTimeTicks ? item.RunTimeTicks / JELLYFIN_TIME.TICKS_PER_SECOND : 0,
      closed: false,
    };
    this.session = session;
    this.enqueueWrite(async () => {
      await reportPlaybackStart(this.buildBody(session, positionSeconds, false));
    });
  }

  /** Close the in-flight track session exactly once. */
  private closeSession(finalPosition: number): void {
    const session = this.session;
    if (!session || session.closed) return;
    session.closed = true;
    this.session = null;

    this.enqueueWrite(async () => {
      await reportPlaybackStopped(this.buildBody(session, finalPosition, false));
      const persisted = await this.persistResumeNow(session, finalPosition);
      if (persisted === false) {
        await this.persistResumeNow(session, finalPosition);
      }
      if (session.durationSeconds > 0 && finalPosition / session.durationSeconds >= COMPLETION_THRESHOLD) {
        markItemPlayed(session.itemId, true);
      }
    });
  }

  private buildBody(session: TrackSession, positionSeconds: number, isPaused: boolean): PlaybackReportBody {
    return {
      ItemId: session.itemId,
      MediaSourceId: session.mediaSourceId,
      PlaySessionId: session.playSessionId,
      PositionTicks: Math.round(positionSeconds * JELLYFIN_TIME.TICKS_PER_SECOND),
      IsPaused: isPaused,
      PlayMethod: "DirectStream",
      CanSeek: true,
    };
  }

  private persistResume(session: TrackSession, positionSeconds: number): void {
    this.enqueueWrite(async () => {
      await this.persistResumeNow(session, positionSeconds);
    });
  }

  /**
   * Gate-free UserData persist inside the resume window; restores the Played
   * flag the track had at session start (same contract as usePlaybackReporter).
   */
  private async persistResumeNow(session: TrackSession, positionSeconds: number): Promise<boolean> {
    if (session.durationSeconds <= 0) return true;
    if (positionSeconds < MIN_PERSIST_POSITION_SECONDS || positionSeconds / session.durationSeconds >= COMPLETION_THRESHOLD) {
      return true;
    }
    const ok = await updateUserItemData(session.itemId, {
      PlaybackPositionTicks: Math.round(positionSeconds * JELLYFIN_TIME.TICKS_PER_SECOND),
      Played: session.playedAtStart,
    });
    return ok !== false;
  }

  private enqueueWrite(task: () => Promise<void>): void {
    const prev = this.writeChain;
    const run = (prev ? prev.then(task) : task()).catch(() => {
      // Report functions swallow their own failures; this only keeps an
      // unexpected throw from wedging the chain.
    });
    this.writeChain = run;
    void run.then(() => {
      if (this.writeChain === run) this.writeChain = null;
    });
  }

  // MARK: - Internals

  private toTrack(item: JellyfinVideoItem): audioQueuePlayer.AudioQueueTrack {
    return {
      id: item.Id,
      url: getVideoStreamUrl(item.Id, item),
      title: item.Name,
      artist: item.Artists?.length ? item.Artists.join(", ") : (item.AlbumArtist ?? ""),
      album: item.Album ?? "",
      artworkUrl: hasPoster(item) ? getPosterUrl(item.Id, 600) : "",
      durationSeconds: item.RunTimeTicks ? item.RunTimeTicks / JELLYFIN_TIME.TICKS_PER_SECOND : 0,
    };
  }

  private teardownLocalState(): void {
    this.unsubscribeNative?.();
    this.unsubscribeNative = null;
    this.active = false;
    this.uiVisible = false;
    this.playing = false;
    this.position = 0;
    this.items = [];
    this.currentIndex = 0;
    this.sourceId = null;
    this.session = null;
    this.lastReportedPosition = 0;
    this.pendingStartPosition = 0;
  }

  private notify(): void {
    const state = this.getUIState();
    this.listeners.forEach((listener) => listener(state));
  }
}

export const audioPlayerManager = new AudioPlayerManager();
