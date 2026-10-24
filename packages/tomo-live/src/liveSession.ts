/**
 * A live channel's play, from the session it takes over to the one it hands back to the ring: the
 * engine's in-session reopens, the failure that ends a session, and what each drop asks for.
 */
import { engineProgress, LIVE_BUFFER_SECONDS, localRemuxToken, stopLocalRemux, subscribeEngineFailure, subscribeEngineLive, type EngineLiveEvent } from "@keiver/tomo-engine";

import { isPermanentLiveFailure, liveReopenCount, planLiveRecovery, type LiveRecoveryDecision } from "./liveRecovery";
import { takeLivePreview } from "./livePreview";
import { retainLiveSession, takeRingSession, takeWarmDetails, type HotChannel, type RingSession } from "./liveRing";

export interface LiveSessionWatch {
  /** The engine lost the input and is opening it again in place; the player rides its buffer meanwhile. */
  onReopening?: (event: EngineLiveEvent) => void;
  /** The input is back in the same session. */
  onReopened?: (event: EngineLiveEvent) => void;
  /**
   * The session ended. `decision` says whether to start the channel again (after `delayMs`) or to
   * stop: a channel is never handed anywhere else.
   */
  onEnded?: (message: string, decision: LiveRecoveryDecision) => void;
}

/** Drops counted across the sessions of one channel play, reset by a stretch of playback. */
export class LiveDropCounter {
  private attempts = 0;
  private lastDropAt: number | null = null;
  private playingSince: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** The channel plays again; the time it keeps playing is what resets the count. */
  notePlaying(): void {
    this.playingSince ??= this.now();
  }

  /** The attempt this drop is, counting from zero after a stretch of playback without one. */
  drop(): number {
    const now = this.now();
    const played = this.playingSince === null ? 0 : now - this.playingSince;
    this.attempts = this.lastDropAt === null ? 0 : liveReopenCount(this.attempts + 1, played);
    this.lastDropAt = now;
    this.playingSince = null;
    return this.attempts;
  }

  reset(): void {
    this.attempts = 0;
    this.lastDropAt = null;
    this.playingSince = null;
  }
}

/** Watches one session until the returned function runs. `drops` carries the count across the channel's sessions. */
export function watchLiveSession(token: string, drops: LiveDropCounter, watch: LiveSessionWatch): () => void {
  const stopLive = subscribeEngineLive(token, (event) => {
    if (event.event === "reopening") watch.onReopening?.(event);
    else watch.onReopened?.(event);
  });
  const stopFailure = subscribeEngineFailure(token, (failure) => {
    watch.onEnded?.(failure.message, planLiveRecovery({ attempts: drops.drop(), permanent: isPermanentLiveFailure(failure.message) }));
  });
  return () => {
    stopLive();
    stopFailure();
  };
}

/** What the app gives the controller: how to let go of a channel it opened, and the ring's rules when they differ. */
export interface LivePlaybackDeps<Item> {
  /** Releases what the app opened for the channel, a server open holding a tuner. */
  closeChannel: (item: Item) => void;
  /** The ring's hot session for the channel, else a card preview's; taken rather than started twice. */
  takeHot?: (channelId: string) => Promise<RingSession<Item> | null>;
  /** A neighbour's resolve of the channel, bindable once. */
  takeWarm?: (channelId: string) => Item | null;
  /** Keeps a channel left mid-surf hot; true when the ring took it. */
  retain?: (channel: HotChannel<Item>) => boolean;
  stopSession?: (token: string) => void | Promise<void>;
  now?: () => number;
  /** Opens the channel when no ring session or resolve has it; `open` and `play` need it. */
  openChannel?: (channelId: string) => Promise<Item | null>;
  /** Starts the engine session for an opened channel and resolves its URL; `play` needs it. */
  startSession?: (item: Item) => Promise<string>;
  /** Whether an item holds a channel to close; every item does when absent. */
  isChannel?: (item: Item) => boolean;
  /** A failure of the open, the start or `prepare` that no reopen fixes, besides the engine's own. */
  isPermanent?: (error: unknown) => boolean;
  /** Seconds of output the session holds ahead; null when it cannot say. The engine's progress when absent. */
  bufferedSeconds?: (token: string) => Promise<number | null>;
}

export type LivePlaybackState = "idle" | "opening" | "buffering" | "playing" | "reopening" | "failed";

/** What `play` tells the app, and the app's own steps between the open and the player. */
export interface LivePlayHandlers<Item> {
  /** Each channel the play opened itself: every open but the `opened` one it was given. */
  onOpened?: (item: Item) => void;
  /** Starts the session for a channel with no hot one; the `startSession` dep when absent. */
  startSession?: (item: Item) => Promise<string>;
  /** Runs before a session is bound; a throw is a drop, `false` ends the play with no bind. */
  prepare?: (session: AdoptedSession) => Promise<void | boolean>;
  onUrl: (url: string, token: string) => void;
  onState?: (state: LivePlaybackState) => void;
  /** A drop the play opens the channel again after: what failed, the error behind it when one was thrown or passed to `fail`. */
  onDrop?: (message: string, cause: unknown, decision: LiveRecoveryDecision) => void;
  onEnded?: (message: string, cause: unknown) => void;
  onReopening?: (event: EngineLiveEvent) => void;
  onReopened?: (event: EngineLiveEvent) => void;
}

/** A ring or preview session taken for the channel: bound as it is when `ready`, timed like a fresh start when not. */
export interface AdoptedSession {
  url: string;
  token: string;
  ready: boolean;
}

/**
 * One live channel's play, whole (`play`) or a step at a time; it owns letting go of what the play
 * holds, or handing it to the ring.
 */
export class LivePlayback<Item> {
  private channelId: string | null = null;
  private item: Item | null = null;
  private adopted: (AdoptedSession & { channelId: string }) | null = null;
  private session: { token: string; url: string } | null = null;
  private unwatch: (() => void) | null = null;
  private readonly drops: LiveDropCounter;
  private delayMs: number | null = null;
  private wait: ReturnType<typeof setTimeout> | null = null;
  private play_: { id: number; channelId: string; handlers: LivePlayHandlers<Item>; opened: Item | null } | null = null;
  private plays = 0;
  private state_: LivePlaybackState = "idle";
  private attempting = false;

  constructor(private readonly deps: LivePlaybackDeps<Item>) {
    this.drops = new LiveDropCounter(deps.now);
  }

  get state(): LivePlaybackState {
    return this.state_;
  }

  /**
   * The channel to play: a ring session's or a neighbour's when they have it, else opened with
   * `openChannel`. Null when the viewer left (`current` false), with nothing left open.
   */
  async open(channelId: string, current: () => boolean): Promise<Item | null> {
    const { item: taken, token } = await this.take(channelId, current);
    if (!current()) {
      this.abandonTaken(taken, token);
      return null;
    }
    const item = taken ?? (await this.required("openChannel")(channelId));
    if (!current()) {
      this.abandonTaken(item, token);
      return null;
    }
    if (item === null) return null;
    if (this.isChannel(item)) this.opened(item);
    return item;
  }

  /**
   * Plays a channel (or `opened`, already opened) until `stop` or `release`: each URL goes to `onUrl`,
   * and after each drop the channel opens again after the planned wait, until a failure no open fixes.
   */
  async play(channelId: string, handlers: LivePlayHandlers<Item>, options: { opened?: Item } = {}): Promise<void> {
    if (this.play_ || this.wait !== null) {
      const token = this.session?.token;
      this.play_ = null;
      this.cancelWait();
      this.endWatch();
      this.session = null;
      if (token) this.stopSession(token);
      if (this.item !== null && this.item !== options.opened) this.abandon(this.item);
    }
    this.reset();
    this.attempting = false;
    this.state_ = "idle";
    const id = ++this.plays;
    this.play_ = { id, channelId, handlers, opened: options.opened ?? null };
    await this.playOnce(id);
  }

  /**
   * The player's own failure on the bound session: the channel opens again after the planned wait, or
   * the play ends at `onEnded`. Ignored while an attempt runs or a wait is pending.
   */
  fail(message: string, permanent: boolean, decided?: LiveRecoveryDecision, cause?: unknown): void {
    if (this.attempting || this.wait !== null) return;
    this.dropPlay(message, permanent, decided, cause);
  }

  private dropPlay(message: string, permanent: boolean, decided?: LiveRecoveryDecision, cause?: unknown): void {
    const play = this.play_;
    if (!play) return;
    const token = this.session?.token;
    const decision = this.drop(message, permanent, decided);
    if (token) this.stopSession(token);
    if (!decision.reopen) {
      this.setState("failed");
      this.play_ = null;
      play.handlers.onEnded?.(message, cause);
      return;
    }
    this.setState("reopening");
    play.handlers.onDrop?.(message, cause, decision);
    this.reopenAfterWait(() => void this.playOnce(play.id));
  }

  private async playOnce(id: number): Promise<void> {
    const current = () => this.play_?.id === id;
    const play = this.play_;
    if (!play || !current()) return;
    if (this.state_ !== "reopening") this.setState("opening");
    this.attempting = true;
    try {
      const given = play.opened;
      play.opened = null;
      const item = given ?? (await this.open(play.channelId, current));
      if (!current()) return;
      if (!item) throw new Error("the channel did not open");
      if (!given) play.handlers.onOpened?.(item);
      const adopted = this.takeAdopted(play.channelId);
      const url = adopted?.url ?? (await (play.handlers.startSession ?? this.required("startSession"))(item));
      const token = adopted?.token ?? localRemuxToken(url);
      if (!current()) {
        if (token) this.stopSession(token);
        return;
      }
      if (!token) throw new Error(`not an engine session URL: ${url}`);
      this.session = { token, url };
      const prepared = await play.handlers.prepare?.({ url, token, ready: adopted?.ready ?? false });
      if (!current()) return;
      if (prepared === false) {
        this.stop();
        return;
      }
      this.bind(token, url, {
        onReopening: play.handlers.onReopening,
        onReopened: play.handlers.onReopened,
        onEnded: (message, decision) => {
          if (current()) this.dropPlay(message, false, decision);
        },
      });
      if (!(await this.startBuffered(token, current))) return;
      this.setState("buffering");
      this.attempting = false;
      play.handlers.onUrl(url, token);
    } catch (error) {
      if (current()) this.dropPlay(error instanceof Error ? error.message : String(error), this.deps.isPermanent?.(error) ?? false, undefined, error);
    } finally {
      if (current()) this.attempting = false;
    }
  }

  /** Waits until the session holds LIVE_BUFFER_SECONDS, at most 20 s past them; false when the attempt ended or its session dropped. */
  private async startBuffered(token: string, current: () => boolean): Promise<boolean> {
    const now = this.deps.now ?? Date.now;
    const deadline = now() + (20 + LIVE_BUFFER_SECONDS) * 1000;
    const read = this.deps.bufferedSeconds ?? ((t: string) => engineProgress(t).then((progress) => progress?.bufferedSeconds ?? null));
    while (current() && this.session?.token === token) {
      const buffered = await read(token);
      if (!current() || this.session?.token !== token) return false;
      if (buffered === null || buffered >= LIVE_BUFFER_SECONDS || now() >= deadline) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  /** Runs `reopen` once the wait the last drop asked for has passed; a later call or `cancelWait` drops it. */
  reopenAfterWait(reopen: () => void): void {
    this.cancelWait();
    this.wait = setTimeout(() => {
      this.wait = null;
      reopen();
    }, this.delayMs ?? 0);
  }

  cancelWait(): void {
    if (this.wait !== null) clearTimeout(this.wait);
    this.wait = null;
  }

  /** Ends `play`: no wait runs, the session stops and the channel closes. */
  stop(): void {
    if (!this.play_ && this.wait === null) return;
    this.play_ = null;
    this.cancelWait();
    const token = this.session?.token;
    this.release(false);
    if (token) this.stopSession(token);
    this.state_ = "idle";
  }

  private setState(state: LivePlaybackState): void {
    if (this.state_ === state) return;
    this.state_ = state;
    this.play_?.handlers.onState?.(state);
  }

  private required<K extends "openChannel" | "startSession">(name: K): NonNullable<LivePlaybackDeps<Item>[K]> {
    const dep = this.deps[name];
    if (!dep) throw new Error(`LivePlayback needs ${name}`);
    return dep as NonNullable<LivePlaybackDeps<Item>[K]>;
  }

  private isChannel(item: Item): boolean {
    return this.deps.isChannel?.(item) ?? true;
  }

  /** What a stale attempt took: its hot session stops unless a newer attempt replaced it, and an open it holds closes. */
  private abandonTaken(item: Item | null, token: string | null): void {
    if (token !== null && this.adopted?.token === token) this.dropAdopted();
    if (item !== null && this.isChannel(item)) this.abandon(item);
  }

  /**
   * The channel as the ring or a neighbour already has it, or null to open it. A hot session taken
   * for an attempt the viewer left (`current` false) is let go here.
   */
  async acquire(channelId: string, current: () => boolean): Promise<Item | null> {
    return (await this.take(channelId, current)).item;
  }

  /** `acquire`, with the token of the hot session it adopted. */
  private async take(channelId: string, current: () => boolean): Promise<{ item: Item | null; token: string | null }> {
    this.dropAdopted();
    this.channelId = channelId;
    const hot = await (this.deps.takeHot ?? ((id: string) => takeRingSession<Item>(id).then((ring) => ring ?? takeLivePreview<Item>(id))))(channelId);
    if (hot && !current()) {
      this.stopSession(hot.token);
      this.deps.closeChannel(hot.details);
      return { item: null, token: null };
    }
    if (hot) {
      this.adopted = { channelId, url: hot.url, token: hot.token, ready: hot.ready };
      return { item: hot.details, token: hot.token };
    }
    return { item: (this.deps.takeWarm ?? ((id: string) => takeWarmDetails<Item>(id)))(channelId), token: null };
  }

  /** What the app opened for this play; closed on every drop and teardown unless the ring takes it. */
  opened(item: Item): void {
    this.item = item;
  }

  /** An open nobody will play: the viewer left before it landed, or its attempt failed. */
  abandon(item: Item): void {
    if (this.item === item) this.item = null;
    this.deps.closeChannel(item);
  }

  /** The hot session taken for `channelId`, once; one taken for another channel is stopped. */
  takeAdopted(channelId: string): AdoptedSession | null {
    const adopted = this.adopted;
    this.adopted = null;
    if (adopted && adopted.channelId !== channelId) {
      this.stopSession(adopted.token);
      return null;
    }
    return adopted ? { url: adopted.url, token: adopted.token, ready: adopted.ready } : null;
  }

  /** A taken session that will not be bound. */
  dropAdopted(): void {
    if (this.adopted) this.stopSession(this.adopted.token);
    this.adopted = null;
  }

  /** The session the player reads, watched for its whole life. */
  bind(token: string, url: string, watch: LiveSessionWatch): void {
    this.unwatch?.();
    this.session = { token, url };
    this.unwatch = watchLiveSession(token, this.drops, watch);
  }

  /** The channel plays. */
  notePlaying(): void {
    this.drops.notePlaying();
    if (this.play_) this.setState("playing");
  }

  /**
   * A drop: what failed and whether any open could fix it, or the decision the session's watch
   * already made. Lets go of the channel and the watch; the app stops its own session.
   */
  drop(message: string, permanent: boolean, decided?: LiveRecoveryDecision): LiveRecoveryDecision {
    const decision = decided ?? planLiveRecovery({ attempts: this.drops.drop(), permanent: permanent || isPermanentLiveFailure(message) });
    this.delayMs = decision.reopen ? decision.delayMs : null;
    this.endWatch();
    this.session = null;
    if (this.item !== null) this.deps.closeChannel(this.item);
    this.item = null;
    return decision;
  }

  /** The wait the last drop asked for before the channel opens again; null when it asked for none. */
  get retryDelayMs(): number | null {
    return this.delayMs;
  }

  /** A new item or the viewer's retry: the drops count from zero. */
  reset(): void {
    this.drops.reset();
    this.delayMs = null;
  }

  /**
   * The player leaves. A channel that played (`keepHot`) goes to the ring with its session; true when
   * the ring took it, and the app must not stop that session.
   */
  release(keepHot: boolean): boolean {
    this.play_ = null;
    this.state_ = "idle";
    this.attempting = false;
    this.cancelWait();
    this.endWatch();
    const { channelId, item, session } = this;
    const retained =
      keepHot && channelId !== null && item !== null && session !== null && (this.deps.retain ?? retainLiveSession)({ channelId, details: item, url: session.url, token: session.token });
    if (!retained && item !== null) this.deps.closeChannel(item);
    this.item = null;
    this.session = null;
    this.channelId = null;
    this.dropAdopted();
    return retained;
  }

  private endWatch(): void {
    this.unwatch?.();
    this.unwatch = null;
  }

  private stopSession(token: string): void {
    void (this.deps.stopSession ?? stopLocalRemux)(token);
  }
}
