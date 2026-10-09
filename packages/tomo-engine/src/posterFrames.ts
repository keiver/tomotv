import { engineLog } from "./config";
import { engineModule, isLocalRemuxAvailable } from "./native";

/** Settled posters by item id. A failure is kept as null, retried on the policy below, and stands. */
const posterFrames = new Map<string, string | null>();
const posterFramesInFlight = new Map<string, Promise<string | null>>();
/** Cards waiting on each job; the engine is told to drop a job only when the last one leaves. */
const posterFrameWaiters = new Map<string, number>();

/** A source with no frame in it is retried after the window, three times, and then stands. A
 *  source that would not open, a file still being copied for one, is asked again for as long as
 *  it fails, the wait doubling up to the cap. */
export const POSTER_FRAME_RETRY_MS = 60_000;
export const POSTER_FRAME_ATTEMPTS = 3;
export const POSTER_FRAME_OPEN_RETRY_CAP_MS = 10 * 60_000;
type PosterFrameFailureReason = "open" | "frame";
const posterFrameFailures = new Map<string, { at: number; attempts: number; reason: PosterFrameFailureReason }>();

/** True while a stored failure is one this item has earned another try at. */
function posterFrameRetryable(itemId: string, now = Date.now()): boolean {
  const failure = posterFrameFailures.get(itemId);
  if (!failure) return false;
  if (failure.reason === "open") {
    return now - failure.at >= Math.min(POSTER_FRAME_RETRY_MS * 2 ** (failure.attempts - 1), POSTER_FRAME_OPEN_RETRY_CAP_MS);
  }
  return failure.attempts < POSTER_FRAME_ATTEMPTS && now - failure.at >= POSTER_FRAME_RETRY_MS;
}

function recordPosterFrameFailure(itemId: string, reason: PosterFrameFailureReason): void {
  const failure = posterFrameFailures.get(itemId);
  // Once per item: the retries that follow are the policy, not news.
  if (!failure) engineLog().debug("Poster frame unavailable", { service: "LocalRemux", itemId, reason: reason === "open" ? "source would not open" : "no frame in the source" });
  posterFrameFailures.set(itemId, { at: Date.now(), attempts: (failure?.attempts ?? 0) + 1, reason });
}

/** Bumped by every clear, so a job that outlived one writes nothing back and picture keys change. */
let posterFrameGen = 0;
/** Bumped when a settled poster had to be decoded again, so the picture key changes and a card reloads it. */
const posterFrameRevisions = new Map<string, number>();

/** The settled answer for an item, or undefined before any request has finished or while a
 *  failure is due another try. */
export function posterFrameIfCached(itemId: string): string | null | undefined {
  const settled = posterFrames.get(itemId);
  return settled === null && posterFrameRetryable(itemId) ? undefined : settled;
}

/** A keyframe decode of ours is open: it shares the cores and the link the engine is timed on. */
export function posterFrameWorkInFlight(): boolean {
  return posterFramesInFlight.size > 0;
}

/** Which set of answers is current. Mixed into the image cache key so a switch redraws. */
export function posterFrameGeneration(): number {
  return posterFrameGen;
}

export function posterFrameRevision(itemId: string): number {
  return posterFrameRevisions.get(itemId) ?? 0;
}

export function clearPosterFrameCache(): void {
  posterFrameGen += 1;
  // A job of the generation being left writes nothing back, but is still open against a source
  // the app has left.
  for (const itemId of posterFramesInFlight.keys()) if (engineModule()?.cancelPosterFrame) void engineModule().cancelPosterFrame(itemId);
  posterFrames.clear();
  posterFramesInFlight.clear();
  posterFrameWaiters.clear();
  posterFrameFailures.clear();
  posterFrameRevisions.clear();
}

/** A poster request: the item's id, where its media reads from, and the moment to grab. */
export interface PosterFrameRequest {
  id: string;
  /** Resolved inside the job, so callers sharing one job pay for one lookup. */
  inputUrl: () => string;
  seconds: number;
}

/**
 * A keyframe for a card with no poster, decoded by the engine into the frame pool and answered
 * as a file URL. Callers asking at once share one job. A job the engine dropped is asked again
 * while a card still waits, and settles nothing otherwise. A failure stands until it is due a
 * retry; a success is confirmed with the engine, which decodes again a poster whose file the
 * pool has trimmed since.
 */
export async function requestPosterFrame(request: PosterFrameRequest): Promise<string | null> {
  const settled = posterFrameIfCached(request.id);
  if (settled === null) return null;
  if (!isLocalRemuxAvailable()) return null;
  posterFrameWaiters.set(request.id, (posterFrameWaiters.get(request.id) ?? 0) + 1);
  const pending = posterFramesInFlight.get(request.id);
  if (pending) return pending;
  const generation = posterFrameGen;
  const job = (async (): Promise<string | null> => {
    try {
      const inputUrl = request.inputUrl();
      let result: { uri?: string | null; cancelled?: boolean; fresh?: boolean; reason?: PosterFrameFailureReason } | undefined;
      do {
        result = await engineModule().posterFrame({ itemId: request.id, inputUrl, seconds: request.seconds });
        // A cancel from a card that left lands on the job a card arriving since has joined: ask again for it.
      } while (result?.cancelled && generation === posterFrameGen && (posterFrameWaiters.get(request.id) ?? 0) > 0);
      if (result?.cancelled) return null;
      const uri = result?.uri ?? null;
      if (generation === posterFrameGen) {
        posterFrames.set(request.id, uri);
        if (uri === null) recordPosterFrameFailure(request.id, result?.reason === "open" ? "open" : "frame");
        else posterFrameFailures.delete(request.id);
        if (settled !== undefined && result?.fresh) posterFrameRevisions.set(request.id, posterFrameRevision(request.id) + 1);
      }
      return uri;
    } catch (error) {
      engineLog().warn("Poster frame failed", error, { service: "LocalRemux", itemId: request.id });
      if (generation === posterFrameGen) {
        posterFrames.set(request.id, null);
        recordPosterFrameFailure(request.id, "frame");
      }
      return null;
    } finally {
      // A cleared generation owns none of these entries: a job started since holds them.
      // The waiter count is owed one cancel per mounted card, and settling is not a card leaving.
      if (generation === posterFrameGen) posterFramesInFlight.delete(request.id);
    }
  })();
  posterFramesInFlight.set(request.id, job);
  return job;
}

/** Idles the native backlog while video plays; the grab already running finishes. Guarded on
 *  the method: a Metro reload can carry JS newer than the installed binary. */
export function setPosterFramesPaused(paused: boolean): void {
  if (!isLocalRemuxAvailable()) return;
  if (engineModule()?.setPosterQueuePaused) void engineModule().setPosterQueuePaused(paused);
}

/** A card leaving the screen. The engine drops the job once no card waits on it. */
export function cancelPosterFrame(itemId: string): void {
  const waiting = posterFrameWaiters.get(itemId) ?? 0;
  if (waiting > 1) {
    posterFrameWaiters.set(itemId, waiting - 1);
    return;
  }
  posterFrameWaiters.delete(itemId);
  if (waiting === 1 && engineModule()?.cancelPosterFrame) void engineModule().cancelPosterFrame(itemId);
}
