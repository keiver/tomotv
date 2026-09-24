import { JELLYFIN_TIME } from "@/services/jellyfin/constants";

export interface ResumeInput {
  live: boolean;
  /** A seek already pending from a restart (audio switch, recovery) outranks both resume points. */
  pendingSeekSec: number | null;
  /** What the launching screen displayed (Continue Watching row). */
  startPositionTicks: number | undefined;
  /** UserData from the details refetch, which can answer stale and wipe a real resume point. */
  userDataTicks: number | undefined;
}

export interface ResumeDecision {
  seconds: number | null;
  source: "caller" | "server" | null;
}

/**
 * Where this session opens. Client-side for every mode: with fMP4 segments Jellyfin answers
 * the EXT-X-MAP init with HTTP 400 whenever StartTimeTicks is set, so a resumed transcode
 * fails its first load.
 */
export function resolveResume(input: ResumeInput): ResumeDecision {
  if (input.live || input.pendingSeekSec !== null) return { seconds: null, source: null };
  if (input.startPositionTicks && input.startPositionTicks > 0) {
    return { seconds: input.startPositionTicks / JELLYFIN_TIME.TICKS_PER_SECOND, source: "caller" };
  }
  if (input.userDataTicks && input.userDataTicks > 0) {
    return { seconds: input.userDataTicks / JELLYFIN_TIME.TICKS_PER_SECOND, source: "server" };
  }
  return { seconds: null, source: null };
}
