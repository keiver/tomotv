import type { PlaybackSession, SessionHead } from "@/services/diagnosticsSchema";

/** A run of plain lines, or one event: a banded heading with its payload under it. */
export type LogBlock = { event?: { name: string; time: string }; lines: string[] };

const clock = (t: number) => new Date(t).toLocaleTimeString();

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

/** "enginePlan" reads as a variable name in a band; "Engine plan" reads as a heading. */
export const titleCase = (name: string) => name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

const gigabytes = (bytes: number) => `${Math.round(bytes / 2 ** 30)} GB`;

/** The head as three lines: the build, the machine and its OS, and what the hardware carries. */
export function headLines(head: SessionHead): string[] {
  const { app, os, device } = head;
  const build = app.build ? ` (${app.build})` : "";
  const machine = `${device.marketingName ?? device.family}${device.model ? ` (${device.model})` : ""}`;
  const lines = [`${app.name} ${app.version}${build}`, `${machine}, ${os.name} ${os.version}`];
  const hardware = [
    device.cores != null ? `${device.cores} cores` : null,
    device.memoryBytes != null ? gigabytes(device.memoryBytes) : null,
    device.decode ? (device.decode.hevcMain10 ? "HEVC 10-bit" : device.decode.hevc ? "HEVC" : "no HEVC") : null,
    device.decode ? (device.decode.av1 ? "AV1" : "no AV1") : null,
  ].filter((part): part is string => part !== null);
  if (hardware.length) lines.push(hardware.join(", "));
  return lines;
}

/** The log as blocks. Copy flattens the same structure, so the two cannot disagree. */
export function buildLog(session: PlaybackSession): LogBlock[] {
  const { playback } = session;
  const summary = [
    ...headLines(session),
    `Item: ${String(lastEvent(session, "source")?.name ?? playback.itemId)}`,
    `Started: ${new Date(playback.startedAt).toLocaleString()}`,
    `Outcome: ${verdict(session)}`,
  ];
  const last = playback.progress[playback.progress.length - 1];
  if (last) summary.push(`Reached: ${last.position.toFixed(1)}s`);

  // A retried error is a detour, not the verdict: the playback after it decided the outcome.
  const failure = lastEvent(session, "error");
  if (failure?.message) summary.push(`${failure.willRetry ? "Retried after" : "Error"}: ${String(failure.message)}`);
  const declined = lastEvent(session, "decline");
  if (declined?.reason) summary.push(`Engine declined: ${String(declined.reason)}`);

  const blocks: LogBlock[] = [{ lines: summary }];
  for (const event of playback.events) {
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
