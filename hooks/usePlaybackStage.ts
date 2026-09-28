import { t } from "@/services/i18n";
import { currentPlaybackStage, PlaybackStage, subscribePlaybackStage } from "@/services/playbackStage";
import { useEffect, useState } from "react";

/** An attempt still loading this long gets its status line; a faster one shows the bare spinner. */
export const STATUS_AFTER_MS = 8000;
/** And this long, the reason it is waiting, for a stage that pins one. */
export const REASON_AFTER_MS = 12000;

export type StagePhase = "quiet" | "status" | "reason";

/** What each stage waits on. Engine, preparing, player and buffering wait on more than one thing, so they name none. */
const REASONS: Partial<Record<PlaybackStage, Parameters<typeof t>[0]>> = {
  details: "player.reason.details",
  opening: "player.reason.opening",
  reopening: "player.reason.reopening",
  reading: "player.reason.reading",
  analysing: "player.reason.reading",
  server: "player.reason.server",
};

/** A file read off this device waits on no network, so the stages that read a source name nothing for it. */
const NETWORK_READS: ReadonlySet<PlaybackStage> = new Set(["reading", "analysing"]);

export function stageStatus(live: boolean): string {
  return t(live ? "player.status.live" : "player.status.video");
}

export function stageReason(stage: PlaybackStage, { live = false, local = false } = {}): string | null {
  const key = REASONS[stage];
  if (!key || (local && NETWORK_READS.has(stage))) return null;
  return t(live && stage === "server" ? "player.reason.serverLive" : key);
}

const STOPPED: Record<PlaybackStage, Parameters<typeof t>[0]> = {
  details: "player.stopped.details",
  opening: "player.stopped.opening",
  reopening: "player.stopped.reopening",
  engine: "player.stopped.engine",
  reading: "player.stopped.reading",
  analysing: "player.stopped.reading",
  preparing: "player.stopped.preparing",
  server: "player.stopped.server",
  player: "player.stopped.player",
  buffering: "player.stopped.buffering",
};

/** Where a failed attempt stopped, for the error screen. */
export function stageStopped(stage: PlaybackStage, { live = false, local = false } = {}): string {
  if (local && NETWORK_READS.has(stage)) return t("player.stopped.readingLocal");
  if (live && stage === "server") return t("player.stopped.serverLive");
  return t(STOPPED[stage]);
}

/** The current stage and which threshold the attempt has passed, re-rendering only as it crosses one. */
export function usePlaybackStage(): { stage: PlaybackStage | null; phase: StagePhase } {
  const [state, setState] = useState(currentPlaybackStage);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribePlaybackStage(setState), []);
  const running = state.stage !== null;
  const { startedAt } = state;
  useEffect(() => {
    if (!running) return;
    const timers = [STATUS_AFTER_MS, REASON_AFTER_MS].map((after) => setTimeout(() => setNow(Date.now()), Math.max(0, startedAt + after - Date.now())));
    return () => timers.forEach(clearTimeout);
  }, [running, startedAt]);
  const elapsed = running ? now - startedAt : 0;
  const phase: StagePhase = elapsed >= REASON_AFTER_MS ? "reason" : elapsed >= STATUS_AFTER_MS ? "status" : "quiet";
  return { stage: state.stage, phase };
}
