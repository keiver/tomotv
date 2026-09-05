import type { PlaybackSession, SessionEvent } from "@/services/playbackProbe";
import { IS_MAC } from "@/utils/hostEnvironment";
import { Platform } from "react-native";

/** The machine the reader is holding, as the story names it. */
export type DeviceName = "iPhone" | "iPad" | "Mac" | "Apple TV";

export const THIS_DEVICE: DeviceName = Platform.isTV ? "Apple TV" : IS_MAC ? "Mac" : Platform.OS === "ios" && Platform.isPad ? "iPad" : "iPhone";

const last = (session: PlaybackSession, name: string): SessionEvent | undefined => [...session.events].reverse().find((event) => event.event === name);

/** Internal lane names, in words a viewer would use. */
const LANE_WORDS: Record<string, string> = {
  direct: "direct play",
  localRemux: "the on-device engine",
  transcode: "server transcoding",
  "remux-or-transcode": "the on-device engine or the server",
};
const laneWords = (lane: unknown) => LANE_WORDS[String(lane)] ?? String(lane);

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

/** How it opened and how it ended. */
function outcome(session: PlaybackSession, where: string): string {
  const started = last(session, "playing")?.afterSeconds;
  const after = typeof started === "number" ? `, started ${started} seconds after the player opened` : "";
  if (session.outcome === "error") {
    const message = last(session, "error")?.message;
    return `The last file failed on ${where}${after}${message ? `: ${String(message)}` : "."}`.replace(/\.$/, "") + ".";
  }
  if (session.outcome === "ended") return `The last file played to the end on ${where}${after}.`;
  const reached = session.progress[session.progress.length - 1]?.position ?? 0;
  if (reached > 0) return `The last file played with no errors on ${where}${after}.`;
  return `The last file never started on ${where}.`;
}

/** The lane as a subject, for "X tried first". */
const TRIED: Record<string, string> = { direct: "Direct play", localRemux: "The on-device engine", transcode: "Server transcoding" };

/** Where the work landed, as the object of "fell back to" or the whole sentence. */
function landing(mode: string, session: PlaybackSession, asObject: boolean): string | null {
  const sent = "the server only sent the file";
  switch (mode) {
    case "direct":
      return asObject ? `direct play, so ${sent}` : `Played straight from the file, and ${sent}.`;
    case "audio":
      return asObject ? `the audio straight from the file, so ${sent}` : `The audio played straight from the file, and ${sent}.`;
    case "localRemux": {
      const plan = planClause(last(session, "enginePlan"));
      const tier = last(session, "tier")?.state;
      const server =
        tier === "listed"
          ? "the server fed a smaller version first until the player switched to it"
          : tier === "dropped"
            ? "the server fed a smaller version first, then its feed failed and was dropped"
            : sent;
      return asObject ? `the on-device engine, which remuxed it${plan}, so ${server}` : `Remuxed on the device${plan}, and ${server}.`;
    }
    case "transcode": {
      const declined = last(session, "decline")?.reason;
      const why = declined ? ` The on-device engine declined it: ${String(declined)}.` : "";
      return asObject ? `the Jellyfin server, which converted it before sending` : `Converted by the Jellyfin server before sending, so the server did the work.${why}`;
    }
    default:
      return null;
  }
}

/**
 * Which machine did the work. A session that changed lanes tells the attempt first: the
 * retried error or the fallback's reason is why, and the last lane is where it landed.
 */
function work(session: PlaybackSession): string | null {
  const modes = session.events.filter((event) => event.event === "mode").map((event) => String(event.mode));
  const final = modes[modes.length - 1] ?? "";
  const first = modes[0] ?? "";
  if (modes.length > 1 && first !== final && TRIED[first]) {
    const retried = session.events.find((event) => event.event === "error" && event.willRetry)?.message;
    const fallback = session.events.find((event) => event.event === "fallback")?.reason;
    const reason = retried ?? fallback;
    const why = reason ? ` but hit "${String(reason)}",` : " but could not carry it,";
    const landed = landing(final, session, true);
    return landed ? `${TRIED[first]} tried first${why} so playback fell back to ${landed}.` : null;
  }
  return landing(final, session, false);
}

/** What changed along the way, when anything did. */
function detours(session: PlaybackSession): string[] {
  const said: string[] = [];
  const modes = new Set(session.events.filter((event) => event.event === "mode").map((event) => String(event.mode)));
  for (const event of session.events) {
    if (event.event === "fallback" && modes.size < 2) {
      const reason = event.reason ? ` (${String(event.reason)})` : "";
      said.push(`It first tried ${laneWords(event.from)} and fell back to ${laneWords(event.to)}${reason}.`);
    }
  }
  const restarts = session.events.filter((event) => event.event === "engineRestart").length;
  if (restarts) said.push(`The engine restarted ${restarts === 1 ? "once" : `${restarts} times`} along the way.`);
  const switches = session.events.filter((event) => event.event === "qualitySwitch");
  if (switches.length) said.push(`Quality moved to ${String(switches[switches.length - 1].to)}${switches.length > 1 ? ` after ${switches.length} switches` : ""}.`);
  return said;
}

/**
 * The last playback in plain words, for the top of the Diagnostics screen. Everything it
 * says is read off the session's events; a session that recorded no lane says only how
 * it went. `own` is false for a session another device sent over.
 */
export function describePlayback(session: PlaybackSession, device: DeviceName, own = true): string {
  return [outcome(session, `${own ? "this" : "the"} ${device}`), work(session), ...detours(session)].filter(Boolean).join(" ");
}
