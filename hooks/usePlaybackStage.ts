import { t } from "@/services/i18n";
import { currentPlaybackStage, PlaybackStage, PlaybackStageState, subscribePlaybackStage } from "@/services/playbackStage";
import { useEffect, useState } from "react";

/** A stage that has run this long gets its hint under the status line. */
export const STAGE_HINT_AFTER_SECONDS = 12;

const LABELS: Record<PlaybackStage, Parameters<typeof t>[0]> = {
  details: "player.stage.details",
  opening: "player.stage.opening",
  engine: "player.stage.engine",
  reading: "player.stage.reading",
  analysing: "player.stage.analysing",
  preparing: "player.stage.preparing",
  server: "player.stage.server",
  player: "player.stage.player",
  buffering: "player.stage.buffering",
  reopening: "player.stage.reopening",
};

const HINTS: Record<PlaybackStage, Parameters<typeof t>[0]> = {
  details: "player.hint.details",
  opening: "player.hint.opening",
  engine: "player.hint.engine",
  reading: "player.hint.reading",
  analysing: "player.hint.analysing",
  preparing: "player.hint.preparing",
  server: "player.hint.server",
  player: "player.hint.player",
  buffering: "player.hint.buffering",
  reopening: "player.hint.reopening",
};

export function stageLabel(stage: PlaybackStage): string {
  return t(LABELS[stage]);
}

export function stageHint(stage: PlaybackStage): string {
  return t(HINTS[stage]);
}

/** The current stage with a once-a-second clock while one is running. */
export function usePlaybackStage(): PlaybackStageState & { elapsedSeconds: number } {
  const [state, setState] = useState(currentPlaybackStage);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribePlaybackStage(setState), []);
  useEffect(() => {
    if (!state.stage) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.stage, state.since]);
  // A clock read older than the stage's start reads as its first second.
  const elapsedSeconds = state.stage ? Math.max(0, Math.floor((now - state.since) / 1000)) : 0;
  return { ...state, elapsedSeconds };
}
