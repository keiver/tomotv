import type { PlaybackSession } from "@/services/diagnosticsSchema";

const lastEvent = (session: PlaybackSession, name: string) => [...session.playback.events].reverse().find((event) => event.event === name);

/** The player moved: its first-motion event, or a position sample past zero. */
export function started(session: PlaybackSession): boolean {
  const { events, progress } = session.playback;
  return events.some((event) => event.event === "playing") || (progress[progress.length - 1]?.position ?? 0) > 0;
}

/**
 * Did it play, in words. The stored outcome alone cannot say: "playing" only means no end
 * was recorded, which covers both a viewer who backed out mid-film and a file that never
 * started at all. Motion separates them.
 */
export function verdict(session: PlaybackSession): string {
  if (session.playback.outcome === "error") return "Failed";
  if (session.playback.outcome === "ended") return "Played to the end";
  return started(session) ? "Played, no errors" : "Never started";
}

/** When the session was last written: its newest event or sample, else its start. */
export function savedAt(session: PlaybackSession): number {
  const { startedAt, events, progress } = session.playback;
  return Math.max(startedAt, ...events.map((event) => event.t), ...progress.map((sample) => sample.t));
}

export type SessionSummary = {
  item: string;
  started: string;
  outcome: string;
  reachedSeconds: number | null;
  /** The error that decided the outcome; a retried one is a detour, kept apart. */
  error: string | null;
  retriedAfter: string | null;
  engineDeclined: string | null;
};

/** The reading the head of the screen gives: derived from the playback on display, never stored. */
export function summarize(session: PlaybackSession): SessionSummary {
  const { playback } = session;
  const last = playback.progress[playback.progress.length - 1];
  const failure = lastEvent(session, "error");
  const message = failure?.message ? String(failure.message) : null;
  const declined = lastEvent(session, "decline")?.reason;
  return {
    item: String(lastEvent(session, "source")?.name ?? playback.itemId),
    started: new Date(playback.startedAt).toLocaleString(),
    outcome: verdict(session),
    reachedSeconds: last ? Math.round(last.position * 10) / 10 : null,
    error: failure?.willRetry ? null : message,
    retriedAfter: failure?.willRetry ? message : null,
    engineDeclined: declined ? String(declined) : null,
  };
}

export type DisplayedSession = { summary: SessionSummary } & PlaybackSession;

/** The document as the screen shows it: docs/diagnostics-session.schema.json, the version first, then the summary. */
export function displayed(session: PlaybackSession): DisplayedSession {
  const { schemaVersion, ...rest } = session;
  return { schemaVersion, summary: summarize(session), ...rest };
}

export function documentText(session: PlaybackSession): string {
  return JSON.stringify(displayed(session), null, 2);
}

export function documentLines(session: PlaybackSession): string[] {
  return documentText(session).split("\n");
}

/** What copy, share and mail carry: the story first when there is one, then the document. */
export function logText(session: PlaybackSession, story: string | null = null): string {
  const body = documentText(session);
  return story ? `${story}\n\n${body}` : body;
}
