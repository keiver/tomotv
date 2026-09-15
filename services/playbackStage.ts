/**
 * What the player is doing while its spinner is up, one stage at a time: the loading overlay,
 * the channel interstitial and the error screen read it. Reset when playback settles or the
 * item changes; an error leaves the failing stage in place.
 */
export type PlaybackStage = "details" | "opening" | "engine" | "reading" | "analysing" | "preparing" | "server" | "player" | "buffering" | "reopening";

export interface PlaybackStageState {
  stage: PlaybackStage | null;
  /** When the current stage began, epoch ms. */
  since: number;
  /** The stages this attempt went through before the current one, in order. */
  passed: PlaybackStage[];
}

type Listener = (state: PlaybackStageState) => void;

const EMPTY: PlaybackStageState = { stage: null, since: 0, passed: [] };
let state: PlaybackStageState = EMPTY;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener(state);
}

export function setPlaybackStage(stage: PlaybackStage): void {
  if (state.stage === stage) return;
  state = { stage, since: Date.now(), passed: state.stage ? [...state.passed, state.stage] : state.passed };
  emit();
}

export function resetPlaybackStages(): void {
  if (state === EMPTY) return;
  state = EMPTY;
  emit();
}

export function currentPlaybackStage(): PlaybackStageState {
  return state;
}

export function subscribePlaybackStage(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
