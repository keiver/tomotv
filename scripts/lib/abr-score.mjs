/**
 * Slipstream drill scenarios and scoring (memory plan: quiet-floating-mitten, acceptance matrix).
 * A timeline is a list of { kind, ms, ... } records; the host drill writes them directly and the
 * device drill maps the app's probe events and request log into the same shape.
 */

/** A picture this fast on a link that can carry it, and this fast on one that cannot. */
// AVPlayer starts on one segment or waits about a second more on identical deliveries (2.6s or 3.6 to 4.1s at 30 Mb/s).
export const FAST_START_MS = 4_500;
export const SLOW_START_MS = 8_000;
/** From the link recovering to the copy playing again. */
export const RECOVERY_BUDGET_SEC = 45;
/** The longest the picture may be gone while a rebuild's new player item opens. */
export const REBUILD_GAP_SEC = 5;
/** How far short of the scenario a recording may stop and still count as the whole run. */
export const RECORDING_SLACK_SEC = 3;

/** How long a steady link gets to settle before its variant is judged, and the span judged at its end. */
export const SETTLE_SEC = 45;
export const JUDGED_SEC = 20;
/** A step of the profile this long is a steady link. */
export const STEADY_SEC = 60;
/** The share of a link the app lets AVPlayer spend (LINK_CAP_SHARE), and the copy's margin (LINK_CLIMB_MARGIN). */
const CAP_SHARE = 0.8;
const COPY_MARGIN = 1.2;
const OPENING_SEC = 30;
const COPY_LEADS_MARGIN = 3;
const OPENING_RUNG_SHARE = 6;
const SEGMENT_SEC = 6;

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
    // A master written for a slow link cannot name the copy (listed at 0.6 Mb/s it killed the item,
    // -12889, measured), so this recovery is one rebuild at the playhead, and exactly one.
    climbsByRebuild: true,
    profile: [
      { atSec: 0, kbps: 1500 },
      { atSec: 60, kbps: 30000 },
    ],
  },
  S5: { label: "0.6 Mbps", seconds: 150, profile: [{ atSec: 0, kbps: 600 }] },
  S6: {
    label: "3 <-> 6 every 20s",
    seconds: 160,
    profile: Array.from({ length: 8 }, (_, i) => ({ atSec: i * 20, kbps: i % 2 ? 6000 : 3000 })),
  },
  S7: {
    label: "down then up, two audio tracks",
    // The thin stretch ends while the file still has segments to fetch: AVPlayer buffers a small
    // rung several times faster than it plays, and a file it has all of is never re-evaluated.
    seconds: 390,
    changeAt: 60,
    recoverAt: 210,
    profile: [
      { atSec: 0, kbps: 30000 },
      { atSec: 60, kbps: 1500 },
      { atSec: 210, kbps: 30000 },
    ],
  },
  // The gate the slow-start target was agreed against: a thin link with a long round trip.
  S9: { label: "750 kbps, 150 ms round trip", seconds: 150, rttMs: 150, profile: [{ atSec: 0, kbps: 750 }] },
  // A link that carries the copy with little to spare: the probe's reading decides the lane, and a
  // low one opens on rungs and rebuilds. 7.3 MB cross the wire before a frame (the probe, the
  // first copy segment, its audio), 4.9s at this rate, so the slow budget is the one that applies.
  S10: { label: "12 Mbps, 40 ms round trip", seconds: 150, rttMs: 40, startBudgetMs: 8_000, profile: [{ atSec: 0, kbps: 12000 }] },
  // The source cannot be read at all (the static stream is refused): the rungs carry the session.
  S11: { label: "source refused, unthrottled", seconds: 90, refuse: "Static=true", sourceless: true, profile: [{ atSec: 0, kbps: 0 }] },
  // A listed rung whose playlist cannot be had: AVPlayer steps over it and the ladder goes on.
  S12: { label: "1.5 Mbps, t1 playlist 404", seconds: 90, breakPath: "t1.m3u8", profile: [{ atSec: 0, kbps: 1500 }] },
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
  if ((m = name.match(/^a(\d+)h-seg(\d+)\.m4s$/))) return { variant: `audio-hi${m[1]}`, segment: Number(m[2]), audio: true };
  if ((m = name.match(/^a(\d+)-seg(\d+)\.m4s$/))) return { variant: `audio${m[1]}`, segment: Number(m[2]), audio: true };
  return { variant: null };
}

/** Stall episodes after the first frame: consecutive ticks where the clock did not advance while waiting. */
export function stallEpisodes(timeline) {
  const first = timeline.find((r) => r.kind === "firstFrame");
  if (!first) return [];
  const episodes = [];
  let open = null;
  for (const r of timeline) {
    if (r.kind !== "tick" || r.ms <= first.ms) continue;
    const stalled = !r.advanced && r.status === 1;
    if (stalled && !open) open = { fromMs: r.ms, toMs: r.ms, position: r.position };
    else if (stalled) open.toMs = r.ms;
    else if (open) {
      if (open.toMs - open.fromMs >= 1000) episodes.push(open);
      open = null;
    }
  }
  // A spell still open when the recording stops ran until then.
  if (open) open.toMs = Math.max(open.toMs, ...timeline.map((r) => r.ms ?? 0));
  if (open && open.toMs - open.fromMs >= 1000) episodes.push(open);
  return episodes;
}

/** Video variant changes in request order (a switch = consecutive video requests from different variants). */
export function variantRuns(timeline) {
  const runs = [];
  // A request is stamped when it ENDS: in the order AVPlayer asked, a segment that took twenty
  // seconds to die after a drop is not a switch made twenty seconds later.
  const asked = timeline.filter((r) => r.kind === "req").sort((a, b) => a.ms - (a.doneMs ?? 0) - (b.ms - (b.doneMs ?? 0)));
  for (const r of asked) {
    const c = classify(r.path.split("/").pop());
    if (!c.video) continue;
    const last = runs[runs.length - 1];
    if (last && last.variant === c.variant) {
      last.toMs = Math.max(last.toMs, r.ms);
      last.count++;
    } else runs.push({ variant: c.variant, askedMs: r.ms - (r.doneMs ?? 0), fromMs: r.ms, toMs: r.ms, count: 1 });
  }
  return runs;
}

/**
 * `ladder` is the rungs' declared rates and `heights` their picture heights, smallest first, and
 * `sourceBps` the copy's: what the run's own config offered, so the steady-link checks judge the
 * variant the link deserves.
 */
export function score(id, timeline, { expectAudio, expectSubs, ladder, heights, sourceBps = 0 } = {}) {
  const scenario = SCENARIOS[id];
  const t0 = timeline.find((r) => r.kind === "start")?.ms ?? 0;
  const at = (sec) => t0 + sec * 1000;
  // The last one: a session rebuilt on recovery ends twice.
  const end = timeline.filter((r) => r.kind === "end").at(-1);
  const failed = timeline.find((r) => r.kind === "failed");
  const firstFrame = timeline.find((r) => r.kind === "firstFrame");
  const stalls = stallEpisodes(timeline);
  const runs = variantRuns(timeline);
  // Every new player item is a replacement, whatever drove it: a climb rebuild is one too.
  const replacements = timeline.filter((r) => r.kind === "reload" || r.kind === "climb").length;
  const firstVideo = runs[0]?.variant ?? null;
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

  check("plays", firstFrame && !failed, failed ? failed.error : firstFrame ? `first frame ${firstFrame.ms - t0}ms` : "never showed a frame");
  // A picture within the budget the link deserves: the opening rate says which one applies.
  const budgetMs = scenario.startBudgetMs ?? (scenario.profile[0].kbps === 0 || scenario.profile[0].kbps >= 10_000 ? FAST_START_MS : SLOW_START_MS);
  const startMs = firstFrame ? firstFrame.ms - t0 : Infinity;
  check("starts inside the budget", startMs <= budgetMs, `${firstFrame ? Math.round(startMs) : "never"}ms of ${budgetMs}ms`);
  // A rebuild is a new player item, and the picture is gone while it opens. Where a scenario's
  // recovery IS a rebuild, that one pause is held to a bound of its own; any other stall fails.
  const climbs = timeline.filter((r) => r.kind === "climb").map((r) => r.ms);
  const isRebuildGap = (s) => scenario.climbsByRebuild && climbs.some((at) => s.fromMs >= at - 2000 && s.fromMs <= at + 2000);
  const gaps = stalls.filter(isRebuildGap);
  const others = stalls.filter((s) => !isRebuildGap(s));
  const seconds = (s) => Math.round((s.toMs - s.fromMs) / 1000);
  check("no stall after first frame", others.length === 0, others.map((s) => `${seconds(s)}s at ${Math.round(s.position)}s`).join(", ") || "none");
  if (scenario.climbsByRebuild)
    check(
      "the rebuild's pause is short",
      gaps.every((s) => s.toMs - s.fromMs <= REBUILD_GAP_SEC * 1000),
      gaps.length ? `${gaps.map(seconds).join(", ")}s of ${REBUILD_GAP_SEC}s` : "no pause",
    );
  // A hand-over scenario replaces the item once, by definition; nothing else may replace it at all.
  const allowed = scenario.handsOver || scenario.climbsByRebuild ? 1 : 0;
  check("player item survives", replacements <= allowed, `${replacements} replacements, ${allowed} allowed`);
  // A hand-over scenario with no hand-over never met its fault.
  if (scenario.handsOver) {
    // The fault is the drop: only a move to the server lane after it is the hand-over under test.
    const dropAt = at(scenario.profile[1]?.atSec ?? 0);
    const handOvers = timeline.filter((r) => r.kind === "reload" && r.to === "transcode" && r.ms >= dropAt);
    check("hands over once", replacements === 1 && handOvers.length === 1, `${replacements} replacements, ${handOvers.length} to the server after the drop`);
  }
  // Playback reached the end of the window, and kept advancing after any replacement.
  const ticks = timeline.filter((r) => r.kind === "tick");
  const lastTick = ticks.at(-1);
  const played = firstFrame && lastTick ? lastTick.position - firstFrame.position : 0;
  // The run the scenario asks for, not the one that was recorded: ticks that stop early are a failure.
  const window = firstFrame ? scenario.seconds - firstFrame.ms / 1000 : 0;
  // The recording itself has to reach the end: one that stops early proves nothing about the rest.
  const recordedSec = lastTick ? (lastTick.ms - t0) / 1000 : 0;
  const covered = recordedSec >= scenario.seconds - RECORDING_SLACK_SEC;
  check(
    "plays to the end of the run",
    covered && window > 0 && played >= window * 0.9,
    `${played.toFixed(0)}s of media over ${window.toFixed(0)}s, recorded to ${recordedSec.toFixed(0)}s of ${scenario.seconds}s`,
  );
  const lastReplacement = timeline.filter((r) => r.kind === "reload" || r.kind === "climb").at(-1);
  if (lastReplacement) {
    const after = ticks.filter((r) => r.ms > lastReplacement.ms);
    const advanced = after.length > 1 && after.at(-1).position > after[0].position + 1;
    check("keeps playing after the hand-over", advanced, after.length ? `${(after.at(-1).position - after[0].position).toFixed(0)}s after it` : "no progress recorded");
  }

  const rank = (variant) => (variant === "copy" ? 99 : Number(variant.slice(1)));
  // Delivered segments only: a request that failed or was given up shows nothing was played from it.
  const requests = timeline
    .filter((r) => r.kind === "req" && r.status >= 200 && r.status < 300 && (r.bytes ?? 0) > 0)
    .map((r) => ({ ms: r.ms, ...classify(r.path.split("/").pop()) }))
    .filter((r) => r.video);
  for (const [i, step] of scenario.profile.entries()) {
    const fromSec = step.atSec;
    const toSec = scenario.profile[i + 1]?.atSec ?? scenario.seconds;
    // A hand-over scenario refuses the ladder, so there is no offer of ours to judge.
    if (toSec - fromSec < STEADY_SEC || !ladder?.length || scenario.handsOver) continue;
    // What the link carries is ours to offer: the copy when it clears the copy's margin, else the
    // biggest rung inside the share of the link the app lets AVPlayer spend. Offered means named
    // in the master AND inside the cap in force at the end of the period.
    const linkBps = step.kbps === 0 ? Infinity : step.kbps * 1000;
    const copyFits = !scenario.sourceless && sourceBps > 0 && sourceBps * COPY_MARGIN <= linkBps;
    const carried = ladder.filter((bps) => bps <= linkBps * CAP_SHARE).length - 1;
    const master = timeline.filter((r) => r.kind === "master" && r.ms <= at(toSec)).at(-1)?.text ?? null;
    const cap = timeline.filter((r) => r.kind === "cap" && r.ms <= at(toSec)).at(-1)?.mbps ?? null;
    if (master !== null) {
      const named = copyFits ? master.includes("\nmedia.m3u8") : carried < 0 || master.includes(`\nt${carried}.m3u8`);
      const inside = copyFits || carried < 0 || cap === null || cap * 1_000_000 >= ladder[carried];
      check(
        `offers what ${step.kbps || "an open"} kb/s carries`,
        named && inside,
        `${copyFits ? "copy" : `t${Math.max(0, carried)}`} ${named ? "listed" : "NOT listed"}, cap ${cap === null ? "none" : `${cap.toFixed(2)} Mb/s`}`,
      );
    }
    // What AVPlayer does with the offer is its own call, made on its own clock, and a careful one
    // on a thin link. The floor it is held to: never under what HALF the link carries, and on the
    // copy whenever the copy is what the link deserves.
    const floor = copyFits ? 99 : Math.max(0, ladder.filter((bps) => bps <= linkBps * 0.5).length - 1);
    const inSpan = requests.filter((r) => r.ms >= at(toSec - JUDGED_SEC) && r.ms <= at(toSec));
    const standing = inSpan.length ? inSpan : requests.filter((r) => r.ms <= at(toSec)).slice(-1);
    const chosen = [...new Set(standing.map((r) => r.variant))];
    const lowest = chosen.length ? Math.min(...chosen.map(rank)) : -1;
    check(
      `rides what ${step.kbps || "an open"} kb/s carries`,
      lowest >= floor,
      chosen.length ? `fetching ${chosen.join(" ")} at the end, floor ${floor === 99 ? "copy" : `t${floor}`}` : "no video request",
    );
    // The opening is ours to promise: half a minute in, the picture is at least the rung the engine
    // opens that link on, the copy when it leads.
    if (i === 0 && toSec - fromSec >= OPENING_SEC + 15) {
      const copyLeads = copyFits && sourceBps * COPY_LEADS_MARGIN <= linkBps;
      const opens = copyLeads ? 99 : Math.max(0, ladder.filter((bps) => bps * OPENING_RUNG_SHARE <= linkBps).length - 1);
      const fetched = requests.filter((r) => r.segment === Math.floor(OPENING_SEC / SEGMENT_SEC) && r.ms <= at(toSec));
      const best = fetched.length ? Math.max(...fetched.map((r) => rank(r.variant))) : -1;
      check(
        `opens at what ${step.kbps || "an open"} kb/s affords`,
        best >= opens,
        fetched.length ? `${fetched.map((r) => r.variant).join(" ")} for the segment at ${OPENING_SEC}s, floor ${opens === 99 ? "copy" : `t${opens}`}` : "segment not fetched",
      );
    }
    // Settled means the PICTURE stays: a step away and back is one correction, more is pumping.
    // Counted in picture heights, since AVPlayer trying the next rate at the same size and
    // stepping back is a change nobody sees (the ladder's bottom two rungs are both 144p).
    const height = (variant) => (variant === "copy" ? Infinity : (heights?.[rank(variant)] ?? rank(variant)));
    const settled = runs.filter((r) => r.askedMs >= at(fromSec + SETTLE_SEC) && r.askedMs <= at(toSec)).map((r) => height(r.variant));
    let reversals = 0;
    let direction = 0;
    for (let k = 1; k < settled.length; k++) {
      const next = Math.sign(settled[k] - settled[k - 1]);
      if (next !== 0 && direction !== 0 && next !== direction) reversals++;
      if (next !== 0) direction = next;
    }
    // Away and back is two turns of direction and one event.
    const corrections = Math.ceil(reversals / 2);
    check(`holds steady on ${step.kbps || "an open"} kb/s`, corrections <= 1, `${corrections} corrections of picture size after ${SETTLE_SEC}s`);
  }
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
        const late = back ? (back.fromMs - at(scenario.recoverAt)) / 1000 : Infinity;
        check("climbs back to the copy in time", back && late <= RECOVERY_BUDGET_SEC, back ? `copy at +${Math.round(late)}s of ${RECOVERY_BUDGET_SEC}s` : "no copy segment after recovery");
      }
      break;
    }
    case "S4": {
      const back = videoAfter(scenario.changeAt).find((r) => r.variant === "copy" && r.fromMs >= at(scenario.changeAt));
      const late = back ? (back.fromMs - at(scenario.changeAt)) / 1000 : Infinity;
      check("opens on a rung", firstVideo?.startsWith("t"), `first video ${firstVideo}`);
      check("climbs back to the copy in time", back && late <= RECOVERY_BUDGET_SEC, back ? `copy at +${Math.round(late)}s of ${RECOVERY_BUDGET_SEC}s` : "no copy segment after recovery");
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
