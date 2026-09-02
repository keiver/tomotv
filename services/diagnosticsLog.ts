import type { PlaybackSession } from "@/services/playbackProbe";

/** The two head lines: the build, and the OS it ran on. */
export type LogHead = { app: string; os: string };

/** A run of plain lines, or one event: a banded heading with its payload under it. */
export type LogBlock = { event?: { name: string; time: string }; lines: string[] };

const clock = (t: number) => new Date(t).toLocaleTimeString();

const lastEvent = (session: PlaybackSession, name: string) => [...session.events].reverse().find((event) => event.event === name);

/**
 * Did it play, in words. The stored outcome alone cannot say: "playing" only means no end
 * was recorded, which covers both a viewer who backed out mid-film and a file that never
 * started at all. The position separates them.
 */
export function verdict(session: PlaybackSession): string {
  if (session.outcome === "error") return "Failed";
  if (session.outcome === "ended") return "Played to the end";
  return (session.progress[session.progress.length - 1]?.position ?? 0) > 0 ? "Played, no errors" : "Never started";
}

/** "enginePlan" reads as a variable name in a band; "Engine plan" reads as a heading. */
export const titleCase = (name: string) => name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

/** The log as blocks. Copy flattens the same structure, so the two cannot disagree. */
export function buildLog(session: PlaybackSession | null, head: LogHead): LogBlock[] {
  const lines = [head.app, head.os];
  if (!session) return [{ lines }];

  const summary = [...lines, `Item: ${String(lastEvent(session, "source")?.name ?? session.itemId)}`, `Started: ${new Date(session.startedAt).toLocaleString()}`, `Outcome: ${verdict(session)}`];
  const last = session.progress[session.progress.length - 1];
  if (last) summary.push(`Reached: ${last.position.toFixed(1)}s`);

  // A retried error is a detour, not the verdict: the playback after it decided the outcome.
  const failure = lastEvent(session, "error");
  if (failure?.message) summary.push(`${failure.willRetry ? "Retried after" : "Error"}: ${String(failure.message)}`);
  const declined = lastEvent(session, "decline");
  if (declined?.reason) summary.push(`Engine declined: ${String(declined.reason)}`);

  const blocks: LogBlock[] = [{ lines: summary }];
  for (const event of session.events) {
    // The suite's arming marker, with nothing in it; the summary already says when it started.
    if (event.event === "start") continue;
    const { t, event: name, itemId: _itemId, ...rest } = event;
    // The payload is pretty-printed and the heading is a band, because a timestamp and a
    // name sitting inline with the JSON is what made the JSON look malformed.
    blocks.push({ event: { name: titleCase(name), time: clock(t) }, lines: Object.keys(rest).length ? JSON.stringify(rest, null, 2).split("\n") : [] });
  }
  return blocks;
}

/** The blocks as one copyable text, the story first when there is one. */
export function logText(blocks: LogBlock[], story: string | null = null): string {
  const body = blocks.flatMap((block) => (block.event ? [``, `${block.event.name}   ${block.event.time}`, ...block.lines] : block.lines)).join("\n");
  return story ? `${story}\n\n${body}` : body;
}
