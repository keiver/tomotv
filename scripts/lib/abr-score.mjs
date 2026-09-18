/**
 * Slipstream drill scenarios and scoring (memory plan: quiet-floating-mitten, acceptance matrix).
 * A timeline is a list of { kind, ms, ... } records; the host drill writes them directly and the
 * device drill maps the app's probe events and request log into the same shape.
 */

/** Link profiles, seconds from playback start. kbps 0 = unlimited. */
export const SCENARIOS = {
  S1: { label: "unthrottled", seconds: 60, profile: [{ atSec: 0, kbps: 0 }] },
  S2: { label: "1.5 Mbps steady", seconds: 90, profile: [{ atSec: 0, kbps: 1500 }] },
  S3: {
    label: "30 -> 1.5 at 60s",
    seconds: 420,
    changeAt: 60,
    profile: [
      { atSec: 0, kbps: 30000 },
      { atSec: 60, kbps: 1500 },
    ],
  },
  S4: {
    label: "1.5 -> 30 at 60s",
    seconds: 150,
    changeAt: 60,
    profile: [
      { atSec: 0, kbps: 1500 },
      { atSec: 60, kbps: 30000 },
    ],
  },
  S5: { label: "0.6 Mbps", seconds: 90, profile: [{ atSec: 0, kbps: 600 }] },
  S6: {
    label: "3 <-> 6 every 20s",
    seconds: 160,
    profile: Array.from({ length: 8 }, (_, i) => ({ atSec: i * 20, kbps: i % 2 ? 6000 : 3000 })),
  },
  S7: {
    label: "down then up, two audio tracks",
    seconds: 540,
    changeAt: 60,
    recoverAt: 360,
    profile: [
      { atSec: 0, kbps: 30000 },
      { atSec: 60, kbps: 1500 },
      { atSec: 360, kbps: 30000 },
    ],
  },
  S8: {
    label: "starve with rung routes refused",
    seconds: 120,
    // Only the rung's own playlist: AudioBitrate=32000 is the ladder's marker
    // (getTierPlaylistUrl). Refusing /Videos/.../main.m3u8 outright also refuses the server
    // transcode the session falls back to, which is the lane this scenario exists to test.
    refuse: "AudioBitrate=32000",
    // The rungs are gone, so surviving the drop MEANS handing the item to the server: the lane
    // change is the outcome under test, not a reload to hold against the session.
    handsOver: true,
    profile: [
      { atSec: 0, kbps: 30000 },
      { atSec: 30, kbps: 1500 },
    ],
  },
};

/** What a loopback request name serves. */
export function classify(name) {
  let m;
  if ((m = name.match(/^t(\d+)-seg(\d+)\.m4s$/))) return { variant: `t${m[1]}`, rung: Number(m[1]), segment: Number(m[2]), video: true };
  if ((m = name.match(/^seg(\d+)\.m4s$/))) return { variant: "copy", rung: null, segment: Number(m[1]), video: true };
  if ((m = name.match(/^a(\d+)s-seg(\d+)\.m4s$/))) return { variant: `audio-lo${m[1]}`, segment: Number(m[2]), audio: true };
  if ((m = name.match(/^a(\d+)-seg(\d+)\.m4s$/))) return { variant: `audio${m[1]}`, segment: Number(m[2]), audio: true };
  return { variant: null };
}

/** Stall episodes after the first frame: consecutive ticks where the clock did not advance while waiting. */
export function stallEpisodes(timeline) {
  const first = timeline.find((r) => r.kind === "firstFrame");
  if (!first) return [];
  // A climb rebuilds the session at the playhead, and that re-buffer is the price of the climb,
  // not a stall in playback.
  const rebuilds = timeline.filter((r) => r.kind === "climb").map((r) => r.ms);
  const inRebuild = (ms) => rebuilds.some((at) => ms >= at && ms <= at + 15000);
  const episodes = [];
  let open = null;
  for (const r of timeline) {
    if (r.kind !== "tick" || r.ms <= first.ms || inRebuild(r.ms)) continue;
    const stalled = !r.advanced && r.status === 1;
    if (stalled && !open) open = { fromMs: r.ms, toMs: r.ms, position: r.position };
    else if (stalled) open.toMs = r.ms;
    else if (open) {
      if (open.toMs - open.fromMs >= 1000) episodes.push(open);
      open = null;
    }
  }
  if (open && open.toMs - open.fromMs >= 1000) episodes.push(open);
  return episodes;
}

/** Video variant changes in request order (a switch = consecutive video requests from different variants). */
export function variantRuns(timeline) {
  const runs = [];
  for (const r of timeline) {
    if (r.kind !== "req") continue;
    const c = classify(r.path.split("/").pop());
    if (!c.video) continue;
    const last = runs[runs.length - 1];
    if (last && last.variant === c.variant) {
      last.toMs = r.ms;
      last.count++;
    } else runs.push({ variant: c.variant, fromMs: r.ms, toMs: r.ms, count: 1 });
  }
  return runs;
}

export function score(id, timeline, { expectAudio, expectSubs } = {}) {
  const scenario = SCENARIOS[id];
  const t0 = timeline.find((r) => r.kind === "start")?.ms ?? 0;
  const at = (sec) => t0 + sec * 1000;
  // The last one: a session rebuilt on recovery ends twice.
  const end = timeline.filter((r) => r.kind === "end").at(-1);
  const failed = timeline.find((r) => r.kind === "failed");
  const firstFrame = timeline.find((r) => r.kind === "firstFrame");
  const stalls = stallEpisodes(timeline);
  const runs = variantRuns(timeline);
  // A rebuild on a recovered link is the climb-back path, not an unwanted reload.
  const reloads = timeline.filter((r) => r.kind === "reload").length;
  const firstVideo = runs[0]?.variant ?? null;
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

  check("plays", firstFrame && !failed, failed ? failed.error : firstFrame ? `first frame ${firstFrame.ms - t0}ms` : "never showed a frame");
  check("no stall after first frame", stalls.length === 0, stalls.map((s) => `${Math.round((s.toMs - s.fromMs) / 1000)}s at ${Math.round(s.position)}s`).join(", ") || "none");
  if (!scenario.handsOver) check("no reload", reloads === 0, `${reloads} reloads`);

  const videoAfter = (sec) => runs.filter((r) => r.toMs >= at(sec));
  switch (id) {
    case "S1": {
      check("opens on the copy", firstVideo === "copy", `first video ${firstVideo}`);
      // AVPlayer evaluates the lowest variant once while it opens, whatever the link; what matters
      // is that a link carrying the copy plays the copy.
      // Counted per request, not per run: an uninterrupted copy run starts before the first frame
      // and keeps serving after it, so a run filter would find nothing to judge.
      const videoAfter = timeline
        .filter((r) => r.kind === "req" && (!firstFrame || r.ms > firstFrame.ms))
        .map((r) => classify(r.path.split("/").pop()))
        .filter((c) => c.video);
      const probes = videoAfter.filter((c) => c.variant !== "copy").length;
      const lastVariant = videoAfter.at(-1)?.variant ?? runs.at(-1)?.variant;
      check(
        "plays the copy, not a rung",
        probes <= 2 && lastVariant === "copy",
        videoAfter.length ? `${probes} rung of ${videoAfter.length} segments, last ${lastVariant}` : `no segment after the first frame, last ${lastVariant}`,
      );
      break;
    }
    case "S2":
    case "S5":
      check("opens on a rung", firstVideo?.startsWith("t"), `first video ${firstVideo}`);
      break;
    case "S3":
    case "S7": {
      check("opens on the copy", firstVideo === "copy", `first video ${firstVideo}`);
      const drop = runs.find((r) => r.variant !== "copy" && r.fromMs >= at(scenario.changeAt));
      check("steps down after the drop", drop, drop ? `${drop.variant} at +${Math.round((drop.fromMs - at(scenario.changeAt)) / 1000)}s` : runs.map((r) => r.variant).join(" "));
      if (id === "S7") {
        const back = videoAfter(scenario.recoverAt).find((r) => r.variant === "copy");
        check("climbs back to the copy", back, back ? `copy at +${Math.round((back.fromMs - at(scenario.recoverAt)) / 1000)}s` : "no copy segment after recovery");
      }
      break;
    }
    case "S4": {
      const back = videoAfter(scenario.changeAt).find((r) => r.variant === "copy" && r.fromMs >= at(scenario.changeAt));
      check("opens on a rung", firstVideo?.startsWith("t"), `first video ${firstVideo}`);
      check("climbs back to the copy", back, back ? `copy at +${Math.round((back.fromMs - at(scenario.changeAt)) / 1000)}s` : "no copy segment after recovery");
      break;
    }
    case "S6": {
      const switches = Math.max(0, runs.length - 1);
      check("no flapping", switches <= Math.floor(scenario.seconds / 12), `${switches} switches in ${scenario.seconds}s`);
      break;
    }
    default:
      break;
  }
  if (expectAudio != null && end) check("all audio tracks listed", end.audible === expectAudio, `${end.audible}/${expectAudio}`);
  if (expectSubs != null && end) check("all subtitle tracks listed", end.legible >= expectSubs, `${end.legible}/${expectSubs}`);
  return { id, label: scenario.label, pass: checks.every((c) => c.ok), checks, runs };
}
