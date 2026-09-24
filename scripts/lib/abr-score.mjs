/**
 * Slipstream drill scenarios and scoring (memory plan: quiet-floating-mitten, acceptance matrix).
 * A timeline is a list of { kind, ms, ... } records; the host drill writes them directly and the
 * device drill maps the app's probe events and request log into the same shape.
 */

/** A picture this fast on a link that can carry it, and this fast on one that cannot. */
// AVPlayer starts on one segment or waits about a second more on identical deliveries (2.6s or 3.6 to 4.1s at 30 Mb/s).
export const FAST_START_MS = 4_500;
export const SLOW_START_MS = 8_000;
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
  S10: { label: "12 Mbps, 40 ms round trip", seconds: 150, rttMs: 40, startBudgetMs: 8_000, profile: [{ atSec: 0, kbps: 12000 }] },
  // The source cannot be read at all (the static stream is refused): the rungs carry the session.
  S11: { label: "source refused, unthrottled", seconds: 90, refuse: "Static=true", sourceless: true, profile: [{ atSec: 0, kbps: 0 }] },
  // A listed rung whose playlist cannot be had: AVPlayer steps over it and the ladder goes on.
  S12: { label: "1.5 Mbps, t1 playlist 404", seconds: 90, breakPath: "t1.m3u8", profile: [{ atSec: 0, kbps: 1500 }] },
  S8: {
    label: "starve with rung routes refused",
    seconds: 120,
    refuse: "AudioBitrate=32000",
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
  if (open) open.toMs = Math.max(open.toMs, timeline.filter((record) => record.kind === "end").at(-1)?.ms ?? open.toMs);
  if (open && open.toMs - open.fromMs >= 1000) episodes.push(open);
  return episodes;
}

/** Video variant changes in request order (a switch = consecutive video requests from different variants). */
export function variantRuns(timeline) {
  const runs = [];
  // A request is stamped when it ENDS: in the order AVPlayer asked, a segment that took twenty
  // seconds to die after a drop is not a switch made twenty seconds later.
  const asked = timeline.filter((record) => record.kind === "req" && record.status >= 200 && record.status < 300 && record.bytes > 0).sort((a, b) => a.ms - (a.doneMs ?? 0) - (b.ms - (b.doneMs ?? 0)));
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

export function profileRates(records, epochMs) {
  if (!Number.isFinite(epochMs)) return [];
  const profileIndex = records.findLastIndex((record) => record.kind === "profile");
  if (profileIndex < 0) return [];
  const profile = records[profileIndex];
  const initial = profile.steps?.[0];
  if (!initial) return [];
  const preceding = records[profileIndex - 1];
  const applied = preceding?.kind === "rate" && preceding.reason === "profile" && preceding.atSec === initial.atSec ? preceding : profile;
  return [
    { kind: "rate", ms: applied.t - epochMs, atSec: initial.atSec, kbps: initial.kbps },
    ...records
      .slice(profileIndex + 1)
      .filter((record) => record.kind === "rate" && record.reason === "profile")
      .map((record) => ({ kind: "rate", ms: record.t - epochMs, atSec: record.atSec, kbps: record.kbps })),
  ];
}

export function copyBitrates(config) {
  if (config.serverVideoOnly) return [];
  const audio = Math.max(0, ...(config.audioTracks ?? []).map((track) => (track.usesServerAudio ? 120_000 : Math.max(0, track.bandwidth ?? 0))));
  const primary = config.primaryVideoBandwidth > 0 ? config.primaryVideoBandwidth + audio : config.bandwidth || 20_000_000;
  const bridge = config.primaryVideoBandwidth > 0 ? config.primaryVideoBandwidth + 120_000 : Math.max(primary, 120_000);
  return [...new Set([primary, ...(config.tiers?.length && config.audioTracks?.length ? [bridge] : [])])];
}

export function playerSelections(timeline, { ladder = [], copyBps = [] } = {}) {
  return timeline
    .filter((record) => record.kind === "access" && record.indicated > 0)
    .map((record) => {
      const candidates = ladder.flatMap((bandwidth, index) => (bandwidth === record.indicated ? [`t${index}`] : []));
      if (copyBps.includes(record.indicated)) candidates.push("copy");
      return { ...record, variant: candidates.length === 1 ? candidates[0] : null };
    });
}

export function score(id, timeline, { expectAudio, expectSubs, ladder = [], heights, sourceBps = 0, copyBps = [] } = {}) {
  const scenario = SCENARIOS[id];
  timeline = [...timeline].sort((left, right) => left.ms - right.ms);
  const startMs = timeline.find((record) => record.kind === "start")?.ms ?? 0;
  const end = timeline.filter((record) => record.kind === "end").at(-1);
  const deadlineMs = startMs + scenario.seconds * 1000;
  const recordingComplete = end != null && end.ms >= deadlineMs - RECORDING_SLACK_SEC * 1000;
  const failed = timeline.find((record) => record.kind === "failed");
  const firstFrame = timeline.find((record) => record.kind === "firstFrame");
  const stalls = stallEpisodes(timeline);
  const runs = variantRuns(timeline);
  const selections = playerSelections(timeline, { ladder, copyBps });
  const rates = timeline.filter((record) => record.kind === "rate");
  const replacements = timeline.filter((record) => record.kind === "reload").length;
  const checks = [];
  const diagnostics = [];
  const check = (name, ok, detail) => checks.push({ name, ok: ok == null ? null : Boolean(ok), detail });
  const note = (name, detail) => diagnostics.push({ name, detail });
  const selectionAt = (milliseconds) => selections.filter((selection) => selection.ms <= milliseconds).at(-1);
  const rateAt = (seconds) => rates.find((rate) => rate.atSec === seconds && rate.kbps === scenario.profile.find((step) => step.atSec === seconds)?.kbps);
  const rank = (variant) => (variant === "copy" ? 99 : Number(variant.slice(1)));

  check("plays", failed ? false : firstFrame ? true : recordingComplete ? false : null, failed ? failed.error : firstFrame ? `first frame ${firstFrame.ms - startMs}ms` : "no frame recorded");
  const targetMs = scenario.startBudgetMs ?? (scenario.profile[0].kbps === 0 || scenario.profile[0].kbps >= 10_000 ? FAST_START_MS : SLOW_START_MS);
  const milliseconds = firstFrame ? firstFrame.ms - startMs : null;
  const startup = { milliseconds, targetMs, meetsTarget: milliseconds != null && milliseconds <= targetMs };
  check(
    "no stall after first frame",
    firstFrame ? stalls.length === 0 : null,
    stalls.map((stall) => `${Math.round((stall.toMs - stall.fromMs) / 1000)}s at ${Math.round(stall.position)}s`).join(", ") || "none observed",
  );
  check("player item survives", replacements === 0, `${replacements} replacements, 0 allowed`);
  check("recording covers the scenario", recordingComplete ? true : null, `recorded to ${end ? ((end.ms - startMs) / 1000).toFixed(1) : "unknown"}s of ${scenario.seconds}s`);

  const ticks = timeline.filter((record) => record.kind === "tick");
  const lastTick = ticks.at(-1);
  const played = firstFrame && lastTick ? lastTick.position - firstFrame.position : 0;
  const windowSeconds = firstFrame ? scenario.seconds - (firstFrame.ms - startMs) / 1000 : 0;
  const recordedSec = lastTick ? (lastTick.ms - startMs) / 1000 : 0;
  const covered = recordedSec >= scenario.seconds - RECORDING_SLACK_SEC;
  check(
    "plays to the end of the run",
    !recordingComplete ? null : covered && windowSeconds > 0 && played >= windowSeconds * 0.9,
    `${played.toFixed(0)}s of media over ${windowSeconds.toFixed(0)}s, progress recorded to ${recordedSec.toFixed(0)}s`,
  );
  const lastReplacement = timeline.filter((record) => record.kind === "reload").at(-1);
  if (lastReplacement) {
    const after = ticks.filter((record) => record.ms > lastReplacement.ms);
    check(
      "keeps playing after the hand-over",
      after.length > 1 && after.at(-1).position > after[0].position + 1,
      after.length ? `${(after.at(-1).position - after[0].position).toFixed(0)}s after it` : "no progress recorded",
    );
  }

  check(
    "network transitions recorded",
    scenario.profile.every((step) => rateAt(step.atSec)) ? true : null,
    rates.length ? rates.map((rate) => `${rate.kbps} kb/s at ${rate.ms}ms`).join(", ") : "no proxy transition timestamps",
  );
  check(
    "player-reported selection available",
    selections.some((selection) => selection.variant !== null) ? true : null,
    selections.length ? selections.map((selection) => `${selection.indicated} b/s: ${selection.variant ?? "unmapped"}`).join(", ") : "no AVPlayer access events",
  );
  const requests = timeline
    .filter((record) => record.kind === "req" && record.status >= 200 && record.status < 300 && record.bytes > 0)
    .map((record) => ({ ...record, askedMs: record.ms - (record.doneMs ?? 0), ...classify(record.path.split("/").pop()) }))
    .filter((record) => record.video);
  note(
    "video deliveries",
    `first ${runs[0]?.variant ?? "unknown"}; ${requests.filter((request) => request.variant !== "copy").length} rung of ${requests.length} completed requests; not displayed-quality evidence`,
  );

  for (const [index, step] of scenario.profile.entries()) {
    const next = scenario.profile[index + 1];
    if ((next?.atSec ?? scenario.seconds) - step.atSec < STEADY_SEC || !ladder.length || scenario.handsOver) continue;
    const from = rateAt(step.atSec);
    const until = next ? rateAt(next.atSec)?.ms : deadlineMs;
    if (!from || until == null) continue;
    const linkBps = step.kbps === 0 ? Infinity : step.kbps * 1000;
    const copyFits = !scenario.sourceless && sourceBps > 0 && sourceBps * COPY_MARGIN <= linkBps;
    const carried = Math.max(0, ladder.filter((bandwidth) => bandwidth <= linkBps * CAP_SHARE).length - 1);
    const master = timeline.filter((record) => record.kind === "master" && record.ms <= until).at(-1)?.text;
    const cap = timeline.filter((record) => record.kind === "cap" && record.ms <= until).at(-1)?.mbps;
    const named = master == null ? null : copyFits ? master.includes("\nmedia.m3u8") : master.includes(`\nt${carried}.m3u8`);
    const requiredBps = copyFits ? (copyBps.length ? Math.min(...copyBps) : null) : ladder[carried];
    const inside = cap == null || requiredBps == null ? null : cap === 0 || cap * 1_000_000 >= requiredBps;
    check(
      `offers what ${step.kbps || "an open"} kb/s carries`,
      named === false || inside === false ? false : named == null || inside == null ? null : true,
      `${copyFits ? "copy" : `t${carried}`}; master ${master == null ? "not captured" : named ? "lists it" : "does not list it"}; cap ${cap == null ? "not captured" : cap === 0 ? "unlimited" : `${cap.toFixed(2)} Mb/s`}`,
    );
    const selected = selectionAt(until);
    if (copyFits) {
      check(
        `player reports the copy on ${step.kbps || "an open"} kb/s`,
        selected?.variant == null ? null : selected.variant === "copy",
        selected ? `AVPlayer indicated ${selected.indicated} b/s (${selected.variant ?? "unmapped"}); not a displayed-frame measurement` : "no AVPlayer access event",
      );
    }
    const inSpan = requests.filter((request) => request.askedMs >= until - JUDGED_SEC * 1000 && request.askedMs <= until);
    const floor = copyFits ? "copy" : `t${Math.max(0, ladder.filter((bandwidth) => bandwidth <= linkBps * 0.5).length - 1)}`;
    note(
      `delivery heuristic on ${step.kbps || "an open"} kb/s`,
      `last ${JUDGED_SEC}s requested ${[...new Set(inSpan.map((request) => request.variant))].join(" ") || "none"}; half-link floor ${floor}, informational`,
    );
    const height = (variant) => (variant === "copy" ? Infinity : (heights?.[rank(variant)] ?? rank(variant)));
    const settled = runs.filter((run) => run.askedMs >= from.ms + SETTLE_SEC * 1000 && run.askedMs <= until).map((run) => height(run.variant));
    let reversals = 0;
    let direction = 0;
    for (let index = 1; index < settled.length; index++) {
      const nextDirection = Math.sign(settled[index] - settled[index - 1]);
      if (nextDirection !== 0 && direction !== 0 && nextDirection !== direction) reversals++;
      if (nextDirection !== 0) direction = nextDirection;
    }
    note(`request reversals on ${step.kbps || "an open"} kb/s`, `${reversals} after ${SETTLE_SEC}s; not visible flapping evidence`);
  }

  if (id === "S3" || id === "S7") {
    const drop = rateAt(scenario.changeAt);
    const until = id === "S7" ? rateAt(scenario.recoverAt)?.ms : deadlineMs;
    const down = drop && until != null ? selections.find((selection) => selection.ms >= drop.ms && selection.ms < until && selection.variant?.startsWith("t")) : null;
    check(
      "player reports a rung after the drop",
      down ? true : null,
      down ? `${down.variant} at +${((down.ms - drop.ms) / 1000).toFixed(1)}s` : "downshift not observed; uninterrupted buffered playback does not prove a transition",
    );
  }
  if (id === "S4" || id === "S7") {
    const rise = rateAt(id === "S7" ? scenario.recoverAt : scenario.changeAt);
    const before = rise ? selectionAt(rise.ms - 1) : null;
    const back = rise && before?.variant?.startsWith("t") ? selections.find((selection) => selection.ms >= rise.ms && selection.ms <= deadlineMs && selection.variant === "copy") : null;
    const finalSelection = selectionAt(deadlineMs);
    check(
      "player reports a climb back to the copy",
      !rise || !before?.variant?.startsWith("t") ? null : back ? true : recordingComplete && finalSelection?.variant?.startsWith("t") ? false : null,
      back ? `AVPlayer reported copy +${((back.ms - rise.ms) / 1000).toFixed(1)}s after the proxy rise` : "no measured rung-to-copy recovery",
    );
    const delivery = rise ? requests.find((request) => request.variant === "copy" && request.askedMs >= rise.ms && request.askedMs <= deadlineMs) : null;
    note("copy delivery after recovery", delivery ? `requested +${((delivery.askedMs - rise.ms) / 1000).toFixed(1)}s; not displayed quality` : "no post-recovery copy request");
  }

  for (const [kind, field, expected, label] of [
    ["tracks", "audio", expectAudio, "audio"],
    ["textTracks", "subtitles", expectSubs, "subtitle"],
  ]) {
    if (expected == null) continue;
    const counts = timeline.filter((record) => record.kind === kind && firstFrame && record.ms >= firstFrame.ms).map((record) => record[field]);
    const finalCount = end?.[kind === "tracks" ? "audible" : "legible"];
    if (finalCount != null) counts.push(finalCount);
    check(
      `all ${label} tracks listed`,
      counts.length ? counts.every((count) => (kind === "tracks" ? count === expected : count >= expected)) : null,
      counts.length ? `${counts.join(",")}/${expected}` : "no track catalogue recorded",
    );
  }
  const status = checks.some((entry) => entry.ok === false) ? "FAIL" : checks.some((entry) => entry.ok === null) ? "INCOMPLETE" : "PASS";
  return { id, label: scenario.label, status, pass: status === "PASS", checks, diagnostics, runs, selections, startup };
}
