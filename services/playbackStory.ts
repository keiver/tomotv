import { started } from "@/services/diagnosticsLog";
import type { PlaybackSession, SessionEvent } from "@/services/diagnosticsSchema";

const last = (session: PlaybackSession, name: string): SessionEvent | undefined => [...session.playback.events].reverse().find((event) => event.event === name);

/** Internal lane names, in words a viewer would use. */
const LANE_WORDS: Record<string, string> = {
  direct: "direct play",
  localRemux: "the on-device engine",
  transcode: "server transcoding",
  "remux-or-transcode": "the on-device engine or the server",
};
const laneWords = (lane: unknown) => LANE_WORDS[String(lane)] ?? String(lane);

/** The lane as a subject, for "X was tried first". */
const TRIED: Record<string, string> = { direct: "Direct play", localRemux: "The on-device engine", transcode: "Server transcoding" };

/** "copy" and "encode" per stream, as one clause. */
function planClause(plan: SessionEvent | undefined): string {
  if (!plan) return "";
  const video = (plan.video as { action?: string } | undefined)?.action;
  const audio = (plan.audio as { action?: string }[] | undefined)?.[0]?.action;
  if (!video && !audio) return "";
  if (video === "copy" && audio === "copy") return ", with the video and audio copied as they are";
  if (video === "encode" && audio === "encode") return ", with the video and audio re-encoded";
  const parts = [video && `the video ${video === "copy" ? "copied as it is" : "re-encoded"}`, audio && `the audio ${audio === "copy" ? "copied as it is" : "re-encoded"}`].filter(Boolean);
  return `, with ${parts.join(" and ")}`;
}

/** How it opened and how it ended. The subject is the file's name when the source recorded one. */
function outcome(session: PlaybackSession, where: string): string {
  const name = last(session, "source")?.name;
  const file = typeof name === "string" && name ? name : "The last file";
  const afterSeconds = last(session, "playing")?.afterSeconds;
  const opened = typeof afterSeconds === "number" ? `started ${afterSeconds} seconds after the player opened` : null;
  if (session.playback.outcome === "error") {
    const message = last(session, "error")?.message;
    const failed = `failed on ${where}${message ? `: ${String(message)}` : ""}`.replace(/\.$/, "");
    return opened ? `${file} ${opened}, then ${failed}.` : `${file} ${failed}.`;
  }
  if (session.playback.outcome === "ended") return opened ? `${file} ${opened} and played to the end on ${where}.` : `${file} played to the end on ${where}.`;
  if (started(session)) return opened ? `${file} ${opened} and played with no errors on ${where}.` : `${file} played with no errors on ${where}.`;
  return `${file} never started on ${where}.`;
}

/** A downloaded file: the mode event says so, and a direct stream URL on disk says so on its own. */
function fromDisk(session: PlaybackSession): boolean {
  return last(session, "mode")?.held === true || String(last(session, "stream")?.url ?? "").startsWith("file:");
}

/**
 * Every lane the playback ran on, in order. A fallback that names a real lane is a change of
 * lane too: the in-place fallbacks in useVideoPlayback switch the lane without a new mode event.
 */
function lanes(session: PlaybackSession): string[] {
  const out: string[] = [];
  for (const event of session.playback.events) {
    const lane = event.event === "mode" ? String(event.mode) : event.event === "fallback" && TRIED[String(event.to)] ? String(event.to) : null;
    if (lane && out[out.length - 1] !== lane) out.push(lane);
  }
  return out;
}

/** Who did the work on the lane the playback ended on, as one or two sentences. */
function landing(mode: string, session: PlaybackSession): string | null {
  const held = fromDisk(session);
  switch (mode) {
    case "direct":
      return held ? "The file was played from this device's downloads. No server was involved." : "The server sent the file as it is, and the player opened it without any conversion.";
    case "audio":
      return held ? "The track was played from this device's downloads. No server was involved." : "The server sent the track as it is, and the player opened it without any conversion.";
    case "localRemux": {
      if (last(session, "preflight")?.failed) return "The on-device engine could not open the file on the server, so no conversion was asked for.";
      const plan = planClause(last(session, "enginePlan"));
      const tier = last(session, "tier")?.state;
      // A declared tier is listed first, so the picture opens on the server's rung. Nothing
      // records the switch off it, so the story says what was fed, never that the player left it.
      if (tier === "listed" || tier === "dropped") {
        const dropped = tier === "dropped" ? ", then that feed failed and was dropped" : "";
        return `The server sent a smaller version to open with${dropped}, and the on-device engine had the full file ready beside it${plan}.`;
      }
      return held
        ? `The file was played from this device's downloads, repackaged by the on-device engine${plan}. No server was involved.`
        : `The server sent the file as it is, and the on-device engine repackaged it for the player${plan}.`;
    }
    case "transcode": {
      const declined = last(session, "decline")?.reason;
      return `The Jellyfin server converted the file before sending it.${declined ? ` The on-device engine declined the file: ${String(declined)}.` : ""}`;
    }
    default:
      return null;
  }
}

/** Which machine did the work. A playback that changed lanes says what was tried first and why it moved. */
function work(session: PlaybackSession): string | null {
  const ran = lanes(session);
  const final = ran[ran.length - 1] ?? "";
  const landed = landing(final, session);
  if (ran.length > 1 && TRIED[ran[0]]) {
    const retried = session.playback.events.find((event) => event.event === "error" && event.willRetry)?.message;
    const fallback = session.playback.events.find((event) => event.event === "fallback")?.reason;
    const reason = retried ?? fallback;
    const why = reason ? ` but failed with "${String(reason)}"` : " but failed";
    return [`${TRIED[ran[0]]} was tried first${why}, so playback moved to ${laneWords(final)}.`, landed].filter(Boolean).join(" ");
  }
  return landed;
}

/** What changed along the way, when anything did. */
function detours(session: PlaybackSession): string[] {
  const said: string[] = [];
  const { events } = session.playback;
  events.forEach((event, index) => {
    // A fallback whose target is not a lane in itself, with no lane picked after it.
    if (event.event === "fallback" && !TRIED[String(event.to)] && !events.slice(index + 1).some((later) => later.event === "mode")) {
      const reason = event.reason ? ` with "${String(event.reason)}"` : "";
      said.push(`${TRIED[String(event.from)] ?? laneWords(event.from)} failed${reason}, and playback was sent to ${laneWords(event.to)}.`);
    }
  });
  const restarts = events.filter((event) => event.event === "engineRestart").length;
  if (restarts) said.push(`The engine restarted ${restarts === 1 ? "once" : `${restarts} times`}.`);
  const switches = events.filter((event) => event.event === "qualitySwitch");
  if (switches.length) {
    const to = String(switches[switches.length - 1].to);
    said.push(switches.length > 1 ? `Quality switched ${switches.length} times, ending at ${to}.` : `Quality switched to ${to}.`);
  }
  return said;
}

/**
 * The last playback in plain words, for the top of the Diagnostics screen. Everything it
 * says is read off the session; one that recorded no lane says only how it went. `own` is
 * false for a session another device sent over.
 */
export function describePlayback(session: PlaybackSession, own = true): string {
  return [outcome(session, `${own ? "this" : "the"} ${session.device.family}`), work(session), ...detours(session)].filter(Boolean).join(" ");
}
